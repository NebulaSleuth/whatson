import type { LeagueMeta } from './types.js';

/**
 * Supported leagues. `teamSport: false` means team-filter is not applicable —
 * the UI must force mode='all' on prefs for these entries.
 *
 * `espnPath` is the site.api.espn.com path fragment used for both scoreboard
 * and teams endpoints. Omit to opt a league out of ESPN coverage (rare).
 */
export const LEAGUES: LeagueMeta[] = [
  // US team sports
  { key: 'nfl', label: 'NFL', sport: 'football', teamSport: true, espnPath: 'football/nfl', sportsDbSport: 'American Football' },
  { key: 'nba', label: 'NBA', sport: 'basketball', teamSport: true, espnPath: 'basketball/nba', sportsDbSport: 'Basketball' },
  { key: 'wnba', label: 'WNBA', sport: 'basketball', teamSport: true, espnPath: 'basketball/wnba', sportsDbSport: 'Basketball' },
  { key: 'mlb', label: 'MLB', sport: 'baseball', teamSport: true, espnPath: 'baseball/mlb', sportsDbSport: 'Baseball' },
  { key: 'nhl', label: 'NHL', sport: 'hockey', teamSport: true, espnPath: 'hockey/nhl', sportsDbSport: 'Ice Hockey' },
  { key: 'ncaa-fb', label: 'NCAA Football', sport: 'football', teamSport: true, espnPath: 'football/college-football' },
  { key: 'ncaa-mbb', label: "NCAA Men's Basketball", sport: 'basketball', teamSport: true, espnPath: 'basketball/mens-college-basketball' },
  { key: 'ncaa-wbb', label: "NCAA Women's Basketball", sport: 'basketball', teamSport: true, espnPath: 'basketball/womens-college-basketball' },

  // Soccer
  { key: 'mls', label: 'MLS', sport: 'soccer', teamSport: true, espnPath: 'soccer/usa.1', sportsDbSport: 'Soccer' },
  { key: 'epl', label: 'Premier League', sport: 'soccer', teamSport: true, espnPath: 'soccer/eng.1', sportsDbSport: 'Soccer' },
  { key: 'laliga', label: 'La Liga', sport: 'soccer', teamSport: true, espnPath: 'soccer/esp.1', sportsDbSport: 'Soccer' },
  { key: 'bundesliga', label: 'Bundesliga', sport: 'soccer', teamSport: true, espnPath: 'soccer/ger.1', sportsDbSport: 'Soccer' },
  { key: 'serie-a', label: 'Serie A', sport: 'soccer', teamSport: true, espnPath: 'soccer/ita.1', sportsDbSport: 'Soccer' },
  { key: 'ligue-1', label: 'Ligue 1', sport: 'soccer', teamSport: true, espnPath: 'soccer/fra.1', sportsDbSport: 'Soccer' },
  { key: 'ucl', label: 'Champions League', sport: 'soccer', teamSport: true, espnPath: 'soccer/uefa.champions', sportsDbSport: 'Soccer' },
  { key: 'uel', label: 'Europa League', sport: 'soccer', teamSport: true, espnPath: 'soccer/uefa.europa', sportsDbSport: 'Soccer' },

  // Individual / tournament sports — teamSport: false forces mode='all'
  { key: 'atp', label: 'ATP Tour', sport: 'tennis', teamSport: false, espnPath: 'tennis/atp' },
  { key: 'wta', label: 'WTA Tour', sport: 'tennis', teamSport: false, espnPath: 'tennis/wta' },
  { key: 'f1', label: 'Formula 1', sport: 'racing', teamSport: false, espnPath: 'racing/f1' },
  { key: 'nascar', label: 'NASCAR Cup', sport: 'racing', teamSport: false, espnPath: 'racing/nascar-premier' },
  { key: 'pga', label: 'PGA Tour', sport: 'golf', teamSport: false, espnPath: 'golf/pga' },
  { key: 'lpga', label: 'LPGA', sport: 'golf', teamSport: false, espnPath: 'golf/lpga' },
  { key: 'ufc', label: 'UFC', sport: 'mma', teamSport: false, espnPath: 'mma/ufc' },
];

const BY_KEY = new Map(LEAGUES.map((l) => [l.key, l]));

export function getLeague(key: string): LeagueMeta | undefined {
  return BY_KEY.get(key);
}
