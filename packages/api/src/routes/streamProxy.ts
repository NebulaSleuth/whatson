import { Router } from 'express';
import { handleStreamProxy } from '../services/streamProxy.js';

/**
 * Remote stream proxy route (M6). Auth-gated consumer route (the device key
 * rides as the `auth` query param so HLS players, which can't set headers on
 * segment fetches, still authenticate). See services/streamProxy.ts.
 */
export const streamProxyRouter = Router();

streamProxyRouter.get('/stream/proxy', handleStreamProxy);
