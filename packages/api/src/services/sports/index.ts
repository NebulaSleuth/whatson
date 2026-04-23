import type {
  SportsEvent,
  SportsLeagueSummary,
  SportsPrefs,
  SportsTeamSummary,
} from '@whatson/shared';
import { LEAGUES, getLeague } from './leagues.js';
import { espnProvider } from './espn.js';
import { enrichEventsWithBadges } from './sportsdb.js';
import { loadPrefs, sanitizePrefs, savePrefs } from './prefs.js';
import type { LeagueMeta, SportsProvider } from './types.js';

// Provider registry — first provider in list that supports a league wins.
// ApiSports / others slot in here later; order defines precedence.
const providers: SportsProvider[] = [espnProvider];

function providerForLeague(league: LeagueMeta): SportsProvider | undefined {
  return providers.find((p) => p.isConfigured() && p.supportsLeague(league));
}

export function getLeagues(): SportsLeagueSummary[] {
  return LEAGUES.map((l) => ({
    key: l.key,
    label: l.label,
    sport: l.sport,
    teamSport: l.teamSport,
  }));
}

export async function getTeamsForLeague(leagueKey: string): Promise<SportsTeamSummary[]> {
  const meta = getLeague(leagueKey);
  if (!meta) return [];
  const provider = providerForLeague(meta);
  if (!provider) return [];
  return provider.getTeams(meta);
}

/** Keep only events the user actually follows, per prefs. */
function filterByPrefs(events: SportsEvent[], prefs: SportsPrefs): SportsEvent[] {
  const byLeague = new Map(prefs.leagues.map((p) => [p.key, p]));
  return events.filter((e) => {
    const pref = byLeague.get(e.league);
    if (!pref) return false;
    if (pref.mode === 'all' || !e.teamSport) return true;
    // Team filter: keep if any competitor id matches a followed team.
    const ids = new Set(pref.teamIds);
    return e.competitors.some((c) => ids.has(c.id));
  });
}

async function fetchFollowedEvents(prefs: SportsPrefs): Promise<SportsEvent[]> {
  // Fetch scoreboards only for leagues the user follows — avoids polling
  // ESPN's entire catalog every 60 s.
  const followed: LeagueMeta[] = prefs.leagues
    .map((p) => getLeague(p.key))
    .filter((l: LeagueMeta | undefined): l is LeagueMeta => Boolean(l));

  const results = await Promise.all(
    followed.map(async (meta) => {
      const provider = providerForLeague(meta);
      if (!provider) return [] as SportsEvent[];
      return provider.getScoreboard(meta).catch((err) => {
        console.warn(`[sports] ${meta.key} via ${provider.name} failed:`, (err as Error).message);
        return [] as SportsEvent[];
      });
    }),
  );
  const all = results.flat();
  return filterByPrefs(all, prefs);
}

export async function getNow(prefs: SportsPrefs = loadPrefs()): Promise<SportsEvent[]> {
  const all = await fetchFollowedEvents(prefs);
  const live = all.filter((e) => e.status === 'in');
  return enrichEventsWithBadges(live);
}

export async function getLater(
  hours = 24,
  prefs: SportsPrefs = loadPrefs(),
): Promise<SportsEvent[]> {
  const all = await fetchFollowedEvents(prefs);
  const horizonMs = Date.now() + hours * 60 * 60 * 1000;
  const upcoming = all
    .filter((e) => e.status === 'pre')
    .filter((e) => {
      if (!e.startsAt) return false;
      const ts = new Date(e.startsAt).getTime();
      return Number.isFinite(ts) && ts <= horizonMs;
    })
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return enrichEventsWithBadges(upcoming);
}

export async function getEvent(id: string): Promise<SportsEvent | null> {
  const [leagueKey] = id.split(':');
  const meta = getLeague(leagueKey);
  if (!meta) return null;
  const provider = providerForLeague(meta);
  if (!provider) return null;
  // For now, re-scan the league's scoreboard and pick the event by id.
  // Per-event endpoints per provider can be added when richer live detail
  // (play-by-play, box scores) is needed.
  const events = await provider.getScoreboard(meta);
  const found = events.find((e) => e.id === id) || null;
  if (!found) return null;
  const [enriched] = await enrichEventsWithBadges([found]);
  return enriched;
}

export { loadPrefs, sanitizePrefs, savePrefs };
