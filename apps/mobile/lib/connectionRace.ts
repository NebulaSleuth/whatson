/**
 * Pure candidate-racing logic (M5 / docs/remote-access §2). No store / native
 * imports, so it's unit-testable in isolation. The store-wired orchestration
 * lives in connection.ts.
 */

export type CandidateKind = 'lan' | 'wan' | 'ipv6' | 'relay';

export interface Candidate {
  kind: CandidateKind;
  url: string;
  /** Lower = preferred (lan 0, ipv6 1, wan 2, relay 3). */
  priority: number;
}

export interface ProbeResult {
  ok: boolean;
  serverId: string | null;
}

export const DEFAULT_TIMEOUT_MS = 2000;
export const LAN_HEAD_START_MS = 250;

/** Probe a single candidate: GET {url}/api/health, read the echoed serverId. */
export async function probeHealth(url: string, timeoutMs: number): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/api/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, serverId: null };
    const body = await res.json().catch(() => null);
    const serverId = body?.data?.serverId ?? body?.serverId ?? null;
    return { ok: true, serverId };
  } catch {
    return { ok: false, serverId: null };
  } finally {
    clearTimeout(timer);
  }
}

export interface RaceOptions {
  expectedServerId?: string | null;
  perCandidateTimeoutMs?: number;
  lanHeadStartMs?: number;
  /** Injectable for testing. */
  probe?: (url: string, timeoutMs: number) => Promise<ProbeResult>;
}

/**
 * Race candidates and return the winner, or null if none answer (or the only
 * answers are the wrong server). LAN candidates fire first with a head start;
 * the first candidate that answers AND passes the serverId check wins.
 */
export async function raceCandidates(candidates: Candidate[], opts: RaceOptions = {}): Promise<Candidate | null> {
  const probe = opts.probe ?? probeHealth;
  const timeout = opts.perCandidateTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headStart = opts.lanHeadStartMs ?? LAN_HEAD_START_MS;
  const expected = opts.expectedServerId ?? null;

  const sorted = [...candidates].sort((a, b) => a.priority - b.priority);
  if (sorted.length === 0) return null;

  return new Promise<Candidate | null>((resolve) => {
    let settled = false;
    let pending = sorted.length;
    const done = (c: Candidate | null) => {
      if (!settled) {
        settled = true;
        resolve(c);
      }
    };

    const fire = (c: Candidate) => {
      probe(c.url, timeout).then((r) => {
        pending--;
        if (settled) return;
        // Accept only a healthy response whose serverId matches (when both the
        // expected id and the echoed id are present). A mismatch = wrong server.
        const accept = r.ok && (!expected || !r.serverId || r.serverId === expected);
        if (accept) done(c);
        else if (pending === 0) done(null);
      });
    };

    const lan = sorted.filter((c) => c.kind === 'lan');
    const rest = sorted.filter((c) => c.kind !== 'lan');

    if (lan.length > 0) {
      lan.forEach(fire);
      if (rest.length > 0) {
        setTimeout(() => {
          if (!settled) rest.forEach(fire);
        }, headStart);
      }
    } else {
      rest.forEach(fire);
    }

    // Overall safety net.
    setTimeout(() => done(null), timeout + headStart + 500);
  });
}

export function normalizeCandidates(raw: unknown[] | null): Candidate[] {
  if (!Array.isArray(raw)) return [];
  const out: Candidate[] = [];
  for (const c of raw) {
    const o = c as Partial<Candidate>;
    if (o && typeof o.url === 'string' && typeof o.kind === 'string') {
      out.push({ kind: o.kind as CandidateKind, url: o.url, priority: typeof o.priority === 'number' ? o.priority : 9 });
    }
  }
  return out;
}
