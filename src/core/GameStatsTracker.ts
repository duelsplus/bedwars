import type { PluginContext } from '@duelsplus/plugin-api';
import type { GameTracker } from './types';
import type { Settings } from './Settings';
import type { RosterManager } from './RosterManager';
import { PREFIX, BULLET, DIVIDER } from './constants';
import { formatDuration, safeRatio } from '../util/format';
import {
  formatBedwarsLevel,
  getFinalKillsColor,
  getLossesColor,
  getFkdrColor,
  getModeWinColor,
  getWlrColor,
} from '../util/statColors';

// Delay before the death recap chats so it doesn't crowd the kill message.
const DEATH_RECAP_DELAY_MS = 2000;

export class GameStatsTracker {
  private game: GameTracker | null = null;

  constructor(
    private ctx: PluginContext,
    private settings: Settings,
    private roster: RosterManager,
  ) {}

  /** null when not currently in a tracked game. */
  get current(): GameTracker | null {
    return this.game;
  }

  begin(): void {
    this.game = {
      finalKills: 0,
      finalDeaths: 0,
      bedsBroken: 0,
      bedsLost: 0,
      kills: 0,
      deaths: 0,
      startedAt: Date.now(),
    };
  }

  clear(): void {
    this.game = null;
  }

  processChat(flat: string): void {
    if (!this.game) return;
    const ctx = this.ctx;
    const self = ctx.client.username;
    const s = this.settings;

    // Kill/death lines look like:
    //   "[R] Player1 was shot by [B] Player2. FINAL KILL!"
    //   "Player1 disconnected."
    // Pull victim from before " was " / " disconnected.", killer from after
    // " by ", and ignore any "[R] " team prefix.
    const victimMatch = flat.match(
      /(?:^|\s)(?:\[[^\]]+\]\s+)?(\w{1,16})\s+(?:was\s|disconnected\.)/,
    );
    const killerMatch = flat.match(/\bby\s+(?:\[[^\]]+\]\s+)?(\w{1,16})/);
    const victim = victimMatch?.[1] ?? null;
    const killer = killerMatch?.[1] ?? null;

    if (flat.includes('FINAL KILL')) {
      if (killer === self) {
        this.game.finalKills++;
        if (s.finalKillAlerts) {
          ctx.client.playSound('random.orb', 0.8, 1.2);
          ctx.client.sendActionBar(
            `§a§lFinal Kill! §7(${this.game.finalKills} FK this game)`,
          );
        }
      } else if (victim === self) {
        this.game.finalDeaths++;
        if (s.finalKillAlerts) {
          ctx.client.sendActionBar(
            `§c§lFinal Death! §7(${this.game.finalDeaths} FD this game)`,
          );
        }
        if (killer) this.scheduleDeathRecap(killer);
      }
    } else if (victim || killer) {
      // Non-final kill: count it but skip the alerts; FK alerts are the loud ones.
      if (killer === self) {
        this.game.kills++;
      } else if (victim === self) {
        this.game.deaths++;
        if (killer) this.scheduleDeathRecap(killer);
      }
    }

    if (flat.includes('BED DESTRUCTION')) {
      if (/your\s+bed/i.test(flat)) {
        this.game.bedsLost++;
        if (s.bedBreakAlerts) {
          ctx.client.playSound('mob.endermen.portal', 1.0, 0.5);
          ctx.client.sendTitle(
            '',
            '§c§lYour bed was destroyed!',
            { fadeIn: 3, stay: 30, fadeOut: 10 },
          );
        }
      } else if (killer === self || /\bby\s+(?:\[[^\]]+\]\s+)?you!?/i.test(flat)) {
        this.game.bedsBroken++;
        if (s.bedBreakAlerts) {
          ctx.client.playSound('random.levelup', 0.8, 2.0);
          ctx.client.sendActionBar(
            `§a§lBed Destroyed! §7(${this.game.bedsBroken} beds this game)`,
          );
        }
      } else if (s.bedBreakAlerts) {
        ctx.client.playSound('note.pling', 0.5, 1.5);
      }
    }
  }

  // Delay-chat the killer's stars/FKDR pulled from the cached roster.
  // Cheap to call: skips if the recap is off, the roster hasn't printed yet,
  // or the killer is nicked.
  private scheduleDeathRecap(killerName: string): void {
    if (!this.settings.deathRecap) return;
    const row = this.roster.findRow(killerName);
    if (!row || row.nicked) return;

    this.ctx.scheduler.setTimeout(() => {
      const star = formatBedwarsLevel(row.stars);
      this.ctx.client.sendChat(
        `${PREFIX} §c§l☠ §r§7Killed by ${star} §e${row.username} §8(§fFKDR ${getFkdrColor(row.fkdr)}§8)`,
      );
    }, DEATH_RECAP_DELAY_MS);
  }

  show(): void {
    const ctx = this.ctx;
    if (!this.game) {
      ctx.client.sendChat(`${PREFIX} §cNot in a Bedwars game.`);
      return;
    }
    const g = this.game;
    const elapsed = formatDuration(Date.now() - g.startedAt);
    const fkdr = safeRatio(g.finalKills, g.finalDeaths);
    const kdr = safeRatio(g.kills, g.deaths);

    ctx.client.sendChat(`\n${DIVIDER}`);
    ctx.client.sendChat(`${PREFIX} §6Current Game §8(§7${elapsed}§8)`);
    ctx.client.sendChat(`${DIVIDER}`);
    ctx.client.sendChat(
      `${BULLET} §fFK: ${getFinalKillsColor(g.finalKills)}§f, §fFD: ${getLossesColor(g.finalDeaths)}§f, §fFKDR: ${getFkdrColor(fkdr)}`,
    );
    ctx.client.sendChat(
      `${BULLET} §fKills: ${getModeWinColor(g.kills)}§f, §fDeaths: ${getLossesColor(g.deaths)}§f, §fKDR: ${getWlrColor(kdr)}`,
    );
    ctx.client.sendChat(
      `${BULLET} §fBeds Broken: §a${g.bedsBroken}§f, §fBeds Lost: §c${g.bedsLost}`,
    );
    ctx.client.sendChat(`${DIVIDER}`);
  }
}
