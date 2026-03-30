import { Router } from 'express';
import { getHomeData } from '../services/aggregator.js';
import { invalidateAll } from '../cache.js';
import type { ApiResponse, HomeResponse } from '@whatson/shared';

export const homeRouter = Router();

homeRouter.get('/home', async (req, res) => {
  try {
    if (req.query.refresh === 'true') {
      invalidateAll();
    }
    const data = await getHomeData(req.plexUserToken);
    const response: ApiResponse<HomeResponse> = { success: true, data };
    res.json(response);
  } catch (error) {
    const response: ApiResponse<HomeResponse> = {
      success: false,
      error: (error as Error).message,
    };
    res.status(500).json(response);
  }
});
