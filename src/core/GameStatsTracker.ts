import type { PluginContext } from '@duelsplus/plugin-api';
import type { GameTracker } from './types';
import type { Settings } from './Settings';
import { PREFIX, BULLET, DIVIDER } from './constants';
import { formatDuration, safeRatio } from '../util/format';
import {
  getFinalKillsColor,
  getLossesColor,
  getFkdrColor,
  getModeWinColor,
  getWlrColor,
} from '../util/statColors';

// Per-game stat tracking: final kills/deaths, beds broken/lost, kills,
// deaths. Also owns the chat-derived alerts (sounds, action bar, title)
// for bed destruction and final kills.
export class GameStatsTracker {
  private game: GameTracker | null = null;

  constructor(private ctx: PluginContext, private settings: Settings) {}

  // Current game tracker, or null if we're not in a tracked game.
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

  // Scan a flattened chat line for final kills / deaths, regular kills,
  // and bed destruction events. Also emits sound/title/actionbar alerts
  // when the relevant setting is on.
  processChat(flat: string): void {
    if (!this.game) return;
    const ctx = this.ctx;
    const self = ctx.client.username;
    const s = this.settings;

    // Hypixel Bedwars kill/death lines look like
    //   "[R] Player1 was shot by [B] Player2. FINAL KILL!"
    // or "Player1 disconnected." after the proxy strips colour codes.
    // We pull the victim out from before " was "/" disconnected." and the
    // killer out from after " by ", ignoring any team-prefix like "[R] ".
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
      }
    } else if (victim || killer) {
      // Regular (non-final) kill on the surviving team — count it but
      // skip the alerts; FK alerts are the loud ones.
      if (killer === self) {
        this.game.kills++;
      } else if (victim === self) {
        this.game.deaths++;
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
