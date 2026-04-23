import axios from 'axios';
import type { SportsEvent } from '@whatson/shared';
import { getCached, setCached } from '../../cache.js';

/**
 * TheSportsDB enrichment helpers. Free tier (API key "3") no longer serves
 * live scores, but team badge lookup still works and is more reliable than
 * ESPN's logo URL for some international leagues.
 *
 * This module is best-effort: every call is wrapped so a SportsDB outage
 * cannot degrade the primary ESPN path.
 */

const SPORTSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/3';

interface SportsDbTeam {
  idTeam: string;
  strTeam: string;
  strBadge?: string;
  strLogo?: string;
}

async function searchTeamBadge(name: string): Promise<string | undefined> {
  if (!name) return undefined;
  const cacheKey = `sports:sdb:badge:${name.toLowerCase()}`;
  const cached = getCached<string>(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await axios.get<{ teams: SportsDbTeam[] | null }>(
      `${SPORTSDB_BASE}/searchteams.php`,
      { params: { t: name }, timeout: 8000 },
    );
    const badge = data?.teams?.[0]?.strBadge || data?.teams?.[0]?.strLogo || undefined;
    if (badge) setCached(cacheKey, badge, 7 * 24 * 60 * 60); // 1 week
    return badge;
  } catch {
    return undefined;
  }
}

/**
 * Fill in missing competitor logos on a list of events using SportsDB badges.
 * Each unique team name is looked up at most once per cache window.
 */
export async function enrichEventsWithBadges(events: SportsEvent[]): Promise<SportsEvent[]> {
  const needLookup = new Set<string>();
  for (const e of events) {
    if (!e.teamSport) continue;
    for (const c of e.competitors) {
      if (!c.logo && c.name) needLookup.add(c.name);
    }
  }
  if (needLookup.size === 0) return events;

  // Parallel lookups — cache absorbs duplicates across calls.
  const names = [...needLookup];
  const badges = await Promise.all(names.map((n) => searchTeamBadge(n).catch(() => undefined)));
  const map = new Map<string, string>();
  names.forEach((n, i) => { const b = badges[i]; if (b) map.set(n, b); });

  if (map.size === 0) return events;

  return events.map((e) => {
    if (!e.teamSport) return e;
    const filled = e.competitors.map((c) =>
      c.logo || !c.name || !map.has(c.name) ? c : { ...c, logo: map.get(c.name) },
    );
    return { ...e, competitors: filled };
  });
}
