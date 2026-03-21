import axios from 'axios';
import { config } from '../config.js';
import { PLEX_CLIENT_IDENTIFIER, PLEX_PRODUCT, APP_VERSION } from '@whatson/shared';
import { getServerUrl, getMachineIdentifier } from './plex.js';

interface PlexClient {
  name: string;
  host: string;
  port: number;
  address: string;
  machineIdentifier: string;
  protocol: string;
  product: string;
  platform: string;
  protocolCapabilities: string;
}

/**
 * Get available Plex clients/players that can receive playback commands.
 */
export async function getClients(): Promise<PlexClient[]> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) return [];

  try {
    const { data } = await axios.get(`${serverUrl}/clients`, {
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': config.plex.token,
        'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
      },
      timeout: 5000,
    });

    const clients = data?.MediaContainer?.Server || [];
    return clients.map((c: any) => ({
      name: c.name,
      host: c.host,
      port: c.port,
      address: c.address,
      machineIdentifier: c.machineIdentifier,
      protocol: c.protocol || 'http',
      product: c.product,
      platform: c.platform,
      protocolCapabilities: c.protocolCapabilities || '',
    }));
  } catch {
    return [];
  }
}

/**
 * Get available Plex sessions/resources from plex.tv (includes remote clients).
 */
export async function getResources(): Promise<PlexClient[]> {
  try {
    const { data } = await axios.get('https://plex.tv/api/v2/resources', {
      params: { includeHttps: 1 },
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': config.plex.token,
        'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
      },
      timeout: 10000,
    });

    // Filter to player clients (not servers)
    return data
      .filter((r: any) => r.provides?.includes('player'))
      .map((r: any) => {
        const conn = r.connections?.[0];
        return {
          name: r.name,
          host: conn?.address || '',
          port: conn?.port || 32433,
          address: conn?.address || '',
          machineIdentifier: r.clientIdentifier,
          protocol: conn?.protocol || 'http',
          product: r.product,
          platform: r.platform || '',
          protocolCapabilities: r.provides || '',
        };
      });
  } catch {
    return [];
  }
}

/**
 * Tell a Plex client to play a specific item.
 * Uses the Plex client control API.
 */
export async function playOnClient(
  clientId: string,
  ratingKey: string,
): Promise<boolean> {
  const serverUrl = await getServerUrl();
  const machineId = await getMachineIdentifier();
  if (!serverUrl || !machineId) return false;

  // Get all available clients
  const [localClients, remoteClients] = await Promise.all([
    getClients(),
    getResources(),
  ]);

  const allClients = [...localClients, ...remoteClients];
  const client = allClients.find((c) => c.machineIdentifier === clientId);

  if (!client) {
    console.log(`[Plex] Client ${clientId} not found. Available:`, allClients.map((c) => `${c.name} (${c.machineIdentifier})`));
    return false;
  }

  // Send playback command via the server's player control endpoint
  try {
    const playUrl = `${serverUrl}/player/playback/playMedia`;
    await axios.get(playUrl, {
      params: {
        key: `/library/metadata/${ratingKey}`,
        machineIdentifier: machineId,
        address: serverUrl.replace(/^https?:\/\//, '').replace(/:\d+$/, ''),
        port: new URL(serverUrl).port || '32400',
        protocol: new URL(serverUrl).protocol.replace(':', ''),
        'X-Plex-Target-Client-Identifier': clientId,
      },
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': config.plex.token,
        'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
        'X-Plex-Product': PLEX_PRODUCT,
        'X-Plex-Version': APP_VERSION,
      },
      timeout: 10000,
    });

    console.log(`[Plex] Sent play command to "${client.name}" for ratingKey ${ratingKey}`);
    return true;
  } catch (error) {
    console.error(`[Plex] Failed to play on client:`, (error as Error).message);
    return false;
  }
}
