/**
 * Read-only public demo (WHATSON_DEMO=1): the guard, the stream-proxy target
 * check and the rate limiter. Run with `npm test -w packages/api`.
 *
 * The HTTP tests mount the real LAN surface — the widest one, with every admin
 * router — exactly as index.ts does, so a route that slips past the guard
 * shows up here as a non-403.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

// Environment must be in place before the app modules load (config is lazy, but
// several services resolve their data dirs at import time).
const dataDir = mkdtempSync(join(tmpdir(), 'whatson-demo-test-'));
process.env.WHATSON_DEMO = '1';
process.env.DATA_DIR = dataDir;
process.env.WHATSON_DATA_DIR = dataDir;
process.env.JELLYFIN_URL = 'http://jellyfin:8096';
process.env.JELLYFIN_USERNAME = 'demo';
process.env.ADMIN_PASSWORD_HASH = ''; // demo runs in open mode, like production
process.env.AUTO_UPDATE = 'false';

let server: Server;
let base = '';

before(async () => {
  const express = (await import('express')).default;
  const { mountApiRoutes, makeErrorHandler } = await import('../src/server/surface.js');
  const { demoSetupGuard } = await import('../src/middleware/demoGuard.js');
  const app = express();
  app.use(express.json());
  app.use('/setup', demoSetupGuard);
  mountApiRoutes(app, 'lan');
  app.use(makeErrorHandler('lan'));
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(() => {
  server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json };
}

// Every write a guest could reach before demo mode existed, plus the admin
// routes that open mode would otherwise expose to everyone.
const DENIED: Array<[string, string]> = [
  ['POST', '/api/scrobble'],
  ['POST', '/api/unscrobble'],
  ['POST', '/api/scrobble/all'],
  ['POST', '/api/unscrobble/all'],
  ['POST', '/api/tracked'],
  ['DELETE', '/api/tracked/123'],
  ['PATCH', '/api/tracked/123'],
  ['PUT', '/api/sports/prefs'],
  ['POST', '/api/artwork/clear'],
  ['POST', '/api/whatson-users'],
  ['PATCH', '/api/whatson-users/abc'],
  ['DELETE', '/api/whatson-users/abc'],
  ['POST', '/api/whatson-users/guest-profile'],
  ['POST', '/api/users/select'],
  ['POST', '/api/auth/setup-admin'],
  ['POST', '/api/auth/login'],
  ['POST', '/api/auth/logout'],
  ['POST', '/api/auth/pair/start'],
  ['GET', '/api/auth/pair/poll'],
  ['POST', '/api/auth/pair/complete'],
  ['POST', '/api/auth/change-password'],
  ['GET', '/api/auth/devices'],
  ['DELETE', '/api/auth/devices/x'],
  ['POST', '/api/auth/redeem-grant'],
  ['GET', '/api/config'],
  ['POST', '/api/config/save'],
  ['POST', '/api/config/test'],
  ['GET', '/api/logs'],
  ['GET', '/api/debug/state'],
  ['POST', '/api/sonarr/add'],
  ['POST', '/api/radarr/add'],
  ['POST', '/api/queue/cancel'],
  ['GET', '/api/update/status'],
  ['POST', '/api/update/check'],
  ['POST', '/api/update/apply'],
  ['POST', '/api/remote/enable'],
  ['POST', '/api/remote/invite'],
  ['POST', '/api/download-monitor/scan'],
  ['POST', '/api/plex/pin'],
  ['POST', '/api/plex/play'],
  // Path tricks must not get around the prefix checks.
  ['GET', '/api/CONFIG'],
  ['GET', '/api//config'],
  ['GET', '/api/config/'],
  ['POST', '/api/Scrobble'],
];

for (const [method, path] of DENIED) {
  test(`demo denies ${method} ${path}`, async () => {
    const r = await call(method, path, method === 'GET' ? undefined : {});
    assert.equal(r.status, 403, `${method} ${path} -> ${r.status}`);
    assert.equal(r.json?.demo, true);
  });
}

test('demo closes /setup', async () => {
  for (const path of ['/setup', '/setup/', '/setup/index.html']) {
    const r = await call('GET', path);
    assert.equal(r.status, 403, path);
  }
});

test('playback progress and stop are acknowledged but not forwarded', async () => {
  // No Jellyfin is running at http://jellyfin:8096: if either reached the
  // adapter it would fail with 500 rather than return success.
  for (const path of ['/api/playback/progress', '/api/playback/stop']) {
    const r = await call('POST', path, { ratingKey: 'x', source: 'jellyfin', timeMs: 1000 });
    assert.equal(r.status, 200, path);
    assert.deepEqual(r.json, { success: true });
  }
});

test('selecting a profile is allowed through to its route', async () => {
  const r = await call('POST', '/api/whatson-users/does-not-exist/select', {});
  assert.notEqual(r.status, 403);
  assert.notEqual(r.json?.demo, true);
});

test('providers and health advertise demo mode', async () => {
  const p = await call('GET', '/api/auth/providers');
  assert.equal(p.status, 200);
  assert.equal(p.json.data.demo, true);
  const a = await call('GET', '/api/auth/admin-status');
  assert.equal(a.status, 200);
  const h = await call('GET', '/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.json.data.demo, true);
});

test('demoDecision covers reads, discards and the default deny', async () => {
  const { demoDecision } = await import('../src/middleware/demoGuard.js');
  assert.equal(demoDecision('GET', '/home'), 'allow');
  assert.equal(demoDecision('HEAD', '/tv/123'), 'allow');
  assert.equal(demoDecision('POST', '/playback/progress'), 'discard');
  assert.equal(demoDecision('POST', '/whatson-users/u1/select'), 'allow');
  assert.equal(demoDecision('POST', '/whatson-users/u1/select/extra'), 'deny');
  assert.equal(demoDecision('POST', '/some-future-route'), 'deny');
  assert.equal(demoDecision('PUT', '/home'), 'deny');
  assert.equal(demoDecision('GET', '/auth/providers/'), 'allow');
  assert.equal(demoDecision('GET', '/configuration'), 'allow'); // not under /config
});

test('stream proxy only accepts media paths on the configured Jellyfin origin', async () => {
  const { isProxiableTarget } = await import('../src/services/streamProxy.js');
  assert.equal(isProxiableTarget('http://jellyfin:8096/Videos/abc/master.m3u8?api_key=k'), true);
  assert.equal(isProxiableTarget('http://jellyfin:8096/videos/abc/hls1/main/0.ts'), true);
  assert.equal(isProxiableTarget('http://jellyfin:8096/Audio/abc/stream.mp3'), true);
  // Not media: the rest of the Jellyfin API stays unreachable in the demo.
  assert.equal(isProxiableTarget('http://jellyfin:8096/Users'), false);
  assert.equal(isProxiableTarget('http://jellyfin:8096/System/Info'), false);
  // Look-alike hosts and other origins.
  assert.equal(isProxiableTarget('http://jellyfin:8096.evil.example/Videos/a'), false);
  assert.equal(isProxiableTarget('http://jellyfin:8097/Videos/a'), false);
  assert.equal(isProxiableTarget('https://jellyfin:8096/Videos/a'), false);
  assert.equal(isProxiableTarget('file:///etc/passwd'), false);
  assert.equal(isProxiableTarget('not a url'), false);
});

test('rate limiter allows a burst, then refuses until it refills', async () => {
  const { RateLimiter, tierFor } = await import('../src/security/rateLimit.js');
  let now = 0;
  const rl = new RateLimiter({ t: { capacity: 3, refillPerSec: 1 } }, () => now);
  assert.equal(rl.take('ip', 't'), 0);
  assert.equal(rl.take('ip', 't'), 0);
  assert.equal(rl.take('ip', 't'), 0);
  assert.equal(rl.take('ip', 't'), 1); // empty: one second until a token
  assert.equal(rl.take('other-ip', 't'), 0); // per-IP
  now = 1000;
  assert.equal(rl.take('ip', 't'), 0);
  now = 60_000;
  rl.sweep();
  assert.equal(rl.size, 0); // fully refilled buckets are dropped
  assert.equal(tierFor('/api/stream/proxy/0.ts'), 'stream');
  assert.equal(tierFor('/api/playback/abc'), 'playback');
  assert.equal(tierFor('/api/home'), 'api');
});
