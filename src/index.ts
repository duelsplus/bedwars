/**
 * Bedwars team roster: per-queue Hypixel stats at game start, tier-coloured like Duels+.
 */
import {
  Plugin,
  type PluginContext,
  type GameStartPayload,
  type TeamInfo,
} from '@duelsplus/plugin-api';

import { getBedwarsStats } from './hypixelBedwarsMode';
import { getWinsColorBedwars, getWlrColor, getFkdrColor, getStarsColor } from './statColors';

const BW_DUELS_MODES = new Set(['BEDWARS_TWO_ONE_DUELS', 'BEDWARS_TWO_ONE_DUELS_RUSH']);

/** Matches proxy ScoreboardHandler.STAT_TAG_TEAM_PREFIXES */
const PROXY_TEAM_PREFIXES = ['dp_st_', '0-', 'nick-', '!'];

function isBedwarsDuelsMode(mode: string | null): boolean {
  return mode !== null && BW_DUELS_MODES.has(mode);
}

function isHypixelMainBedwars(gametype: string | null | undefined, mode: string | null): boolean {
  return (
    gametype === 'BEDWARS' &&
    mode !== null &&
    mode.startsWith('BEDWARS_') &&
    !isBedwarsDuelsMode(mode)
  );
}

function isProxyInjectedTeam(name: string): boolean {
  return PROXY_TEAM_PREFIXES.some((p) => name.startsWith(p));
}

function teamLabel(team: TeamInfo): string {
  const raw = team.prefix.replace(/§[0-9a-fl-or]/gi, '').trim();
  if (raw.length > 0) return raw.slice(0, 12);
  return team.name.slice(0, 14);
}

interface RowModel {
  username: string;
  wins: number;
  wlr: number;
  fkdr: number;
  stars: number;
  severity: number;
}

export default class BedwarsPlugin extends Plugin {
  id = 'bedwars';
  name = 'Bedwars Plugin';
  description = 'Hypixel Bedwars queues: roster, auto-stats, stat tags (via game mode API)';
  version = '1.0.0';
  author = 'DuelsPlus';

  private ctx!: PluginContext;
  private rosterTimeout: number | null = null;
  private rosterBusy = false;

  onLoad(ctx: PluginContext): void {
    this.ctx = ctx;

    ctx.gameModes.register({
      id: 'hypixel-bedwars-queues',
      match: ({ gametype, mode }) => isHypixelMainBedwars(gametype, mode),
      extractStats: (rawPlayer, locrawMode) => {
        const bw = (rawPlayer.stats as Record<string, unknown> | undefined)?.Bedwars as
          | Record<string, number | string>
          | undefined;
        if (!bw) return null;
        const e = getBedwarsStats(locrawMode.toLowerCase(), bw);
        return {
          wins: e.winsInMode,
          losses: e.lossesInMode,
          winstreak: e.currentWinstreakInMode,
          bestWinstreak: 0,
          tagKills: e.finalKillsInMode,
          tagDeaths: e.finalDeathsInMode,
        };
      },
      statTagColorProfile: 'ratio',
      showHypixelBedwarsStarsInAutoStats: true,
    });

    const onStart = (payload: GameStartPayload) => {
      if (!isHypixelMainBedwars(payload.gametype, payload.mode)) return;
      if (!(ctx.storage.get<boolean>('enabled') ?? true)) return;
      this.scheduleRoster(payload.mode);
    };

    ctx.events.on('game:start', onStart);

    ctx.commands.register({
      name: 'bwroster',
      description: 'Show Bedwars team roster stats for the current game',
      aliases: ['bwr'],
      usage: '/bwroster [on|off]',
      execute: (args) => {
        const sub = args[0]?.toLowerCase();
        if (sub === 'off') {
          ctx.storage.set('enabled', false);
          ctx.client.sendChat('§7[Bedwars] Roster §coff');
          return;
        }
        if (sub === 'on') {
          ctx.storage.set('enabled', true);
          ctx.client.sendChat('§7[Bedwars] Roster §aon');
          const modeOn = ctx.gameState.currentMode;
          if (ctx.gameState.currentGametype === 'BEDWARS' && modeOn) {
            this.scheduleRoster(modeOn);
          }
          return;
        }
        const modeCmd = ctx.gameState.currentMode;
        if (!isHypixelMainBedwars(ctx.gameState.currentGametype, modeCmd)) {
          ctx.client.sendChat('§7[Bedwars] §cNot in a main Bedwars game.');
          return;
        }
        this.scheduleRoster(modeCmd!, 0);
      },
    });
  }

  private scheduleRoster(mode: string, delayMs = 700): void {
    if (this.rosterTimeout !== null) {
      this.ctx.scheduler.clearTimeout(this.rosterTimeout);
      this.rosterTimeout = null;
    }
    this.rosterTimeout = this.ctx.scheduler.setTimeout(() => {
      this.rosterTimeout = null;
      void this.tryPrintRoster(mode, 0);
    }, delayMs);
  }

  private async tryPrintRoster(mode: string, attempt: number): Promise<void> {
    if (this.rosterBusy) return;
    const ctx = this.ctx;
    if (!ctx.client.isConnected) return;

    const teams = this.collectTeams();
    if (teams.length === 0 && attempt < 6) {
      ctx.scheduler.setTimeout(() => void this.tryPrintRoster(mode, attempt + 1), 400);
      return;
    }
    if (teams.length === 0) {
      ctx.logger.debug('Bedwars roster: no scoreboard teams');
      return;
    }

    this.rosterBusy = true;
    try {
      await this.printRoster(mode, teams);
    } catch (e) {
      ctx.logger.warn('Bedwars roster failed', e);
    } finally {
      this.rosterBusy = false;
    }
  }

  private collectTeams(): TeamInfo[] {
    const all = this.ctx.scoreboard.getTeams();
    const out: TeamInfo[] = [];
    for (const t of all) {
      if (isProxyInjectedTeam(t.name)) continue;
      const players = (t.players ?? []).filter((p) => p && p.trim().length > 0);
      if (players.length === 0) continue;
      out.push({ ...t, players });
    }
    return out;
  }

  private sortTeams(teams: TeamInfo[], selfLower: string): TeamInfo[] {
    const idx = teams.findIndex((t) =>
      t.players.some((p) => p.toLowerCase() === selfLower),
    );
    if (idx <= 0) return teams;
    const copy = [...teams];
    const [mine] = copy.splice(idx, 1);
    copy.unshift(mine);
    return copy;
  }

  private async printRoster(mode: string, teams: TeamInfo[]): Promise<void> {
    const ctx = this.ctx;
    const self = ctx.client.username.toLowerCase();
    const modeKey = mode.toLowerCase();
    const ordered = this.sortTeams(teams, self);
    const modeMs = ctx.stats.getModeStats(mode);

    ctx.client.sendChat('');
    ctx.client.sendChat('§8§m                                                ');
    ctx.client.sendChat(
      `§6§lBedwars §7| §f${mode}` +
        (modeMs
          ? ` §7| §7sess: §a${modeMs.wins}§7/§c${modeMs.losses} §7(${getWlrColor(modeMs.wlr)})`
          : ''),
    );
    ctx.client.sendChat(
      '§7§o[player] §8| §oW §8| §oWLR §8| §oFKDR §8| §o✫ §8| §oSess',
    );
    ctx.client.sendChat('§8§m                                                ');

    for (const team of ordered) {
      ctx.client.sendChat(`§6[§f${teamLabel(team)}§6]`);
      const rows: RowModel[] = [];

      for (const username of team.players) {
        const st = await ctx.players.fetchStatsByUsername(username);
        const bwRaw = (st?.raw?.Bedwars ?? {}) as Record<string, number | string>;
        const extracted = getBedwarsStats(modeKey, bwRaw);
        const wins = extracted.winsInMode;
        const losses = extracted.lossesInMode;
        const wlr = losses === 0 ? wins : Math.round((wins / losses) * 100) / 100;
        const fd = extracted.finalDeathsInMode;
        const fk = extracted.finalKillsInMode;
        const fkdr = fd === 0 ? fk : Math.round((fk / fd) * 100) / 100;
        const stars = st?.bedwars?.stars ?? 0;
        const severity = wlr * 10_000 + fkdr * 100 + stars;
        rows.push({ username, wins, wlr, fkdr, stars, severity });
      }

      rows.sort((a, b) => b.severity - a.severity);

      for (const r of rows) {
        const isSelf = r.username.toLowerCase() === self;
        let sessCol = '§8—';
        if (isSelf && modeMs) {
          sessCol = `§a${modeMs.wins}§7/§c${modeMs.losses} ${getWlrColor(modeMs.wlr)}`;
        }

        const wStr = getWinsColorBedwars(r.wins);
        const wlrStr = getWlrColor(r.wlr);
        const fkdrStr = getFkdrColor(r.fkdr);
        const starStr = getStarsColor(r.stars);

        ctx.client.sendChat(
          `§e${r.username} §8| ${wStr} §8| ${wlrStr} §8| ${fkdrStr} §8| ${starStr} §8| ${sessCol}`,
        );
      }

      ctx.client.sendChat('');
    }
  }

  onDisable(): void {
    if (this.rosterTimeout !== null) {
      this.ctx.scheduler.clearTimeout(this.rosterTimeout);
      this.rosterTimeout = null;
    }
  }
}
