import { Router } from 'express';
import * as updater from '../services/updater.js';
import type { ApiResponse } from '@whatson/shared';

export const updateRouter = Router();

updateRouter.get('/update/status', (_req, res) => {
  const data = updater.getStatus();
  const response: ApiResponse<typeof data> = { success: true, data };
  res.json(response);
});

updateRouter.post('/update/check', async (_req, res) => {
  try {
    const data = await updater.checkForUpdate(true);
    const response: ApiResponse<typeof data> = { success: true, data };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

updateRouter.post('/update/apply', async (_req, res) => {
  try {
    const result = await updater.downloadAndApply();
    if (!result.started) {
      res.status(400).json({ success: false, error: result.reason || 'Update could not start' });
      return;
    }
    res.json({ success: true, data: { started: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});
