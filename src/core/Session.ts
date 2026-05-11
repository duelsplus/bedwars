import type { PluginContext, GameEndPayload } from '@duelsplus/plugin-api';
import type { BedwarsSessionStats, GameTracker } from './types';
import type { Settings } from './Settings';
import { PREFIX, BULLET, DIVIDER } from './constants';
import { formatDuration, safeRatio } from '../util/format';
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

export class Session {
  private stats: BedwarsSessionStats;

  constructor(private ctx: PluginContext, private settings: Settings) {
    const saved = ctx.storage.get<BedwarsSessionStats>('session');
    if (saved && Date.now() - saved.startedAt < SESSION_MAX_AGE_MS) {
      this.stats = saved;
    } else {
      this.stats = this.fresh();
    }
  }

  getStats(): BedwarsSessionStats {
    return this.stats;
  }

  reset(): void {
    this.stats = this.fresh();
    this.persist();
  }

  persist(): void {
    this.ctx.storage.set('session', this.stats);
  }

  /** @param game Per-game counters from GameStatsTracker, null if tracking was lost. */
  onGameEnd(payload: GameEndPayload, game: GameTracker | null): void {
    const s = this.stats;
    s.gamesPlayed++;

    if (game) {
      s.finalKills += game.finalKills;
      s.finalDeaths += game.finalDeaths;
      s.bedsBroken += game.bedsBroken;
      s.bedsLost += game.bedsLost;
    }

    if (payload.result === 'victory') {
      s.wins++;
      s.winstreak++;
      if (s.winstreak > s.bestWinstreak) {
        s.bestWinstreak = s.winstreak;
      }

      if (this.settings.streakAlerts && s.winstreak > 1 && s.winstreak % 3 === 0) {
        this.ctx.client.sendTitle(
          `§6§l${s.winstreak} Winstreak!`,
          '§eKeep it going!',
          { fadeIn: 5, stay: 40, fadeOut: 10 },
        );
        this.ctx.client.playSound('random.levelup', 1.0, 1.5);
      }
    } else if (payload.result === 'defeat') {
      s.losses++;
      if (this.settings.streakAlerts && s.winstreak >= 3) {
        this.ctx.client.sendChat(
          `${PREFIX} §c${s.winstreak} winstreak ended. §8(§fWLR: ${getWlrColor(safeRatio(s.wins, s.losses))}§8)`,
        );
      }
      s.winstreak = 0;
    }

    this.persist();
  }

  show(): void {
    const ctx = this.ctx;
    const s = this.stats;
    if (s.gamesPlayed === 0) {
      ctx.client.sendChat(`${PREFIX} §cNo Bedwars games played this session.`);
      return;
    }

    const duration = formatDuration(Date.now() - s.startedAt);
    const wlr = safeRatio(s.wins, s.losses);
    const fkdr = safeRatio(s.finalKills, s.finalDeaths);
    const bblr = safeRatio(s.bedsBroken, s.bedsLost);

    ctx.client.sendChat(`\n${DIVIDER}`);
    ctx.client.sendChat(`${PREFIX} §6Bedwars Session §8(§7${duration}§8)`);
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
    ctx.client.sendChat(`${DIVIDER}`);
  }

  private fresh(): BedwarsSessionStats {
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
}
