import { Router } from 'express';
import * as monitor from '../services/downloadMonitor.js';
import type { ApiResponse } from '@whatson/shared';

/**
 * Download monitor admin surface (LAN + owner only, see server/surface.ts).
 *   GET  /download-monitor/status          config + last sweep + watched items + history
 *   POST /download-monitor/scan            run a sweep now (honours the dry-run setting)
 *   POST /download-monitor/scan?dryRun=1   preview only — never removes anything
 */
export const downloadMonitorRouter = Router();

downloadMonitorRouter.get('/download-monitor/status', (_req, res) => {
  const data = monitor.getStatus();
  const response: ApiResponse<typeof data> = { success: true, data };
  res.json(response);
});

downloadMonitorRouter.post('/download-monitor/scan', async (req, res) => {
  try {
    const preview = req.query.dryRun === '1' || req.query.dryRun === 'true' || req.body?.dryRun === true;
    const result = await monitor.runSweep(preview ? { dryRun: true } : {});
    const data = { result, status: monitor.getStatus() };
    const response: ApiResponse<typeof data> = { success: true, data };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});
