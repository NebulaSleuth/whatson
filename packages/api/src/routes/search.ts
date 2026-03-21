import { Router } from 'express';
import { searchAll } from '../services/aggregator.js';
import type { ApiResponse, SearchResponse } from '@whatson/shared';

export const searchRouter = Router();

searchRouter.get('/search', async (req, res) => {
  try {
    const query = req.query.q as string;
    const type = req.query.type as 'tv' | 'movie' | undefined;

    if (!query || query.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Query parameter "q" is required' });
      return;
    }

    const results = await searchAll(query.trim(), type);
    const data: SearchResponse = {
      results,
      query: query.trim(),
      total: results.length,
    };
    const response: ApiResponse<SearchResponse> = { success: true, data };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});
