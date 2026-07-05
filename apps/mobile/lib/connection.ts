import { useAppStore } from './store';
import {
  getStoredCandidates,
  setStoredCandidates,
  getExpectedServerId,
  setExpectedServerId,
  getStoredApiUrl,
} from './storage';
import { type Candidate, raceCandidates, normalizeCandidates } from './connectionRace';

/**
 * Connection manager (M5 / docs/remote-access §2).
 *
 * Turns the single `apiUrl` into a raced, cached list of candidate backend
 * URLs. Because every request funnels through `store.apiUrl` (see lib/api.ts
 * `getBaseUrl`), the manager just races the candidates and writes the winner
 * back into that one field — no call sites change.
 *
 *  - Offline-on-LAN: the cached list is raced first, so the LAN keeps working
 *    with no internet (and no cloud).
 *  - Right-server check: each probe's `serverId` (from /api/health) is compared
 *    against the pinned expected id, rejecting a stranger's device answering on
 *    a cached LAN address (P0 finding).
 */

export type ConnectionStatus = 'connected' | 'unreachable' | 'no-candidates';

/** Pin a winning candidate as the active base URL + derive connection type. */
export function pinCandidate(candidate: Candidate): void {
  const store = useAppStore.getState();
  // Candidate URLs are base (e.g. http://host:3001); the app's apiUrl convention
  // includes the /api suffix (fetchApi does `${apiUrl}${path}`), while the racer
  // appends /api/health itself. Normalise so pinning doesn't drop /api.
  const apiUrl = candidate.url.replace(/\/+$/, '').replace(/\/api$/, '') + '/api';
  store.setApiUrl(apiUrl);
  store.setPlexConnectionType(candidate.kind === 'lan' ? 'local' : 'remote');
}

/**
 * Load cached candidates, race them, and pin the winner. Returns the outcome so
 * the UI can show a "can't reach your server" state instead of re-onboarding.
 * Falls back to the legacy single stored apiUrl when there are no candidates,
 * preserving today's behaviour for installs that predate the candidate model.
 */
export async function resolveConnection(): Promise<ConnectionStatus> {
  const [rawCandidates, expectedServerId] = await Promise.all([getStoredCandidates(), getExpectedServerId()]);
  const candidates = normalizeCandidates(rawCandidates);

  // No candidate list yet (installs predating the candidate model, or a
  // LAN-only/no-cloud setup): leave the stored single apiUrl in place and let
  // the existing init flow verify reachability. This keeps today's behaviour.
  if (candidates.length === 0) {
    return (await getStoredApiUrl()) ? 'connected' : 'no-candidates';
  }

  const winner = await raceCandidates(candidates, { expectedServerId });
  if (!winner) return 'unreachable';

  pinCandidate(winner);
  // Re-persist with the winner first so next launch tries it before the rest.
  await setStoredCandidates([winner, ...candidates.filter((c) => c.url !== winner.url)]);
  return 'connected';
}

/** Persist a fresh candidate list (e.g. from the cloud /candidates response). */
export async function updateCandidates(candidates: Candidate[], serverId: string | null): Promise<void> {
  await Promise.all([setStoredCandidates(candidates), setExpectedServerId(serverId)]);
}
