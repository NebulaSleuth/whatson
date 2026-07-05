import { Router } from 'express';
import { handleStreamProxy } from '../services/streamProxy.js';

/**
 * Remote stream proxy route (M6). Auth-gated consumer route (the device key
 * rides as the `auth` query param so HLS players, which can't set headers on
 * segment fetches, still authenticate). See services/streamProxy.ts.
 */
export const streamProxyRouter = Router();

// The `:file` segment is cosmetic — it only carries the real extension
// (master.m3u8 / 0.ts / init.mp4) so the player detects HLS vs progressive.
// The actual upstream target is the `u` query param.
streamProxyRouter.get('/stream/proxy/:file', handleStreamProxy);
