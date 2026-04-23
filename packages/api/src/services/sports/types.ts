import type { SportsEvent, SportsTeamSummary } from '@whatson/shared';

/**
 * Static metadata about a league we know how to fetch for.
 * Providers claim leagues via `supportsLeague(key)`.
 */
export interface LeagueMeta {
  key: string;
  label: string;
  sport: string;
  teamSport: boolean;
  /** ESPN path fragment, e.g. "basketball/nba". Present when ESPN covers the league. */
  espnPath?: string;
  /** Name used by TheSportsDB for team lookups, e.g. "Soccer". */
  sportsDbSport?: string;
}

/**
 * Uniform interface over sports data providers (ESPN, API-Sports, ...).
 * Providers are consulted in registry order; the first one that supports a
 * given league wins. Enrichment (team badges) happens after normalization.
 */
export interface SportsProvider {
  readonly name: string;
  isConfigured(): boolean;
  supportsLeague(league: LeagueMeta): boolean;
  /**
   * Fetch the scoreboard for a league. `dateYYYYMMDD` is optional — when
   * omitted, providers return today's events. Callers fetch multiple dates
   * to cover a time window that crosses a UTC day boundary.
   */
  getScoreboard(league: LeagueMeta, dateYYYYMMDD?: string): Promise<SportsEvent[]>;
  getTeams(league: LeagueMeta): Promise<SportsTeamSummary[]>;
}
