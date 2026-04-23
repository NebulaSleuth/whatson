import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { SportsLeaguePref, SportsPrefs } from '@whatson/shared';
import { getLeague } from './leagues.js';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
function prefsFile(): string { return join(DATA_DIR, 'sports.json'); }

function ensureDir(): void {
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

function defaultPrefs(): SportsPrefs {
  return { leagues: [] };
}

export function loadPrefs(): SportsPrefs {
  try {
    const f = prefsFile();
    if (!existsSync(f)) return defaultPrefs();
    const parsed = JSON.parse(readFileSync(f, 'utf-8')) as SportsPrefs;
    if (!parsed || !Array.isArray(parsed.leagues)) return defaultPrefs();
    return parsed;
  } catch (err) {
    console.warn('[sports/prefs] load failed, using defaults:', (err as Error).message);
    return defaultPrefs();
  }
}

/**
 * Normalise incoming prefs: drop unknown leagues, force mode='all' on
 * non-team sports, clear teamIds when mode='all'. Prevents invalid state
 * (e.g. "follow specific tennis teams") from being persisted.
 */
export function sanitizePrefs(input: unknown): SportsPrefs {
  const raw = (input as Partial<SportsPrefs>) || {};
  const leagues = Array.isArray(raw.leagues) ? raw.leagues : [];
  const cleaned: SportsLeaguePref[] = [];
  for (const entry of leagues) {
    if (!entry || typeof entry.key !== 'string') continue;
    const meta = getLeague(entry.key);
    if (!meta) continue;
    const mode = !meta.teamSport ? 'all' : entry.mode === 'all' ? 'all' : 'teams';
    const teamIds = mode === 'teams' && Array.isArray(entry.teamIds)
      ? entry.teamIds.filter((t: unknown): t is string => typeof t === 'string' && t.length > 0)
      : [];
    cleaned.push({ key: meta.key, mode, teamIds });
  }
  return { leagues: cleaned };
}

export function savePrefs(prefs: SportsPrefs): SportsPrefs {
  const clean = sanitizePrefs(prefs);
  ensureDir();
  writeFileSync(prefsFile(), JSON.stringify(clean, null, 2), 'utf-8');
  return clean;
}
