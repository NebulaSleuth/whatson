import { Router } from 'express';
import type { ApiResponse, SportsEvent, SportsLeagueSummary, SportsPrefs, SportsTeamSummary } from '@whatson/shared';
import {
  getLeagues,
  getTeamsForLeague,
  getNow,
  getLater,
  getEvent,
  loadPrefs,
  savePrefs,
} from '../services/sports/index.js';
import { notifyDataChanged } from '../ws.js';

export const sportsRouter = Router();

/** List leagues supported by the server — drives the Settings picker. */
sportsRouter.get('/sports/leagues', (_req, res) => {
  const response: ApiResponse<SportsLeagueSummary[]> = { success: true, data: getLeagues() };
  res.json(response);
});

/** Teams for a given league — drives per-league team favouriting. */
sportsRouter.get('/sports/teams', async (req, res) => {
  try {
    const league = (req.query.league as string) || '';
    if (!league) {
      res.status(400).json({ success: false, error: 'league query param required' });
      return;
    }
    const teams = await getTeamsForLeague(league);
    const response: ApiResponse<SportsTeamSummary[]> = { success: true, data: teams };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Sports On Now — currently in-progress events matching user's follows. */
sportsRouter.get('/sports/now', async (_req, res) => {
  try {
    const events = await getNow();
    const response: ApiResponse<SportsEvent[]> = { success: true, data: events };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Sports On Later — upcoming events within the next N hours. */
sportsRouter.get('/sports/later', async (req, res) => {
  try {
    const hours = req.query.hours ? parseInt(req.query.hours as string, 10) : 24;
    const events = await getLater(Number.isFinite(hours) && hours > 0 ? hours : 24);
    const response: ApiResponse<SportsEvent[]> = { success: true, data: events };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Single event detail — for the live-status screen. */
sportsRouter.get('/sports/event/:id', async (req, res) => {
  try {
    const event = await getEvent(req.params.id);
    if (!event) {
      res.status(404).json({ success: false, error: 'Event not found' });
      return;
    }
    const response: ApiResponse<SportsEvent> = { success: true, data: event };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Read current follows. */
sportsRouter.get('/sports/prefs', (_req, res) => {
  const response: ApiResponse<SportsPrefs> = { success: true, data: loadPrefs() };
  res.json(response);
});

/** Update follows — body is SportsPrefs; non-team sports are forced to mode='all'. */
sportsRouter.put('/sports/prefs', (req, res) => {
  try {
    const saved = savePrefs(req.body);
    notifyDataChanged('sports-prefs', 'sports-now', 'sports-later');
    const response: ApiResponse<SportsPrefs> = { success: true, data: saved };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});
