import { Router } from 'express';
import axios from 'axios';
import { config } from '../config.js';

export const debugRouter = Router();

/**
 * Raw debug endpoint — hits Sonarr/Radarr directly and returns the raw response.
 * Use this to see exactly what the APIs return.
 *
 * GET /api/debug/sonarr/series — raw series list
 * GET /api/debug/sonarr/history — raw history
 * GET /api/debug/sonarr/episode?seriesId=1 — raw episodes for a series
 * GET /api/debug/sonarr/:path — any Sonarr endpoint
 */
debugRouter.get('/debug/sonarr/*path', async (req, res) => {
  if (!config.sonarr.url) {
    res.status(400).json({ error: 'Sonarr not configured' });
    return;
  }

  const path = (req.params as any).path || (req.params as any)[0] || '';
  const url = `${config.sonarr.url}/api/v3/${path}`;

  try {
    const { data } = await axios.get(url, {
      headers: { 'X-Api-Key': config.sonarr.apiKey },
      params: req.query,
      timeout: 15000,
    });

    // Summarize arrays
    if (Array.isArray(data)) {
      res.json({
        _debug: { url, params: req.query },
        count: data.length,
        sample: data.slice(0, 3),
        sampleKeys: data.length > 0 ? Object.keys(data[0]) : [],
      });
    } else if (data && data.records) {
      res.json({
        _debug: { url, params: req.query },
        totalRecords: data.totalRecords,
        count: data.records.length,
        sample: data.records.slice(0, 3),
        sampleKeys: data.records.length > 0 ? Object.keys(data.records[0]) : [],
      });
    } else {
      res.json({ _debug: { url, params: req.query }, data });
    }
  } catch (error: any) {
    res.status(500).json({
      _debug: { url, params: req.query },
      error: error.message,
      status: error.response?.status,
      responseData: error.response?.data,
    });
  }
});
