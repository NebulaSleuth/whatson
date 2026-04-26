import { Router } from 'express';
import { promises as fs } from 'fs';
import { LOG_FILE } from '../logger.js';

export const logsRouter = Router();

/**
 * Tail the backend log file. Useful for remote diagnosis without
 * having to RDP / SSH onto the server.
 *
 * GET /api/logs                    — last 200 lines
 * GET /api/logs?lines=500          — last 500 lines (max 5000)
 * GET /api/logs?filter=plex.subs   — only lines containing the filter string
 * GET /api/logs?lines=1000&filter=ERROR
 *
 * Returns plain text. The log file path is also included in the
 * `X-Log-Path` response header.
 */
logsRouter.get('/logs', async (req, res) => {
  const linesParam = parseInt(String(req.query.lines || '200'), 10);
  const lineCount = Number.isFinite(linesParam) ? Math.max(1, Math.min(5000, linesParam)) : 200;
  const filter = typeof req.query.filter === 'string' ? req.query.filter : '';

  res.set('X-Log-Path', LOG_FILE);

  try {
    const content = await fs.readFile(LOG_FILE, 'utf-8');
    let lines = content.split(/\r?\n/);
    if (filter) {
      lines = lines.filter((l) => l.includes(filter));
    }
    const tail = lines.slice(-lineCount);
    res.type('text/plain').send(tail.join('\n'));
  } catch (err) {
    const msg = (err as Error).message;
    res
      .status(500)
      .type('text/plain')
      .send(`Failed to read log: ${msg}\nLog path: ${LOG_FILE}`);
  }
});

/**
 * Quick metadata about the log file — path + size + last-modified.
 * Lets you confirm logging is actually working before tailing.
 */
logsRouter.get('/logs/info', async (_req, res) => {
  try {
    const stat = await fs.stat(LOG_FILE);
    res.json({
      success: true,
      data: {
        path: LOG_FILE,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message, data: { path: LOG_FILE } });
  }
});
