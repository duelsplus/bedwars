import {
  Plugin,
  type PluginContext,
  type PluginChestGUI,
  type GameStartPayload,
  type LocrawUpdatePayload,
} from '@duelsplus/plugin-api';

import { getBedwarsStats } from './hypixelBedwarsMode';
import { getWinsColorBedwars, getWlrColor, getFkdrColor, formatBedwarsLevel } from './statColors';

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
  losses: number;
  wlr: number;
  fkdr: number;
  stars: number;
  nicked: boolean;
  usedOverallFallback: boolean;
  severity: number;
}

/** Proxy-style prefix: [Duels+] >> */
const PREFIX = '§8[§cDuels§4+§8] §8»';
/** Dark-red bold diamond bullet, same as proxy autoStats */
const BULLET = ' §4§l¤';
/** Cyan bold diamond bullet for self-stats */
const SELF_BULLET = ' §3§l¤';

/** Skull item IDs for GUI */
const MATERIAL_SKULL = 397;
const MATERIAL_STAINED_GLASS = 160;
const MATERIAL_PAPER = 339;
const MATERIAL_BARRIER = 166;

function isBedWarsTitleBanner(flat: string): boolean {
  const s = flat
    .replace(/§[0-9a-fk-or]/gi, '')
    .replace(/\u00a7[0-9a-fk-or]/gi, '')
    .trim();
  return /^Bed Wars$/i.test(s);
}

function locrawModeToBedwarsApiKey(mode: string): string {
  return mode.trim().toLowerCase();
}

export default class BedwarsPlugin extends Plugin {
  id = 'bedwars';
  name = 'Bedwars Plugin';
  description = 'Official Bedwars plugin for Duels+ proxy';
  version = '1.3.0';
  author = 'DuelsPlus';

  private ctx!: PluginContext;
  private rosterBusy = false;
  private rosterPrintedForServer: string | null = null;
  private inBedwarsGame = false;
  private bannerSeen = false;
  private currentMode: string | null = null;

  private whoNames = new Set<string>();
  private lastWhoAt = 0;
  private rosterAfterWhoTimeout: number | null = null;
  private fallbackRosterTimeout: number | null = null;
  private earlyChats: string[] = [];
  private collectingEarlyChats = false;
  private lastRows: RowModel[] = [];

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

    // --- Event handlers ---

    ctx.events.on('game:start', (payload: GameStartPayload) => {
      if (!isHypixelMainBedwars(payload.gametype, payload.mode)) return;
      this.enterBedwarsGame(payload.mode);
    });

    ctx.events.on('locraw:update', (payload: LocrawUpdatePayload) => {
      const { gametype, mode } = payload.data;
      if (!isHypixelMainBedwars(gametype, mode ?? null)) {
        this.resetState();
      } else {
        this.enterBedwarsGame(mode!);
        this.replayEarlyChats();
      }
    });

    ctx.events.on('game:end', () => this.resetState());
    ctx.events.on('game:leave', () => this.resetState());
    ctx.events.on('lobby:join', () => this.resetState());

    // --- Packet listeners ---

    ctx.packets.onClientbound('chat', (data) => {
      this.debugChatPacketToConsole(data);
      this.onChatPacket(data);
    });

    // --- Commands ---

    ctx.commands.register({
      name: 'bwroster',
      description: 'Manually trigger Bedwars roster or open GUI',
      aliases: ['bwr'],
      usage: '/bwroster [gui]',
      execute: (args) => {
        if (args[0]?.toLowerCase() === 'gui') {
          if (this.lastRows.length === 0) {
            ctx.client.sendChat(`${PREFIX} §cNo roster data yet.`);
            return;
          }
          this.openRosterGUI(this.lastRows);
          return;
        }
        if (!isHypixelMainBedwars(ctx.gameState.currentGametype, ctx.gameState.currentMode)) {
          ctx.client.sendChat(`${PREFIX} §cNot in main Bedwars.`);
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
        } else if (sub === 'off') {
          this.debugChat = false;
          ctx.storage.set('debugChat', false);
          console.log('[Bedwars] chat packet debug OFF');
        } else {
          console.log(`[Bedwars] chat debug: ${this.debugChat ? 'ON' : 'OFF'}`);
        }
      },
    });
  }

  private enterBedwarsGame(mode: string): void {
    if (this.inBedwarsGame && this.currentMode === mode) return;
    this.rosterPrintedForServer = null;
    this.currentMode = mode;
    this.whoNames.clear();
    this.bannerSeen = false;
    this.inBedwarsGame = true;
    this.collectingEarlyChats = true;

    this.clearFallbackTimeout();
    this.fallbackRosterTimeout = this.ctx.scheduler.setTimeout(() => {
      this.fallbackRosterTimeout = null;
      if (this.inBedwarsGame && !this.bannerSeen && this.rosterPrintedForServer === null) {
        this.ctx.logger.debug('[Bedwars] Banner not detected — fallback /who trigger');
        this.requestWhoAndPrintSoon('fallback');
      }
    }, 3500);
  }

  private onChatPacket(data: unknown): void {
    const packet = data as { message?: string };
    const raw = packet?.message;
    if (typeof raw !== 'string' || raw.length === 0) return;

    if (this.inBedwarsGame) {
      this.captureWhoResponse(raw);
    }

    if (this.collectingEarlyChats && !this.inBedwarsGame) {
      if (this.earlyChats.length < 50) {
        this.earlyChats.push(raw);
      }
      return;
    }

    this.tryDetectBanner(raw);
  }

  private tryDetectBanner(raw: string): void {
    if (!this.inBedwarsGame || this.bannerSeen) return;

    const flat = this.extractTextFromChatJson(raw);
    if (!isBedWarsTitleBanner(flat)) return;

    const server = this.ctx.gameState.locraw.server;
    if (!server || this.rosterPrintedForServer === server) return;

    this.bannerSeen = true;
    this.clearFallbackTimeout();
    this.ctx.logger.debug('[Bedwars] Banner detected — sending /who');
    this.requestWhoAndPrintSoon('banner');
  }

  private replayEarlyChats(): void {
    this.collectingEarlyChats = false;
    const chats = this.earlyChats.splice(0);
    for (const raw of chats) {
      this.captureWhoResponse(raw);
      this.tryDetectBanner(raw);
    }
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
      ctx.logger.warn('[Bedwars] /who returned no ONLINE names after retries');
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

  private clearFallbackTimeout(): void {
    if (this.fallbackRosterTimeout !== null) {
      this.ctx.scheduler.clearTimeout(this.fallbackRosterTimeout);
      this.fallbackRosterTimeout = null;
    }
  }

  private captureWhoResponse(raw: string): void {
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
      const rec = node as Record<string, unknown>;
      let text = rec.text ? this.readText(rec.text) : '';
      if (rec.translate && typeof rec.translate === 'string') {
        text += this.stripFormatting(rec.translate);
      }
      if (Array.isArray(rec.with)) {
        text += rec.with.map((n: unknown) => this.readText(n)).join('');
      }
      if (rec.extra) {
        text += this.readText(rec.extra);
      }
      return text;
    }
    return '';
  }

  private stripFormatting(s: string): string {
    return s.replace(/§[0-9a-fk-or]/gi, '');
  }

  private isValidUsername(name: string | undefined | null): name is string {
    if (!name) return false;
    return /^[A-Za-z0-9_]{1,16}$/.test(name);
  }

  private fetchStatsForUsername(username: string) {
    return this.ctx.players.fetchStatsByUsername(username);
  }

  private buildRow(
    username: string,
    st: Awaited<ReturnType<typeof this.fetchStatsForUsername>>,
    modeKey: string,
  ): RowModel {
    const display = st?.displayname ?? username;
    if (!st) {
      return {
        username: display,
        wins: 0, losses: 0, wlr: 0, fkdr: 0, stars: 0,
        nicked: true, usedOverallFallback: false, severity: -1,
      };
    }
    const raw = st?.raw as Record<string, unknown> | undefined;
    const bwObj = raw?.Bedwars ?? raw?.bedwars;
    const bwRaw = (typeof bwObj === 'object' && bwObj !== null
      ? (bwObj as Record<string, number | string>)
      : {}) as Record<string, number | string>;
    const extracted = getBedwarsStats(modeKey, bwRaw);
    const modeEmpty =
      extracted.winsInMode === 0 &&
      extracted.lossesInMode === 0 &&
      extracted.finalKillsInMode === 0 &&
      extracted.finalDeathsInMode === 0;
    const overallWins = st?.bedwars?.wins ?? 0;
    const overallLosses = st?.bedwars?.losses ?? 0;
    const overallFk = st?.bedwars?.finalKills ?? 0;
    const overallFd = st?.bedwars?.finalDeaths ?? 0;
    const usedOverallFallback =
      modeEmpty && (overallWins > 0 || overallLosses > 0 || overallFk > 0 || overallFd > 0);

    const wins = usedOverallFallback ? overallWins : extracted.winsInMode;
    const losses = usedOverallFallback ? overallLosses : extracted.lossesInMode;
    const wlr = losses === 0 ? wins : Math.round((wins / losses) * 100) / 100;
    const fd = usedOverallFallback ? overallFd : extracted.finalDeathsInMode;
    const fk = usedOverallFallback ? overallFk : extracted.finalKillsInMode;
    const fkdr = fd === 0 ? fk : Math.round((fk / fd) * 100) / 100;
    const stars = st?.bedwars?.stars ?? 0;
    const severity = wlr * 10_000 + fkdr * 100 + stars;
    return {
      username: display, wins, losses, wlr, fkdr, stars,
      nicked: false, usedOverallFallback, severity,
    };
  }

  // ── Chat roster (always-on) ──

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
      const mode = ctx.gameState.currentMode ?? this.currentMode ?? modeHint;
      const modeKey = locrawModeToBedwarsApiKey(mode);
      const self = ctx.client.username.toLowerCase();

      // Header
      ctx.client.sendChat(`\n${PREFIX} §6Bedwars Roster §8(§f${players.length} §7players§8)`);

      // Fetch all player stats in parallel
      const results = await Promise.allSettled(
        players.map(async (username) => {
          const st = await this.fetchStatsForUsername(username);
          return { username, st };
        }),
      );

      const rows: RowModel[] = results.map((result) => {
        if (result.status === 'fulfilled') {
          return this.buildRow(result.value.username, result.value.st, modeKey);
        }
        return this.buildRow('???', null, modeKey);
      });

      rows.sort((a, b) => b.severity - a.severity);
      this.lastRows = rows;

      for (const r of rows) {
        const isSelf = r.username.toLowerCase() === self;
        const bullet = isSelf ? SELF_BULLET : BULLET;

        if (r.nicked) {
          ctx.client.sendChat(`${bullet} §7[NICK] §e${r.username}`);
          continue;
        }

        // Matching proxy style: bullet [star] Name W: val, WLR: val, FKDR: val
        const star = formatBedwarsLevel(r.stars);
        ctx.client.sendChat(
          `${bullet} ${star} §e${r.username} §fW: ${getWinsColorBedwars(r.wins)}§f, §fWLR: ${getWlrColor(r.wlr)}§f, §fFKDR: ${getFkdrColor(r.fkdr)}`,
        );
      }

      const nickCount = rows.filter((r) => r.nicked).length;
      if (nickCount > 0) {
        ctx.client.sendChat(`${PREFIX} §7${nickCount} nicked`);
      }
      ctx.client.sendChat('');

      this.rosterPrintedForServer = server;
    } catch (e) {
      ctx.logger.warn('Bedwars roster failed', e);
    } finally {
      this.rosterBusy = false;
    }
  }

  // ── Chest GUI roster ──

  private openRosterGUI(rows: RowModel[]): void {
    const ctx = this.ctx;
    const self = ctx.client.username.toLowerCase();
    const guiRows = Math.min(6, Math.max(2, Math.ceil(rows.length / 9) + 1)) as 1 | 2 | 3 | 4 | 5 | 6;

    let gui: PluginChestGUI;
    try {
      gui = ctx.gui.createChestGUI(`§8Bedwars Roster §7(${rows.length})`, guiRows);
    } catch {
      ctx.client.sendChat(`${PREFIX} §cCould not open GUI.`);
      return;
    }

    gui.fillBlack();

    for (let i = 0; i < rows.length && i < (guiRows * 9); i++) {
      const r = rows[i];
      const isSelf = r.username.toLowerCase() === self;

      if (r.nicked) {
        const item = ctx.gui.createItem(MATERIAL_BARRIER, 0,
          `§c${r.username} §7(Nicked)`,
          ['§8No stats available'],
        );
        gui.setItem(i, item);
        continue;
      }

      const starStr = this.stripFormatting(formatBedwarsLevel(r.stars));
      const wlrStr = r.wlr.toFixed(2).replace(/\.00$/, '');
      const fkdrStr = r.fkdr.toFixed(2).replace(/\.00$/, '');

      // Colored glass pane based on threat level
      let paneColor: number;
      if (isSelf) paneColor = 3; // light blue
      else if (r.fkdr >= 10) paneColor = 14; // red
      else if (r.fkdr >= 5) paneColor = 1; // orange
      else if (r.fkdr >= 2) paneColor = 4; // yellow
      else if (r.fkdr >= 1) paneColor = 5; // lime
      else paneColor = 0; // white

      const lore: string[] = [
        `§7Stars: §f${starStr}`,
        '',
        `§7Wins: §a${r.wins}`,
        `§7Losses: §c${r.losses}`,
        `§7WLR: §b${wlrStr}`,
        '',
        `§7FKDR: §e${fkdrStr}`,
      ];
      if (r.usedOverallFallback) {
        lore.push('', '§8Overall stats (no mode data)');
      }

      const item = ctx.gui.createItem(
        MATERIAL_STAINED_GLASS, paneColor,
        `${isSelf ? '§b' : '§e'}${r.username}`,
        lore,
      );
      gui.setItem(i, item);
    }

    gui.open();
  }

  private resetState(): void {
    this.inBedwarsGame = false;
    this.bannerSeen = false;
    this.rosterPrintedForServer = null;
    this.currentMode = null;
    this.whoNames.clear();
    this.earlyChats.length = 0;
    this.collectingEarlyChats = false;
    this.clearRosterTimeout();
    this.clearFallbackTimeout();
  }

  onDisable(): void {
    this.resetState();
  }
}
