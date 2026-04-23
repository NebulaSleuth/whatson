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

/**
 * Keep only events the user actually follows, and stamp `isFollowed` on
 * competitors that match the user's team-id list so the card can pick the
 * right brand color for the "my team" accent bar.
 */
function filterByPrefs(events: SportsEvent[], prefs: SportsPrefs): SportsEvent[] {
  const byLeague = new Map(prefs.leagues.map((p) => [p.key, p]));
  const out: SportsEvent[] = [];
  for (const e of events) {
    const pref = byLeague.get(e.league);
    if (!pref) continue;
    const followedIds = new Set(pref.mode === 'teams' ? pref.teamIds : []);
    if (!(pref.mode === 'all' || !e.teamSport || e.competitors.some((c) => followedIds.has(c.id)))) {
      continue;
    }
    // Clone competitors so we don't mutate the provider's cached array.
    const competitors = e.competitors.map((c) => ({ ...c, isFollowed: followedIds.has(c.id) }));
    out.push({ ...e, competitors });
  }
  return out;
}

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

async function fetchFollowedEvents(
  prefs: SportsPrefs,
  horizonHours = 48,
): Promise<SportsEvent[]> {
  // Fetch scoreboards only for leagues the user follows — avoids polling
  // ESPN's entire catalog every 60 s.
  const followed: LeagueMeta[] = prefs.leagues
    .map((p) => getLeague(p.key))
    .filter((l: LeagueMeta | undefined): l is LeagueMeta => Boolean(l));

  // ESPN's "default" scoreboard returns today in US-Eastern, and `dates=`
  // params map to ET days too — not UTC. We fetch `no-date` (today ET) plus
  // a UTC yyyymmdd for every day in the horizon window. UTC is always ≥ ET,
  // so today-UTC's yyyymmdd maps to ET-tomorrow — giving us broad coverage
  // without needing explicit ET-date math. Cache is per-date so repeated
  // fetches within TTL are free.
  const now = new Date();
  const dayCount = Math.max(2, Math.ceil(horizonHours / 24) + 1);
  const dates: (string | undefined)[] = [undefined];
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    dates.push(yyyymmdd(d));
  }

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
  // 168 h (7 days) is the shelf's default window — long enough to see the
  // week's upcoming slate for each followed league without forcing the user
  // to scroll past yesterday's tomorrow. Callers can override via `?hours=N`.
  hours = 168,
  prefs: SportsPrefs = loadPrefs(),
): Promise<SportsEvent[]> {
  const all = await fetchFollowedEvents(prefs, hours);
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
  // Scan the full later-window ET-day range so a card tapped from "Later"
  // resolves no matter how far out the game is.
  const now = new Date();
  const boards: Promise<SportsEvent[]>[] = [provider.getScoreboard(meta).catch(() => [])];
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    boards.push(provider.getScoreboard(meta, yyyymmdd(d)).catch(() => []));
  }
  const resolved = await Promise.all(boards);
  const found = resolved.flat().find((e) => e.id === id) || null;
  if (!found) return null;
  const [enriched] = await enrichEventsWithBadges([found]);
  return enriched;
}

export { loadPrefs, sanitizePrefs, savePrefs };
