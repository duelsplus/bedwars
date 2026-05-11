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

// Top-level session container. Holds one bucket per mode key (lowercase
// locraw mode) plus the wall-clock `startedAt` used for the global session
// TTL.
export interface BedwarsSessionState {
  startedAt: number;
  /** Mode-key → bucket; the special key `__all__` is the cross-mode aggregate. */
  modes: Record<string, BedwarsSessionStats>;
}

export const SESSION_AGGREGATE_KEY = '__all__';
