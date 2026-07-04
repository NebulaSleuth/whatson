/**
 * Behavioral tests for the pure candidate-racing logic (M5).
 *
 * Runs under Node's built-in test runner via tsx — `npm test` in this
 * workspace. No test framework dependency; the module under test is pure
 * (probe is injectable), so no native/Expo runtime is needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { raceCandidates, normalizeCandidates, type Candidate, type ProbeResult } from './connectionRace';

const C = (kind: Candidate['kind'], url: string, priority: number): Candidate => ({ kind, url, priority });
const mkProbe = (map: Record<string, ProbeResult>, delays: Record<string, number> = {}) =>
  (url: string): Promise<ProbeResult> =>
    new Promise((res) => setTimeout(() => res(map[url] ?? { ok: false, serverId: null }), delays[url] ?? 0));

test('LAN beats WAN when both healthy (head start)', async () => {
  const cands = [C('lan', 'http://lan', 0), C('wan', 'http://wan', 2)];
  const probe = mkProbe({ 'http://lan': { ok: true, serverId: 's1' }, 'http://wan': { ok: true, serverId: 's1' } });
  const w = await raceCandidates(cands, { expectedServerId: 's1', probe });
  assert.equal(w?.url, 'http://lan');
});

test('stranger on cached LAN address is rejected; correct WAN wins (P0)', async () => {
  const cands = [C('lan', 'http://lan', 0), C('wan', 'http://wan', 2)];
  const probe = mkProbe({ 'http://lan': { ok: true, serverId: 'STRANGER' }, 'http://wan': { ok: true, serverId: 's1' } });
  const w = await raceCandidates(cands, { expectedServerId: 's1', probe });
  assert.equal(w?.url, 'http://wan');
});

test('all unreachable → null', async () => {
  const cands = [C('lan', 'http://lan', 0), C('wan', 'http://wan', 2)];
  const w = await raceCandidates(cands, { expectedServerId: 's1', probe: mkProbe({}) });
  assert.equal(w, null);
});

test('only a stranger answers → null (never attach to wrong server)', async () => {
  const cands = [C('lan', 'http://lan', 0)];
  const probe = mkProbe({ 'http://lan': { ok: true, serverId: 'STRANGER' } });
  const w = await raceCandidates(cands, { expectedServerId: 's1', probe });
  assert.equal(w, null);
});

test('no expected id pinned (onboarding) → accept first healthy', async () => {
  const cands = [C('lan', 'http://lan', 0)];
  const probe = mkProbe({ 'http://lan': { ok: true, serverId: 'whatever' } });
  const w = await raceCandidates(cands, { expectedServerId: null, probe });
  assert.equal(w?.url, 'http://lan');
});

test('healthy but no serverId echo (REMOTE_ACCESS off) → accepted', async () => {
  const cands = [C('lan', 'http://lan', 0)];
  const probe = mkProbe({ 'http://lan': { ok: true, serverId: null } });
  const w = await raceCandidates(cands, { expectedServerId: 's1', probe });
  assert.equal(w?.url, 'http://lan');
});

test('LAN down → WAN wins after head start', async () => {
  const cands = [C('lan', 'http://lan', 0), C('wan', 'http://wan', 2)];
  const probe = mkProbe({ 'http://wan': { ok: true, serverId: 's1' } });
  const w = await raceCandidates(cands, { expectedServerId: 's1', probe });
  assert.equal(w?.url, 'http://wan');
});

test('empty candidate list → null', async () => {
  assert.equal(await raceCandidates([], {}), null);
});

test('normalizeCandidates drops junk and defaults priority', () => {
  const out = normalizeCandidates([
    { kind: 'lan', url: 'http://a', priority: 0 },
    { kind: 'wan', url: 'http://b' }, // missing priority → defaults to 9
    { url: 'http://c' },              // no kind → dropped
    null,
    'nope',
  ] as unknown[]);
  assert.equal(out.length, 2);
  assert.equal(out[1].priority, 9);
});
