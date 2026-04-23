import axios from 'axios';
import type { SportsCompetitor, SportsEvent, SportsStatus, SportsTeamSummary } from '@whatson/shared';
import { getCached, setCached } from '../../cache.js';
import type { LeagueMeta, SportsProvider } from './types.js';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

/** ESPN status.type.state → internal status. Any unknown state falls to 'pre'. */
function normalizeStatus(state?: string): SportsStatus {
  if (state === 'in') return 'in';
  if (state === 'post') return 'post';
  return 'pre';
}

function buildTeamCompetitor(t: any): SportsCompetitor {
  const team = t.team || {};
  return {
    id: String(team.id || ''),
    name: team.displayName || team.name || team.shortDisplayName || '',
    shortName: team.shortDisplayName || undefined,
    abbreviation: team.abbreviation || undefined,
    logo: team.logo || team.logos?.[0]?.href || undefined,
    score: t.score != null ? String(t.score) : undefined,
    homeAway: t.homeAway === 'home' || t.homeAway === 'away' ? t.homeAway : undefined,
    winner: t.winner === true,
    record: t.records?.[0]?.summary || undefined,
  };
}

function normalizeTeamEvent(e: any, league: LeagueMeta): SportsEvent {
  const c = e.competitions?.[0] || {};
  const status = c.status || e.status || {};
  const competitors = (c.competitors || []).map(buildTeamCompetitor);
  return {
    id: `${league.key}:${e.id}`,
    providerEventId: String(e.id),
    provider: 'espn',
    league: league.key,
    leagueLabel: league.label,
    sport: league.sport,
    teamSport: true,
    title: e.name || e.shortName || 'Unknown',
    subtitle: status.type?.shortDetail || undefined,
    startsAt: e.date || c.startDate || '',
    status: normalizeStatus(status.type?.state),
    statusDetail: status.type?.shortDetail || status.type?.description || '',
    competitors,
    broadcast: c.broadcasts?.[0]?.names?.[0] || c.broadcast || undefined,
    venue: c.venue?.fullName || e.venue?.fullName || undefined,
  };
}

/**
 * Tennis / golf / F1 / UFC live at the tournament level in ESPN's payload:
 * the per-match detail is nested inside `groupings[]` or `competitions[]` and
 * varies wildly by sport. We surface the tournament/race weekend as one event
 * for v1; per-match breakdown is a future iteration.
 */
function normalizeTournamentEvent(e: any, league: LeagueMeta): SportsEvent {
  const c = e.competitions?.[0];
  const status = c?.status || e.status || {};
  return {
    id: `${league.key}:${e.id}`,
    providerEventId: String(e.id),
    provider: 'espn',
    league: league.key,
    leagueLabel: league.label,
    sport: league.sport,
    teamSport: false,
    title: e.name || e.shortName || 'Unknown',
    subtitle: status.type?.shortDetail || league.label,
    startsAt: e.date || c?.startDate || '',
    status: normalizeStatus(status.type?.state),
    statusDetail: status.type?.shortDetail || status.type?.description || '',
    competitors: [],
    broadcast: c?.broadcasts?.[0]?.names?.[0] || c?.broadcast || undefined,
    venue: c?.venue?.fullName || e.venue?.fullName || undefined,
  };
}

async function fetchScoreboard(league: LeagueMeta, dateYYYYMMDD?: string): Promise<SportsEvent[]> {
  if (!league.espnPath) return [];
  const cacheKey = `sports:espn:scoreboard:${league.key}:${dateYYYYMMDD || 'today'}`;
  const cached = getCached<SportsEvent[]>(cacheKey);
  if (cached) return cached;

  try {
    const params = dateYYYYMMDD ? { dates: dateYYYYMMDD } : undefined;
    const { data } = await axios.get(`${ESPN_BASE}/${league.espnPath}/scoreboard`, { timeout: 10000, params });
    const raw = Array.isArray(data?.events) ? data.events : [];
    const normalized = raw.map((e: any) =>
      league.teamSport ? normalizeTeamEvent(e, league) : normalizeTournamentEvent(e, league),
    );
    // 30 s cache for live scoreboards; future-dated boards change far less
    // often so we can hold them longer (10 min).
    const ttl = dateYYYYMMDD ? 600 : 30;
    if (normalized.length > 0) setCached(cacheKey, normalized, ttl);
    return normalized;
  } catch (error) {
    console.warn(`[sports/espn] scoreboard ${league.key}${dateYYYYMMDD ? ' ' + dateYYYYMMDD : ''} failed:`, (error as Error).message);
    return [];
  }
}

async function fetchTeams(league: LeagueMeta): Promise<SportsTeamSummary[]> {
  if (!league.espnPath || !league.teamSport) return [];
  const cacheKey = `sports:espn:teams:${league.key}`;
  const cached = getCached<SportsTeamSummary[]>(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await axios.get(`${ESPN_BASE}/${league.espnPath}/teams`, { timeout: 10000 });
    const entries = data?.sports?.[0]?.leagues?.[0]?.teams || [];
    const teams: SportsTeamSummary[] = entries.map((entry: any) => {
      const t = entry.team || {};
      return {
        id: String(t.id || ''),
        name: t.displayName || t.name || '',
        abbreviation: t.abbreviation || undefined,
        logo: t.logos?.[0]?.href || undefined,
      };
    });
    if (teams.length > 0) setCached(cacheKey, teams, 24 * 60 * 60);
    return teams;
  } catch (error) {
    console.warn(`[sports/espn] teams ${league.key} failed:`, (error as Error).message);
    return [];
  }
}

export const espnProvider: SportsProvider = {
  name: 'espn',
  isConfigured: () => true, // ESPN needs no config — always available
  supportsLeague: (league) => Boolean(league.espnPath),
  getScoreboard: fetchScoreboard,
  getTeams: fetchTeams,
};
