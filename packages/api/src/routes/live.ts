import { Router } from 'express';
import * as liveTv from '../services/liveTv.js';
import { config } from '../config.js';
import type { ApiResponse, ContentItem } from '@whatson/shared';

export const liveRouter = Router();

function parseChannels(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

liveRouter.get('/live/channels', async (req, res) => {
  try {
    const country = (req.query.country as string) || config.epg.country || 'US';
    const channels = await liveTv.getChannels(country);
    const response: ApiResponse<string[]> = { success: true, data: channels };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

liveRouter.get('/live/now', async (req, res) => {
  try {
    const channels = parseChannels(req.query.channels);
    const country = (req.query.country as string) || config.epg.country || 'US';
    const items = await liveTv.getOnNow(channels, country);
    const response: ApiResponse<ContentItem[]> = { success: true, data: items };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

liveRouter.get('/live/later', async (req, res) => {
  try {
    const channels = parseChannels(req.query.channels);
    const country = (req.query.country as string) || config.epg.country || 'US';
    const hours = Math.max(1, Math.min(24, parseInt((req.query.hours as string) || '6', 10) || 6));
    const items = await liveTv.getOnLater(channels, country, hours);
    const response: ApiResponse<ContentItem[]> = { success: true, data: items };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});
