import axios from 'axios';
import { config } from '../config.js';
import { PLEX_CLIENT_IDENTIFIER, PLEX_PRODUCT, APP_VERSION } from '@whatson/shared';

export interface PlexUser {
  id: number;
  uuid: string;
  title: string;        // Display name
  username: string;
  thumb: string;        // Avatar URL
  admin: boolean;
  guest: boolean;
  restricted: boolean;
  hasPassword: boolean;  // Has a PIN set
}

// Cache of user tokens: userId -> plexToken
const userTokens = new Map<number, string>();

const plexHeaders = {
  Accept: 'application/json',
  'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
  'X-Plex-Product': PLEX_PRODUCT,
  'X-Plex-Version': APP_VERSION,
};

/** List all users in the Plex Home */
export async function listUsers(): Promise<PlexUser[]> {
  const token = config.plex.token;
  if (!token) return [];

  const res = await axios.get('https://plex.tv/api/v2/home/users', {
    headers: { ...plexHeaders, 'X-Plex-Token': token },
    timeout: 10000,
  });

  const rawUsers = res.data?.users || res.data || [];
  if (!Array.isArray(rawUsers)) {
    console.warn('[Users] Unexpected response format:', typeof rawUsers);
    return [];
  }

  const users: PlexUser[] = rawUsers.map((u: any) => ({
    id: u.id,
    uuid: u.uuid,
    title: u.title || u.username || 'Unknown',
    username: u.username || '',
    thumb: u.thumb || '',
    admin: u.admin === true,
    guest: u.guest === true,
    restricted: u.restricted === true,
    hasPassword: u.protected === true,
  }));

  // Populate UUID map and store admin token
  for (const u of users) {
    userUuids.set(u.id, u.uuid);
    if (u.admin) {
      userTokens.set(u.id, token);
    }
  }

  return users;
}

// Map numeric user ID to UUID (populated by listUsers)
const userUuids = new Map<number, string>();

/** Switch to a user and get their server-specific Plex token. PIN required if user has one. */
export async function selectUser(userId: number, pin?: string): Promise<string> {
  // Check if we already have this user's token cached
  const cached = userTokens.get(userId);
  if (cached) return cached;

  const token = config.plex.token;
  if (!token) throw new Error('Plex not configured');

  // The Plex switch API requires the UUID, not the numeric ID
  let uuid = userUuids.get(userId);
  if (!uuid) {
    await listUsers();
    uuid = userUuids.get(userId);
  }
  if (!uuid) throw new Error(`Unknown user ID: ${userId}`);

  const body: Record<string, any> = {};
  if (pin) body.pin = pin;

  // Step 1: Switch to user on plex.tv — get their plex.tv auth token
  const switchRes = await axios.post(
    `https://plex.tv/api/v2/home/users/${uuid}/switch`,
    body,
    {
      headers: {
        ...plexHeaders,
        'X-Plex-Token': token,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 10000,
    },
  );

  const plexTvToken = switchRes.data?.authToken;
  if (!plexTvToken) throw new Error('Failed to get user token');

  // Step 2: Get the server-specific access token for this user
  // Managed users have a different token for each server they can access
  const serverToken = await getServerTokenForUser(plexTvToken);

  // Cache the server token (or fall back to plex.tv token)
  const finalToken = serverToken || plexTvToken;
  userTokens.set(userId, finalToken);
  console.log(`[Users] Selected user ${userId}: server token ...${finalToken.slice(-4)}`);
  return finalToken;
}

/** Get the server-specific access token by looking up resources with the user's plex.tv token */
async function getServerTokenForUser(plexTvToken: string): Promise<string | null> {
  try {
    // Get the server's machine identifier (cached from discovery)
    const { getMachineIdentifier } = await import('./plex.js');
    const machineId = await getMachineIdentifier();
    if (!machineId) return null;

    // Fetch resources with the user's token
    const res = await axios.get('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=0', {
      headers: { ...plexHeaders, 'X-Plex-Token': plexTvToken },
      timeout: 10000,
    });

    // Find the server by machine identifier
    const server = (res.data || []).find((r: any) => r.clientIdentifier === machineId);
    if (server?.accessToken) {
      return server.accessToken;
    }
    return null;
  } catch {
    return null;
  }
}

/** Get the cached token for a user, or null if not yet selected */
export function getUserToken(userId: number): string | null {
  return userTokens.get(userId) || null;
}

/** Get the admin token (for server discovery, non-user-specific operations) */
export function getAdminToken(): string {
  return config.plex.token;
}

/** Clear a user's cached token (e.g., on logout) */
export function clearUserToken(userId: number): void {
  userTokens.delete(userId);
}
