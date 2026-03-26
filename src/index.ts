import {
  Plugin,
  type PluginContext,
  type GameStartPayload,
  type LocrawUpdatePayload,
} from '@duelsplus/plugin-api';

import { getBedwarsStats } from './hypixelBedwarsMode';
import { getWinsColorBedwars, getWlrColor, getFkdrColor, getStarsColor } from './statColors';

const BW_DUELS_MODES = new Set(['BEDWARS_TWO_ONE_DUELS', 'BEDWARS_TWO_ONE_DUELS_RUSH']);

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

interface RowModel {
  username: string;
  wins: number;
  wlr: number;
  fkdr: number;
  stars: number;
  unavailable: boolean;
  usedOverallFallback: boolean;
  severity: number;
}

/**
 * Hypixel prints a green ▬ divider then a line that is effectively "Bed Wars" (title).
 * We treat that title line as game start for roster purposes.
 */
function isBedWarsTitleBanner(flat: string): boolean {
  const s = flat
    .replace(/§[0-9a-fl-or]/gi, '')
    .replace(/\u00a7[0-9a-fl-or]/gi, '')
    .trim();
  return /^Bed Wars$/i.test(s);
}

/** Locraw uses `BEDWARS_EIGHT_TWO`; Hypixel API keys use `bedwars_eight_two`. */
function locrawModeToBedwarsApiKey(mode: string): string {
  return mode.trim().toLowerCase();
}

export default class BedwarsPlugin extends Plugin {
  id = 'bedwars';
  name = 'Bedwars Plugin';
  description = 'Official Bedwars plugin for Duels+ proxy';
  version = '1.0.0';
  author = 'DuelsPlus';

  private ctx!: PluginContext;
  private rosterBusy = false;
  /** One roster per Hypixel server id per match */
  private rosterPrintedForServer: string | null = null;
  /** Arm after game:start in main BW; wait for banner chat */
  private waitingForBanner = false;
  private currentMode: string | null = null;

  private whoNames = new Set<string>();
  private lastWhoAt = 0;
  private rosterAfterWhoTimeout: number | null = null;

  private debugChat = false;

  onLoad(ctx: PluginContext): void {
    this.ctx = ctx;
    this.debugChat = ctx.storage.get<boolean>('debugChat') ?? false;

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

    ctx.events.on('game:start', (payload: GameStartPayload) => {
      if (!isHypixelMainBedwars(payload.gametype, payload.mode)) return;
      if (!(ctx.storage.get<boolean>('enabled') ?? true)) return;
      this.rosterPrintedForServer = null;
      this.currentMode = payload.mode;
      this.whoNames.clear();
      this.waitingForBanner = true;
    });

    ctx.events.on('locraw:update', (payload: LocrawUpdatePayload) => {
      const { gametype, mode } = payload.data;
      if (!isHypixelMainBedwars(gametype, mode ?? null)) {
        this.waitingForBanner = false;
        this.rosterPrintedForServer = null;
        this.currentMode = null;
        this.whoNames.clear();
        this.clearRosterTimeout();
      } else {
        this.currentMode = mode ?? this.currentMode;
      }
    });

    ctx.packets.onClientbound('chat', (data) => {
      this.debugChatPacketToConsole(data);
      this.onChatForBanner(data);
      this.captureWhoResponse(data);
    });

    ctx.commands.register({
      name: 'bwroster',
      description: 'Run /who and show Bedwars roster (manual)',
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
          return;
        }
        if (!isHypixelMainBedwars(ctx.gameState.currentGametype, ctx.gameState.currentMode)) {
          ctx.client.sendChat('§7[Bedwars] §cNot in main Bedwars.');
          return;
        }
        this.currentMode = ctx.gameState.currentMode;
        this.requestWhoAndPrintSoon('manual');
      },
    });

    ctx.commands.register({
      name: 'bwdebugchat',
      description: 'Log Bedwars chat packets to the proxy console',
      usage: '/bwdebugchat [on|off]',
      execute: (args) => {
        const sub = args[0]?.toLowerCase();
        if (sub === 'on') {
          this.debugChat = true;
          ctx.storage.set('debugChat', true);
          console.log('[Bedwars] chat packet debug ON');
          return;
        }
        if (sub === 'off') {
          this.debugChat = false;
          ctx.storage.set('debugChat', false);
          console.log('[Bedwars] chat packet debug OFF');
          return;
        }
        console.log(`[Bedwars] chat debug: ${this.debugChat ? 'ON' : 'OFF'}`);
      },
    });
  }

  private debugChatPacketToConsole(data: unknown): void {
    if (!this.debugChat) return;
    if (this.ctx.gameState.locraw.gametype !== 'BEDWARS') return;

    const packet = data as { message?: string; position?: number };
    const raw = packet?.message;
    if (typeof raw !== 'string' || raw.length === 0) return;

    const flat = this.extractTextFromChatJson(raw);
    console.log(`[Bedwars][chat-debug] pos=${String(packet.position ?? -1)} flat=${flat.slice(0, 400)}`);
    try {
      console.log('[Bedwars][chat-debug] parsed:', JSON.parse(raw));
    } catch {
      console.log('[Bedwars][chat-debug] raw:', raw.slice(0, 300));
    }
  }

  private onChatForBanner(data: unknown): void {
    if (!(this.ctx.storage.get<boolean>('enabled') ?? true)) return;
    if (!this.waitingForBanner) return;

    const packet = data as { message?: string };
    const raw = packet?.message;
    if (typeof raw !== 'string') return;

    const flat = this.extractTextFromChatJson(raw);
    if (!isBedWarsTitleBanner(flat)) return;

    const server = this.ctx.gameState.locraw.server;
    if (!server) return;
    if (this.rosterPrintedForServer === server) return;

    this.waitingForBanner = false;
    console.log('[Bedwars] Banner (Bed Wars title) detected — sending /who');
    this.requestWhoAndPrintSoon('banner');
  }

  private requestWhoAndPrintSoon(_reason: string): void {
    const ctx = this.ctx;
    const mode = this.currentMode ?? ctx.gameState.currentMode;
    if (!mode) return;

    this.whoNames.clear();
    this.lastWhoAt = 0;
    this.sendWho();

    this.clearRosterTimeout();
    let attempt = 0;
    const tick = (): void => {
      if (this.rosterPrintedForServer === ctx.gameState.locraw.server) return;
      attempt++;
      if (this.whoNames.size > 0) {
        void this.printRosterFromWho(mode);
        return;
      }
      if (attempt <= 12) {
        if (attempt % 4 === 0) this.sendWho();
        this.rosterAfterWhoTimeout = ctx.scheduler.setTimeout(tick, 400);
        return;
      }
      ctx.logger.warn('[Bedwars] /who returned no ONLINE names after banner');
    };
    this.rosterAfterWhoTimeout = ctx.scheduler.setTimeout(tick, 500);
  }

  private sendWho(): void {
    const now = Date.now();
    if (now - this.lastWhoAt < 1500) return;
    this.lastWhoAt = now;
    this.ctx.client.sendGameChat('/who');
  }

  private clearRosterTimeout(): void {
    if (this.rosterAfterWhoTimeout !== null) {
      this.ctx.scheduler.clearTimeout(this.rosterAfterWhoTimeout);
      this.rosterAfterWhoTimeout = null;
    }
  }

  private captureWhoResponse(data: unknown): void {
    const packet = data as { message?: string };
    const raw = packet?.message;
    if (typeof raw !== 'string' || raw.length === 0) return;

    const text = this.extractTextFromChatJson(raw);
    if (!/^ONLINE:/i.test(text.trim())) return;

    const namesPart = text.replace(/^ONLINE:\s*/i, '');
    const parts = namesPart
      .split(',')
      .map((s) => this.stripFormatting(s).trim())
      .filter((s) => this.isValidUsername(s));

    for (const p of parts) this.whoNames.add(p);
  }

  private extractTextFromChatJson(raw: string): string {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return this.readText(parsed);
    } catch {
      return this.stripFormatting(raw);
    }
  }

  private readText(node: unknown): string {
    if (!node) return '';
    if (typeof node === 'string') return this.stripFormatting(node);
    if (Array.isArray(node)) return node.map((n) => this.readText(n)).join('');
    if (typeof node === 'object') {
      const rec = node as { text?: unknown; extra?: unknown };
      const text = rec.text ? this.readText(rec.text) : '';
      const extra = rec.extra ? this.readText(rec.extra) : '';
      return text + extra;
    }
    return '';
  }

  private stripFormatting(s: string): string {
    return s.replace(/§[0-9a-fl-or]/gi, '');
  }

  private isValidUsername(name: string | undefined | null): name is string {
    if (!name) return false;
    return /^[A-Za-z0-9_]{1,16}$/.test(name);
  }

  private async fetchStatsForUsername(username: string) {
    let st = await this.ctx.players.fetchStatsByUsername(username);
    if (st) return st;
    const uuid = await this.ctx.players.resolveUuid(username);
    if (!uuid) return null;
    st = await this.ctx.players.fetchStats(uuid);
    return st;
  }

  private async printRosterFromWho(modeHint: string): Promise<void> {
    if (this.rosterBusy) return;
    const ctx = this.ctx;
    const server = ctx.gameState.locraw.server;
    if (!server) return;
    if (this.rosterPrintedForServer === server) return;

    const players = Array.from(this.whoNames.values()).filter((n) => this.isValidUsername(n));
    if (players.length === 0) return;

    this.rosterBusy = true;
    try {
      const mode =
        ctx.gameState.currentMode ?? this.currentMode ?? modeHint;
      const modeKey = locrawModeToBedwarsApiKey(mode);
      const self = ctx.client.username.toLowerCase();
      const modeMs = ctx.stats.getModeStats(mode);

      ctx.client.sendChat('');
      ctx.client.sendChat(
        `§4§l¤ §7Duels+ §8| §6Bedwars §8| §f${mode}` +
          (modeMs
            ? ` §7| §7sess: §a${modeMs.wins}§7/§c${modeMs.losses} §7(${getWlrColor(modeMs.wlr)})`
            : ''),
      );
      ctx.client.sendChat(`§8[§4D+§8] §7Players: §f${players.length}`);

      const rows: RowModel[] = [];
      for (const username of players) {
        const st = await this.fetchStatsForUsername(username);
        const display = st?.displayname ?? username;
        if (!st) {
          rows.push({
            username: display,
            wins: 0,
            wlr: 0,
            fkdr: 0,
            stars: 0,
            unavailable: true,
            usedOverallFallback: false,
            severity: -1,
          });
          continue;
        }
        const raw = st?.raw as Record<string, unknown> | undefined;
        const bwObj = raw?.Bedwars ?? raw?.bedwars;
        const bwRaw = (typeof bwObj === 'object' && bwObj !== null
          ? (bwObj as Record<string, number | string>)
          : {}) as Record<string, number | string>;
        const extracted = getBedwarsStats(modeKey, bwRaw);
        const modeEmpty = extracted.winsInMode === 0 && extracted.lossesInMode === 0 && extracted.finalKillsInMode === 0 && extracted.finalDeathsInMode === 0;
        const overallWins = st?.bedwars?.wins ?? 0;
        const overallLosses = st?.bedwars?.losses ?? 0;
        const overallFk = st?.bedwars?.finalKills ?? 0;
        const overallFd = st?.bedwars?.finalDeaths ?? 0;
        const usedOverallFallback = modeEmpty && (overallWins > 0 || overallLosses > 0 || overallFk > 0 || overallFd > 0);

        const wins = usedOverallFallback ? overallWins : extracted.winsInMode;
        const losses = usedOverallFallback ? overallLosses : extracted.lossesInMode;
        const wlr = losses === 0 ? wins : Math.round((wins / losses) * 100) / 100;
        const fd = usedOverallFallback ? overallFd : extracted.finalDeathsInMode;
        const fk = usedOverallFallback ? overallFk : extracted.finalKillsInMode;
        const fkdr = fd === 0 ? fk : Math.round((fk / fd) * 100) / 100;
        const stars = st?.bedwars?.stars ?? 0;
        const severity = wlr * 10_000 + fkdr * 100 + stars;
        rows.push({
          username: display,
          wins,
          wlr,
          fkdr,
          stars,
          unavailable: false,
          usedOverallFallback,
          severity,
        });
      }

      rows.sort((a, b) => b.severity - a.severity);

      for (const r of rows) {
        const isSelf = r.username.toLowerCase() === self;
        let sessCol = '§8—';
        if (isSelf && modeMs) {
          sessCol = `§a${modeMs.wins}§7/§c${modeMs.losses} ${getWlrColor(modeMs.wlr)}`;
        }
        if (r.unavailable) {
          ctx.client.sendChat(`§8[§4D+§8] §e${r.username} §8- §7W:§8n/a §8| §7WLR:§8n/a §8| §7FKDR:§8n/a §8| §7✫:§8n/a §8| §7S:${sessCol}`);
          continue;
        }
        const src = r.usedOverallFallback ? ' §8[o]' : '';
        ctx.client.sendChat(
          `§8[§4D+§8] §e${r.username}${src} §8- §7W:${getWinsColorBedwars(r.wins)} §8| §7WLR:${getWlrColor(r.wlr)} §8| §7FKDR:${getFkdrColor(r.fkdr)} §8| §7✫:${getStarsColor(r.stars)} §8| §7S:${sessCol}`,
        );
      }
      if (rows.some((r) => r.usedOverallFallback)) {
        ctx.client.sendChat('§8[§4D+§8] §7[o] = overall BW fallback (mode key unavailable)');
      }
      const unavailableCount = rows.filter((r) => r.unavailable).length;
      if (unavailableCount > 0) {
        ctx.client.sendChat(`§8[§4D+§8] §7${unavailableCount} player(s) unavailable from API`);
      }
      ctx.client.sendChat('');

      this.rosterPrintedForServer = server;
    } catch (e) {
      ctx.logger.warn('Bedwars roster failed', e);
    } finally {
      this.rosterBusy = false;
    }
  }

  onDisable(): void {
    this.clearRosterTimeout();
    this.waitingForBanner = false;
    this.whoNames.clear();
    this.rosterPrintedForServer = null;
  }
}
