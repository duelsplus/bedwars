export interface RowModel {
  username: string;
  /** Hypixel UUID when the API returned stats; null for nicked players. */
  uuid: string | null;
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

export interface RivalryEntry {
  /** Games where we won while this player was in the lobby. */
  wins: number;
  /** Games where we lost while this player was in the lobby. */
  losses: number;
  /** Total games this player shared a lobby with us. */
  gamesShared: number;
  /** Last `Date.now()` we shared a lobby with them. */
  lastSeen: number;
}

export type RivalryStore = Record<string, RivalryEntry>;

export interface MapStatsEntry {
  wins: number;
  losses: number;
  finalKills: number;
  finalDeaths: number;
  bedsBroken: number;
  bedsLost: number;
  gamesPlayed: number;
  lastPlayed: number;
}

export type MapStatsStore = Record<string, MapStatsEntry>;
