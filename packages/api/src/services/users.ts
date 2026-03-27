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

  const users: PlexUser[] = (res.data || []).map((u: any) => ({
    id: u.id,
    uuid: u.uuid,
    title: u.title || u.username || 'Unknown',
    username: u.username || '',
    thumb: u.thumb || '',
    admin: u.admin === true,
    guest: u.guest === true,
    restricted: u.restricted === true,
    hasPassword: u.hasPassword === true || u.protected === true,
  }));

  // Store the admin token for the admin user
  const adminUser = users.find((u) => u.admin);
  if (adminUser) {
    userTokens.set(adminUser.id, token);
  }

  return users;
}

/** Switch to a user and get their Plex token. PIN required if user has one. */
export async function selectUser(userId: number, pin?: string): Promise<string> {
  // Check if we already have this user's token cached
  const cached = userTokens.get(userId);
  if (cached) return cached;

  const token = config.plex.token;
  if (!token) throw new Error('Plex not configured');

  const body: Record<string, any> = {};
  if (pin) body.pin = pin;

  const res = await axios.post(
    `https://plex.tv/api/v2/home/users/${userId}/switch`,
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

  const userToken = res.data?.authToken;
  if (!userToken) throw new Error('Failed to get user token');

  // Cache it
  userTokens.set(userId, userToken);
  return userToken;
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
