import { DEFAULT_CLOUD_URL } from '@whatson/shared';
import { useAppStore } from './store';
import { setStoredAuthKey } from './storage';
import { updateCandidates, pinCandidate } from './connection';
import { normalizeCandidates, raceCandidates, type Candidate } from './connectionRace';

/**
 * "Sign in with Whats On" — cloud device-code onboarding (M7). Lets a device
 * that was NEVER on the server's LAN connect from anywhere: it asks the cloud
 * for a short code, the owner approves it at whatsontv.net/link, and the cloud
 * returns a signed grant + the server's connection candidates. The device then
 * reaches the server (racing the candidates — the WAN one when remote) and
 * redeems the grant for its own device auth key. No LAN, no server URL typing.
 */

const CLOUD = DEFAULT_CLOUD_URL;

export interface DeviceCodeStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
}

export async function startDeviceCode(): Promise<DeviceCodeStart> {
  const res = await fetch(`${CLOUD}/api/device-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Could not start sign-in (HTTP ${res.status})`);
  return res.json();
}

interface ServerCandidatesWire {
  serverId: string;
  candidates: unknown[];
}
export type PollResult =
  | { status: 'pending' }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'approved'; grant: string; candidates: ServerCandidatesWire; cloudToken?: string };

/** How a guest's in-app profile is decided (mirrors the backend GuestBinding). */
export type GuestBinding = 'locked' | 'locked-new' | 'open';

export interface RedeemResult {
  ok: boolean;
  /** Only meaningful for guest devices; undefined for owners. */
  guestBinding?: GuestBinding;
  /** Admin-suggested name to prefill the new-viewer form (locked-new). */
  newUserName?: string | null;
}

// Stashed after a successful redeem so the create-profile screen can report the
// WO user it makes back to the cloud (binds a locked-new guest's other devices).
let pendingBackfill: { serverId: string; cloudToken: string } | null = null;

export async function pollDeviceCode(deviceCode: string): Promise<PollResult> {
  const res = await fetch(`${CLOUD}/api/device-code/poll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceCode }),
  });
  if (res.status === 400) return { status: 'expired' };
  return res.json();
}

/**
 * After approval: cache the server's candidates, race to actually reach it,
 * redeem the grant for a device auth key, and pin the winning connection.
 * Returns false if the server can't be reached from this network (e.g. the
 * owner hasn't opened remote access / the port isn't reachable from here).
 */
export async function redeemGrantViaCandidates(
  grant: string,
  sc: ServerCandidatesWire,
  cloudToken?: string,
): Promise<RedeemResult> {
  const cands: Candidate[] = normalizeCandidates(sc.candidates);
  await updateCandidates(cands, sc.serverId);

  const winner = await raceCandidates(cands, { expectedServerId: sc.serverId });
  if (!winner) return { ok: false };

  const res = await fetch(`${winner.url}/api/auth/redeem-grant`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success || !body?.data?.key) return { ok: false };

  await setStoredAuthKey(body.data.key);
  useAppStore.getState().setAuthKey(body.data.key);
  pinCandidate(winner); // sets apiUrl (+ /api) + connection type

  pendingBackfill = cloudToken ? { serverId: sc.serverId, cloudToken } : null;
  return {
    ok: true,
    guestBinding: body.data.guestBinding,
    newUserName: body.data.newUserName ?? null,
  };
}

/**
 * Report the Whats On user a 'locked-new' guest just created back to the cloud,
 * so the guest's OTHER devices bind to the same profile. Best-effort — a failure
 * only means multi-device guests might re-create a profile, never blocks login.
 */
export async function reportGuestProfileToCloud(woProfileId: string): Promise<void> {
  const ctx = pendingBackfill;
  if (!ctx) return;
  try {
    await fetch(`${CLOUD}/api/servers/${ctx.serverId}/membership/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.cloudToken}` },
      body: JSON.stringify({ boundWoProfileId: woProfileId }),
    });
  } catch {
    /* best-effort */
  }
}
