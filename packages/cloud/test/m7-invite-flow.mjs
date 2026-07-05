/**
 * M7 guest-invite integration smoke test. Boots the cloud on a throwaway port +
 * data dir, then drives the full flow over HTTP:
 *
 *   register server → owner claims → server-signed invite → guest signs up →
 *   redeem (membership) → device-code → GUEST self-approves → poll → verify the
 *   signed grant carries role=guest + the right binding.
 *
 * Run: node packages/cloud/test/m7-invite-flow.mjs   (from repo root)
 * No deps beyond Node 20 (global fetch, node:crypto). Exits non-zero on failure.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  generateKeyPairSync, sign as edSign, createPublicKey, createHash,
} from 'node:crypto';

const PORT = 4987;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), 'wo-cloud-m7-'));
const cloudDir = resolve('packages/cloud');
const tsx = resolve('node_modules/.bin/tsx' + (process.platform === 'win32' ? '.cmd' : ''));

let passed = 0;
function ok(cond, label) {
  if (!cond) { console.error(`  ✗ ${label}`); throw new Error(`FAILED: ${label}`); }
  console.log(`  ✓ ${label}`); passed++;
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function serverIdFromPubKey(pem) {
  const der = createPublicKey(pem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 40);
}
function decodeGrant(token) {
  const body = token.slice(0, token.indexOf('.'));
  return JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'));
}
async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return; } catch {}
    await sleep(200);
  }
  throw new Error('cloud did not become healthy');
}

async function run() {
  // ── Server identity (Ed25519), mirrors the backend registration client ──
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const serverId = serverIdFromPubKey(pubPem);
  const sign = (msg) => b64url(edSign(null, Buffer.from(msg, 'utf-8'), privateKey));

  // 1. register
  let r = await api('POST', '/api/servers/register', { pubKey: pubPem, sig: sign(`register:${serverId}`) });
  ok(r.status === 200 && r.body.serverId === serverId, 'server registers');

  // 2. owner account + claim
  r = await api('POST', '/api/accounts', { email: 'owner@example.com', password: 'ownerpass1' });
  ok(r.status === 201 && r.body.token, 'owner account created');
  const ownerToken = r.body.token;
  r = await api('POST', `/api/servers/${serverId}/claim-code`, { sig: sign(`claim-code:${serverId}`) });
  ok(r.status === 200 && r.body.code, 'server issues claim code');
  const claimCode = r.body.code;
  r = await api('POST', '/api/servers/claim', { code: claimCode, label: 'Living Room' }, ownerToken);
  ok(r.status === 200 && r.body.serverId === serverId, 'owner claims server');

  // 3. server-signed invite (closed / locked to an existing WO user)
  const email = 'guest@example.com';
  r = await api('POST', `/api/servers/${serverId}/invites`, {
    email, binding: 'locked', boundWoProfileId: 'wo-abc123', sig: sign(`invite:${serverId}:${email}`),
  });
  ok(r.status === 201 && r.body.token && r.body.url.includes('/invite?token='), 'owner mints locked invite');
  ok(r.body.emailed === false, 'invite not emailed (mailgun dormant)');
  const token = r.body.token;

  // 4. public invite lookup
  r = await api('GET', `/api/invites/${token}`);
  ok(r.status === 200 && r.body.serverLabel === 'Living Room' && r.body.email === email, 'guest reads invite');
  ok(r.body.binding === 'locked' && r.body.createsProfile === false, 'invite reports locked binding');

  // 5. guest signs up + redeems
  r = await api('POST', '/api/accounts', { email, password: 'guestpass1' });
  ok(r.status === 201 && r.body.token, 'guest account created');
  const guestToken = r.body.token;
  r = await api('POST', '/api/invites/redeem', { token }, guestToken);
  ok(r.status === 200 && r.body.serverId === serverId && r.body.next === 'device-code', 'guest redeems → membership');

  // re-redeem is rejected (single use)
  r = await api('POST', '/api/invites/redeem', { token }, guestToken);
  ok(r.status === 409, 'redeemed invite cannot be reused');

  // 6. guest appears as a guest server on /accounts/me
  r = await api('GET', '/api/accounts/me', null, guestToken);
  ok(r.status === 200 && (r.body.guestServers || []).some((s) => s.serverId === serverId), 'guest sees server in guestServers');
  ok((r.body.servers || []).length === 0, 'guest owns no servers');

  // 7. device-code + GUEST self-approve (no owner involved)
  r = await api('POST', '/api/device-code', { serverId });
  ok(r.status === 201 && r.body.deviceCode && r.body.userCode, 'device-code issued');
  const { deviceCode, userCode } = r.body;
  r = await api('POST', '/api/device-code/approve', { userCode, serverId }, guestToken);
  ok(r.status === 200 && r.body.role === 'guest', 'guest self-approves as guest');
  r = await api('POST', '/api/device-code/poll', { deviceCode });
  ok(r.status === 200 && r.body.status === 'approved' && r.body.grant, 'poll returns approved grant');

  // 8. the signed grant is a locked guest grant
  const g = decodeGrant(r.body.grant);
  ok(g.role === 'guest' && g.boundWoProfileId === 'wo-abc123' && g.guestBinding === 'locked', 'grant is locked guest');
  ok(g.serverId === serverId && g.v === 1 && g.exp > g.iat, 'grant envelope well-formed');

  // 9. a NON-member cannot approve for this server
  r = await api('POST', '/api/accounts', { email: 'stranger@example.com', password: 'strangerp1' });
  const strangerToken = r.body.token;
  r = await api('POST', '/api/device-code', { serverId });
  const dc2 = r.body;
  r = await api('POST', '/api/device-code/approve', { userCode: dc2.userCode, serverId }, strangerToken);
  ok(r.status === 404, 'stranger cannot approve for a server they are not a member of');

  // 10. locked-new + open bindings carry through to the grant
  for (const [binding, extra] of [['locked-new', { newUserName: 'Sam' }], ['open', {}]]) {
    const em = `g-${binding}@example.com`;
    r = await api('POST', `/api/servers/${serverId}/invites`, {
      email: em, binding, ...extra, sig: sign(`invite:${serverId}:${em}`),
    });
    ok(r.status === 201, `mint ${binding} invite`);
    const tk = r.body.token;
    r = await api('POST', '/api/accounts', { email: em, password: 'password12' });
    const gt = r.body.token;
    await api('POST', '/api/invites/redeem', { token: tk }, gt);
    r = await api('POST', '/api/device-code', { serverId });
    const dc = r.body;
    await api('POST', '/api/device-code/approve', { userCode: dc.userCode, serverId }, gt);
    r = await api('POST', '/api/device-code/poll', { deviceCode: dc.deviceCode });
    const gg = decodeGrant(r.body.grant);
    ok(gg.guestBinding === binding, `${binding} grant carries binding`);
    if (binding === 'locked-new') ok(gg.newUserName === 'Sam', 'locked-new grant carries suggested name');
    if (binding === 'open') ok(gg.boundWoProfileId === null, 'open grant has no bound profile');
  }

  console.log(`\nAll ${passed} checks passed ✅`);
}

const child = spawn(`"${tsx}" src/index.ts`, {
  cwd: cloudDir,
  env: { ...process.env, PORT: String(PORT), CLOUD_DATA_DIR: dataDir, WEB_UI_BASE: 'https://whatsontv.net' },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
});
let cloudLog = '';
child.stdout.on('data', (d) => (cloudLog += d));
child.stderr.on('data', (d) => (cloudLog += d));

let code = 1;
try {
  await waitHealth();
  await run();
  code = 0;
} catch (err) {
  console.error('\n' + String(err));
  if (cloudLog) console.error('\n--- cloud output ---\n' + cloudLog.slice(-2000));
} finally {
  child.kill();
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  process.exit(code);
}
