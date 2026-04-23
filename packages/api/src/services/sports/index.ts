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

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

async function fetchFollowedEvents(prefs: SportsPrefs): Promise<SportsEvent[]> {
  // Fetch scoreboards only for leagues the user follows — avoids polling
  // ESPN's entire catalog every 60 s.
  const followed: LeagueMeta[] = prefs.leagues
    .map((p) => getLeague(p.key))
    .filter((l: LeagueMeta | undefined): l is LeagueMeta => Boolean(l));

  // ESPN's "default" scoreboard returns today in US-Eastern, and `dates=`
  // params map to ET days too — not UTC. So `no-date` + `today-UTC-yyyymmdd`
  // + `tomorrow-UTC-yyyymmdd` effectively gives us today-ET, tomorrow-ET,
  // and day-after-ET (UTC is always ≥ ET, so UTC today's yyyymmdd maps to
  // ET tomorrow's day). That covers any 24 h "later" window plus a buffer.
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const dates: (string | undefined)[] = [undefined, yyyymmdd(today), yyyymmdd(tomorrow)];

  const results = await Promise.all(
    followed.flatMap((meta) =>
      dates.map(async (date) => {
        const provider = providerForLeague(meta);
        if (!provider) return [] as SportsEvent[];
        return provider.getScoreboard(meta, date).catch((err: Error) => {
          console.warn(`[sports] ${meta.key}${date ? ' ' + date : ''} via ${provider.name} failed:`, err.message);
          return [] as SportsEvent[];
        });
      }),
    ),
  );
  const all = results.flat();
  // Dedupe across today/tomorrow — the same event can appear in both when
  // it sits close to the UTC boundary.
  const seen = new Set<string>();
  const deduped = all.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  return filterByPrefs(deduped, prefs);
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
  // Scan the same ET-day window the list endpoints use so a card tapped
  // from the "Later" shelf for tomorrow's or day-after's game resolves.
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const boards = await Promise.all([
    provider.getScoreboard(meta).catch(() => []),
    provider.getScoreboard(meta, yyyymmdd(today)).catch(() => []),
    provider.getScoreboard(meta, yyyymmdd(tomorrow)).catch(() => []),
  ]);
  const found = boards.flat().find((e) => e.id === id) || null;
  if (!found) return null;
  const [enriched] = await enrichEventsWithBadges([found]);
  return enriched;
}

export { loadPrefs, sanitizePrefs, savePrefs };
