import {
  SessionTracker,
  type PluginContext,
  type GameEndPayload,
} from '@duelsplus/plugin-api';
import type {
  BedwarsSessionState,
  BedwarsSessionStats,
  GameTracker,
} from './types';
import { SESSION_AGGREGATE_KEY } from './types';
import type { Settings } from './Settings';
import { PREFIX, BULLET, DIVIDER } from './constants';
import { formatDuration, safeRatio } from '../util/format';
import { locrawModeToBedwarsApiKey } from './modeDetection';
import {
  getWinsColorBedwars,
  getLossesColor,
  getWlrColor,
  getFinalKillsColor,
  getFkdrColor,
  getBblrColor,
  getWinstreakColor,
} from '../util/statColors';

// Sessions older than this are discarded on load.
const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function freshBucket(): BedwarsSessionStats {
  return {
    wins: 0,
    losses: 0,
    finalKills: 0,
    finalDeaths: 0,
    bedsBroken: 0,
    bedsLost: 0,
    gamesPlayed: 0,
    winstreak: 0,
    bestWinstreak: 0,
    startedAt: Date.now(),
  };
}

function freshState(): BedwarsSessionState {
  return {
    startedAt: Date.now(),
    modes: { [SESSION_AGGREGATE_KEY]: freshBucket() },
  };
}

// Back-compat: prior versions stored a single BedwarsSessionStats under the
// `session` key. If that's what's on disk, lift it into the new shape with
// the legacy data under the aggregate bucket.
function migrate(saved: unknown): BedwarsSessionState | null {
  if (!saved || typeof saved !== 'object') return null;
  const rec = saved as Record<string, unknown>;
  if (rec.modes && typeof rec.modes === 'object') {
    return saved as BedwarsSessionState;
  }
  if (typeof rec.startedAt === 'number' && typeof rec.wins === 'number') {
    const legacy = saved as BedwarsSessionStats;
    return {
      startedAt: legacy.startedAt,
      modes: { [SESSION_AGGREGATE_KEY]: { ...legacy } },
    };
  }
  return null;
}

export class Session {
  private tracker: SessionTracker<BedwarsSessionState>;

  constructor(private ctx: PluginContext, private settings: Settings) {
    // Load + migrate any legacy shape sitting in storage before handing off
    // to SessionTracker. The migration is a one-shot rewrite.
    const raw = ctx.storage.get<unknown>('session');
    const migrated = migrate(raw);
    if (migrated && migrated !== raw) {
      ctx.storage.set('session', migrated);
    }

    this.tracker = new SessionTracker<BedwarsSessionState>(ctx, {
      storageKey: 'session',
      fresh: freshState,
      maxAgeMs: SESSION_MAX_AGE_MS,
    });
  }

  /** Aggregate (all-modes) bucket; primary readout for /bwsession with no arg. */
  getStats(): BedwarsSessionStats {
    return this.bucket(SESSION_AGGREGATE_KEY);
  }

  /** Per-mode bucket. Creates an empty one on first access. */
  getStatsForMode(modeKey: string): BedwarsSessionStats {
    return this.bucket(modeKey);
  }

  reset(): void {
    this.tracker.reset();
  }

  persist(): void {
    this.tracker.persist();
  }

  /** @param game Per-game counters from GameStatsTracker, null if tracking was lost. */
  onGameEnd(payload: GameEndPayload, game: GameTracker | null): void {
    const rawMode = this.ctx.gameState.currentMode ?? payload.mode;
    const modeKey = rawMode ? locrawModeToBedwarsApiKey(rawMode) : SESSION_AGGREGATE_KEY;

    this.tracker.update((state) => {
      this.applyGameTo(state, SESSION_AGGREGATE_KEY, payload, game);
      if (modeKey !== SESSION_AGGREGATE_KEY) {
        this.applyGameTo(state, modeKey, payload, game);
      }
    });

    if (this.settings.postGameRecap) {
      this.printRecap(payload, game, modeKey);
    }
  }

  // Mutate one bucket. Winstreak alerts fire off the aggregate bucket so the
  // user only sees one notification per win even though the per-mode bucket
  // also ticks up.
  private applyGameTo(
    state: BedwarsSessionState,
    modeKey: string,
    payload: GameEndPayload,
    game: GameTracker | null,
  ): void {
    let s = state.modes[modeKey];
    if (!s) {
      s = freshBucket();
      state.modes[modeKey] = s;
    }

    s.gamesPlayed++;

    if (game) {
      s.finalKills += game.finalKills;
      s.finalDeaths += game.finalDeaths;
      s.bedsBroken += game.bedsBroken;
      s.bedsLost += game.bedsLost;
    }

    const fireAlerts = modeKey === SESSION_AGGREGATE_KEY;

    if (payload.result === 'victory') {
      s.wins++;
      s.winstreak++;
      if (s.winstreak > s.bestWinstreak) {
        s.bestWinstreak = s.winstreak;
      }

      if (fireAlerts && this.settings.streakAlerts && s.winstreak > 1 && s.winstreak % 3 === 0) {
        this.ctx.client.sendTitle(
          `§6§l${s.winstreak} Winstreak!`,
          '§eKeep it going!',
          { fadeIn: 5, stay: 40, fadeOut: 10 },
        );
        this.ctx.client.playSound('random.levelup', 1.0, 1.5);
      }
    } else if (payload.result === 'defeat') {
      s.losses++;
      if (fireAlerts && this.settings.streakAlerts && s.winstreak >= 3) {
        this.ctx.client.sendChat(
          `${PREFIX} §c${s.winstreak} winstreak ended. §8(§fWLR: ${getWlrColor(safeRatio(s.wins, s.losses))}§8)`,
        );
      }
      s.winstreak = 0;
    }
  }

  // Concise recap printed after every game end. Shows this game's deltas
  // and the post-update session totals so the player can see how the game
  // affected their session in one block.
  private printRecap(
    payload: GameEndPayload,
    game: GameTracker | null,
    modeKey: string,
  ): void {
    const ctx = this.ctx;
    const s = this.bucket(SESSION_AGGREGATE_KEY);
    const m = modeKey !== SESSION_AGGREGATE_KEY ? this.bucket(modeKey) : null;
    const duration = game
      ? formatDuration(Date.now() - game.startedAt)
      : payload.duration ? formatDuration(payload.duration) : '?';

    let resultLabel: string;
    switch (payload.result) {
      case 'victory': resultLabel = '§a§lVICTORY'; break;
      case 'defeat': resultLabel = '§c§lDEFEAT'; break;
      case 'draw': resultLabel = '§e§lDRAW'; break;
      default: resultLabel = '§7§lEND';
    }

    const gameFkdr = game ? safeRatio(game.finalKills, game.finalDeaths) : 0;
    const sessionWlr = safeRatio(s.wins, s.losses);

    ctx.client.sendChat(`\n${DIVIDER}`);
    ctx.client.sendChat(`${PREFIX} ${resultLabel} §8(§7${duration}§8)`);
    if (game) {
      ctx.client.sendChat(
        `${BULLET} §fFK: ${getFinalKillsColor(game.finalKills)}§f, §fFD: ${getLossesColor(game.finalDeaths)}§f, §fFKDR: ${getFkdrColor(gameFkdr)}`,
      );
      ctx.client.sendChat(
        `${BULLET} §fBeds: §a${game.bedsBroken}§f, §fLost: §c${game.bedsLost}`,
      );
    }
    if (m) {
      const modeWlr = safeRatio(m.wins, m.losses);
      ctx.client.sendChat(
        `${BULLET} §7${modeKey} §8» §fW: ${getWinsColorBedwars(m.wins)}§f, §fL: ${getLossesColor(m.losses)}§f, §fWLR: ${getWlrColor(modeWlr)}`,
      );
    }
    ctx.client.sendChat(
      `${BULLET} §7Session §8» §fW: ${getWinsColorBedwars(s.wins)}§f, §fL: ${getLossesColor(s.losses)}§f, §fWLR: ${getWlrColor(sessionWlr)}§f, §fCWS: ${getWinstreakColor(s.winstreak, 'current')}`,
    );
    ctx.client.sendChat(`${DIVIDER}`);
  }

  /**
   * Render the session block.
   * @param modeKey Aggregate by default; pass a locraw mode key (lowercase) or
   * an alias like `current` to view a specific bucket.
   */
  show(modeKey?: string): void {
    const ctx = this.ctx;
    const state = this.tracker.stats;

    let key = (modeKey ?? '').toLowerCase().trim();
    if (key === 'current') {
      const cur = ctx.gameState.currentMode;
      key = cur ? locrawModeToBedwarsApiKey(cur) : SESSION_AGGREGATE_KEY;
    }
    if (key === '' || key === 'all') {
      key = SESSION_AGGREGATE_KEY;
    }

    const s = state.modes[key];
    if (!s || s.gamesPlayed === 0) {
      if (key === SESSION_AGGREGATE_KEY) {
        ctx.client.sendChat(`${PREFIX} §cNo Bedwars games played this session.`);
      } else {
        ctx.client.sendChat(`${PREFIX} §cNo session games in §e${key}§c yet.`);
      }
      return;
    }

    const headerScope = key === SESSION_AGGREGATE_KEY ? 'All Modes' : key;
    const duration = formatDuration(Date.now() - state.startedAt);
    const wlr = safeRatio(s.wins, s.losses);
    const fkdr = safeRatio(s.finalKills, s.finalDeaths);
    const bblr = safeRatio(s.bedsBroken, s.bedsLost);

    ctx.client.sendChat(`\n${DIVIDER}`);
    ctx.client.sendChat(`${PREFIX} §6Bedwars Session §8(§7${headerScope}§8, §7${duration}§8)`);
    ctx.client.sendChat(`${DIVIDER}`);
    ctx.client.sendChat(
      `${BULLET} §fGames: §e${s.gamesPlayed}§f, §fW: ${getWinsColorBedwars(s.wins)}§f, §fL: ${getLossesColor(s.losses)}§f, §fWLR: ${getWlrColor(wlr)}`,
    );
    ctx.client.sendChat(
      `${BULLET} §fFK: ${getFinalKillsColor(s.finalKills)}§f, §fFD: ${getLossesColor(s.finalDeaths)}§f, §fFKDR: ${getFkdrColor(fkdr)}`,
    );
    ctx.client.sendChat(
      `${BULLET} §fBeds: §a${s.bedsBroken}§f, §fLost: §c${s.bedsLost}§f, §fBBLR: ${getBblrColor(bblr)}`,
    );
    ctx.client.sendChat(
      `${BULLET} §fCWS: ${getWinstreakColor(s.winstreak, 'current')}§f, §fBest: ${getWinstreakColor(s.bestWinstreak, 'best')}`,
    );

    if (key === SESSION_AGGREGATE_KEY) {
      // Compact per-mode breakdown under the aggregate so the user can see at
      // a glance which queues are pulling their session up or down.
      const breakdown = Object.entries(state.modes)
        .filter(([k, v]) => k !== SESSION_AGGREGATE_KEY && v.gamesPlayed > 0)
        .sort((a, b) => b[1].gamesPlayed - a[1].gamesPlayed);
      if (breakdown.length > 0) {
        ctx.client.sendChat(`${BULLET} §7Per-mode breakdown:`);
        for (const [k, v] of breakdown) {
          const mWlr = safeRatio(v.wins, v.losses);
          const mFkdr = safeRatio(v.finalKills, v.finalDeaths);
          ctx.client.sendChat(
            `  §8• §7${k}§8: §fW ${getWinsColorBedwars(v.wins)}§f L ${getLossesColor(v.losses)}§f WLR ${getWlrColor(mWlr)}§f FKDR ${getFkdrColor(mFkdr)}`,
          );
        }
      }
    }

    ctx.client.sendChat(`${DIVIDER}`);
  }

  private bucket(key: string): BedwarsSessionStats {
    const state = this.tracker.stats;
    const existing = state.modes[key];
    if (existing) return existing;
    // Read-time creation is safe because the next `update()` will persist
    // anything we touched. Keeps `getStatsForMode` from returning null.
    const fresh = freshBucket();
    state.modes[key] = fresh;
    return fresh;
  }
}
