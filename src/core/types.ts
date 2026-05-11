export interface RowModel {
  username: string;
  wins: number;
  losses: number;
  wlr: number;
  fkdr: number;
  finalKills: number;
  finalDeaths: number;
  stars: number;
  /** Current winstreak in the active mode, falls back to overall when the mode is empty. */
  winstreak: number;
  nicked: boolean;
  usedOverallFallback: boolean;
  severity: number;
}

export interface GameTracker {
  finalKills: number;
  finalDeaths: number;
  bedsBroken: number;
  bedsLost: number;
  kills: number;
  deaths: number;
  startedAt: number;
}

export interface BedwarsSessionStats {
  wins: number;
  losses: number;
  finalKills: number;
  finalDeaths: number;
  bedsBroken: number;
  bedsLost: number;
  gamesPlayed: number;
  winstreak: number;
  bestWinstreak: number;
  startedAt: number;
}
