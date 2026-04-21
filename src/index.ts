import {
  Plugin,
  type PluginContext,
  type PluginChestGUI,
  type GameStartPayload,
  type GameEndPayload,
  type LocrawUpdatePayload,
  type HypixelPlayerStats,
} from '@duelsplus/plugin-api';

import { getBedwarsStats } from './hypixelBedwarsMode';
import { getWinsColorBedwars, getWlrColor, getFkdrColor, formatBedwarsLevel, getModeWinColor, getLossesColor, getWinstreakColor, getBblrColor, getFinalKillsColor } from './statColors';
import { BedWarsStatus, getBedWarsStatus } from './gameModeUtil';

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
  finalKills: number;
  finalDeaths: number;
  stars: number;
  nicked: boolean;
  usedOverallFallback: boolean;
  severity: number;
}

interface GameTracker {
  finalKills: number;
  finalDeaths: number;
  bedsBroken: number;
  bedsLost: number;
  kills: number;
  deaths: number;
  startedAt: number;
}

interface BedwarsSessionStats {
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

const PREFIX = '§8[§cDuels§4+§8] §8»';
const BULLET = ' §4§l¤';
const SELF_BULLET = ' §3§l¤';
const DIVIDER = '§8' + '═'.repeat(35);

const MATERIAL_STAINED_GLASS = 160;
const MATERIAL_PAPER = 339;
const MATERIAL_BARRIER = 166;
const MATERIAL_BOOK = 340;
const MATERIAL_GOLD_INGOT = 266;

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

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function safeRatio(num: number, den: number): number {
  return den === 0 ? num : Math.round((num / den) * 100) / 100;
}

export default class BedwarsPlugin extends Plugin {
  id = 'bedwars';
  name = 'Bedwars Plugin';
  description = 'Official Bedwars plugin for Duels+ proxy';
  version = '2.0.0';
  author = 'DuelsPlus';

  private ctx!: PluginContext;
  private rosterBusy = false;
  private rosterPrintedForServer: string | null = null;
  private inBedwarsGame = false;
  private bannerSeen = false;
  private currentMode: string | null = null;
  private currentServer: string | null = null;

  private whoNames = new Set<string>();
  private lastWhoAt = 0;
  private rosterAfterWhoTimeout: number | null = null;
  private fallbackRosterTimeout: number | null = null;
  private earlyChats: string[] = [];
  private collectingEarlyChats = false;
  private lastRows: RowModel[] = [];

  private debugChat = false;
  private autoRoster = true;
  private threatAlerts = true;
  private threatFkdrThreshold = 5;
  private threatStarsThreshold = 500;
  private finalKillAlerts = true;
  private bedBreakAlerts = true;
  private streakAlerts = true;

  private game: GameTracker | null = null;
  private session: BedwarsSessionStats = this.freshSession();
  private lastGameWasVictory: boolean | null = null;

  // Last sidebar phase. Backup for game:start / locraw:update, which
  // sometimes miss back-to-back games of the same mode.
  private lastSidebarStatus: BedWarsStatus = BedWarsStatus.NotInBedWars;
  private sidebarPollHandle: number | null = null;

  private freshSession(): BedwarsSessionStats {
    return {
      wins: 0, losses: 0, finalKills: 0, finalDeaths: 0,
      bedsBroken: 0, bedsLost: 0, gamesPlayed: 0,
      winstreak: 0, bestWinstreak: 0, startedAt: Date.now(),
    };
  }

  onLoad(ctx: PluginContext): void {
    this.ctx = ctx;

    this.debugChat = ctx.storage.get<boolean>('debugChat') ?? false;
    this.autoRoster = ctx.storage.get<boolean>('autoRoster') ?? true;
    this.threatAlerts = ctx.storage.get<boolean>('threatAlerts') ?? true;
    this.threatFkdrThreshold = ctx.storage.get<number>('threatFkdrThreshold') ?? 5;
    this.threatStarsThreshold = ctx.storage.get<number>('threatStarsThreshold') ?? 500;
    this.finalKillAlerts = ctx.storage.get<boolean>('finalKillAlerts') ?? true;
    this.bedBreakAlerts = ctx.storage.get<boolean>('bedBreakAlerts') ?? true;
    this.streakAlerts = ctx.storage.get<boolean>('streakAlerts') ?? true;

    const savedSession = ctx.storage.get<BedwarsSessionStats>('session');
    if (savedSession && Date.now() - savedSession.startedAt < 6 * 60 * 60 * 1000) {
      this.session = savedSession;
    }

    ctx.gameModes.register({
      id: 'hypixel-bedwars-queues',
      match: ({ gametype, mode }) => isHypixelMainBedwars(gametype, mode),
      extractStats: (rawPlayer, locrawMode) => {
        const bw = (rawPlayer.stats as Record<string, unknown> | undefined)?.Bedwars as
          | Record<string, number | string>
          | undefined;
        if (!bw) return null;
        const e = getBedwarsStats(locrawMode.toLowerCase(), bw);
        const achievements = rawPlayer.achievements as Record<string, number> | undefined;
        const stars = achievements?.bedwars_level ?? 0;
        return {
          wins: e.winsInMode,
          losses: e.lossesInMode,
          winstreak: e.currentWinstreakInMode,
          bestWinstreak: 0,
          tagKills: e.finalKillsInMode,
          tagDeaths: e.finalDeathsInMode,
          stars,
        };
      },
      statTagColorProfile: 'ratio',
      showHypixelBedwarsStarsInAutoStats: true,
    });

    ctx.events.on('game:start', (payload: GameStartPayload) => {
      if (!isHypixelMainBedwars(payload.gametype, payload.mode)) return;
      this.enterBedwarsGame(payload.mode, ctx.gameState.locraw.server ?? null);
    });

    ctx.events.on('locraw:update', (payload: LocrawUpdatePayload) => {
      const { gametype, mode, server } = payload.data;
      if (!isHypixelMainBedwars(gametype, mode ?? null)) {
        this.resetState();
      } else {
        this.enterBedwarsGame(mode!, server ?? null);
        this.replayEarlyChats();
      }
    });

    ctx.events.on('game:end', (payload: GameEndPayload) => {
      if (this.inBedwarsGame) {
        this.onBedwarsGameEnd(payload);
      }
      this.resetState();
    });
    ctx.events.on('game:leave', () => this.resetState());
    ctx.events.on('lobby:join', () => this.resetState());

    ctx.packets.onClientbound('chat', (data) => {
      this.debugChatPacketToConsole(data);
      this.onChatPacket(data);
    });

    // Sidebar poll. Covers cases where game:end never fires or
    // locraw:update arrives before we've reset.
    this.sidebarPollHandle = ctx.scheduler.setInterval(() => {
      this.pollSidebarState();
    }, 1000);

    this.registerCommands();
  }

  private registerCommands(): void {
    const ctx = this.ctx;

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
      name: 'bwsettings',
      description: 'Open Bedwars plugin settings',
      aliases: ['bws'],
      usage: '/bwsettings',
      execute: () => this.openSettingsGUI(),
    });

    ctx.commands.register({
      name: 'bwcheck',
      description: 'Look up a player\'s Bedwars stats',
      aliases: ['bwc'],
      usage: '/bwcheck <player>',
      execute: (args) => {
        const target = args[0];
        if (!target) {
          ctx.client.sendChat(`${PREFIX} §cUsage: /bwcheck <player>`);
          return;
        }
        void this.lookupPlayer(target);
      },
    });

    ctx.commands.register({
      name: 'bwgame',
      description: 'Show current game stats (FK, FD, beds)',
      aliases: ['bwg'],
      usage: '/bwgame',
      execute: () => this.showGameStats(),
    });

    ctx.commands.register({
      name: 'bwsession',
      description: 'Show Bedwars session stats',
      aliases: ['bwss'],
      usage: '/bwsession [reset]',
      execute: (args) => {
        if (args[0]?.toLowerCase() === 'reset') {
          this.session = this.freshSession();
          this.persistSession();
          ctx.client.sendChat(`${PREFIX} §aSession stats reset.`);
          return;
        }
        this.showSessionStats();
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
          console.log('[Bedwars plugin debug uwu] chat packet debug ON');
        } else if (sub === 'off') {
          this.debugChat = false;
          ctx.storage.set('debugChat', false);
          console.log('[Bedwars plugin debug uwu] chat packet debug OFF');
        } else {
          console.log(`[Bedwars plugin debug uwu] chat debug: ${this.debugChat ? 'ON' : 'OFF'}`);
        }
      },
    });
  }

  private async lookupPlayer(username: string): Promise<void> {
    const ctx = this.ctx;
    ctx.client.sendChat(`${PREFIX} §7Looking up §e${username}§7...`);

    const st = await ctx.players.fetchStatsByUsername(username);
    if (!st) {
      ctx.client.sendChat(`${PREFIX} §cPlayer not found or nicked.`);
      return;
    }

    const bw = st.bedwars;
    if (!bw) {
      ctx.client.sendChat(`${PREFIX} §c${st.displayname} has no Bedwars stats.`);
      return;
    }

    const stars = bw.stars ?? 0;
    const fkdr = safeRatio(bw.finalKills, bw.finalDeaths);
    const wlr = safeRatio(bw.wins, bw.losses);
    const bblr = safeRatio(bw.bedsBroken, bw.losses);
    const starStr = formatBedwarsLevel(stars);

    ctx.client.sendChat(`\n${DIVIDER}`);
    ctx.client.sendChat(`${PREFIX} §6Bedwars Stats §8— §e${st.displayname}`);
    ctx.client.sendChat(`${DIVIDER}`);
    ctx.client.sendChat(`${BULLET} ${starStr} §7Stars`);
    ctx.client.sendChat(`${BULLET} §fW: ${getWinsColorBedwars(bw.wins)}§f, §fL: ${getLossesColor(bw.losses)}§f, §fWLR: ${getWlrColor(wlr)}`);
    ctx.client.sendChat(`${BULLET} §fFK: ${getFinalKillsColor(bw.finalKills)}§f, §fFD: ${getLossesColor(bw.finalDeaths)}§f, §fFKDR: ${getFkdrColor(fkdr)}`);
    ctx.client.sendChat(`${BULLET} §fBeds: §a${bw.bedsBroken}§f, §fBBLR: ${getBblrColor(bblr)}`);
    ctx.client.sendChat(`${DIVIDER}`);
  }

  private showGameStats(): void {
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
    ctx.client.sendChat(`${BULLET} §fFK: ${getFinalKillsColor(g.finalKills)}§f, §fFD: ${getLossesColor(g.finalDeaths)}§f, §fFKDR: ${getFkdrColor(fkdr)}`);
    ctx.client.sendChat(`${BULLET} §fKills: ${getModeWinColor(g.kills)}§f, §fDeaths: ${getLossesColor(g.deaths)}§f, §fKDR: ${getWlrColor(kdr)}`);
    ctx.client.sendChat(`${BULLET} §fBeds Broken: §a${g.bedsBroken}§f, §fBeds Lost: §c${g.bedsLost}`);
    ctx.client.sendChat(`${DIVIDER}`);
  }

  private showSessionStats(): void {
    const ctx = this.ctx;
    const s = this.session;
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
    ctx.client.sendChat(`${BULLET} §fGames: §e${s.gamesPlayed}§f, §fW: ${getWinsColorBedwars(s.wins)}§f, §fL: ${getLossesColor(s.losses)}§f, §fWLR: ${getWlrColor(wlr)}`);
    ctx.client.sendChat(`${BULLET} §fFK: ${getFinalKillsColor(s.finalKills)}§f, §fFD: ${getLossesColor(s.finalDeaths)}§f, §fFKDR: ${getFkdrColor(fkdr)}`);
    ctx.client.sendChat(`${BULLET} §fBeds: §a${s.bedsBroken}§f, §fLost: §c${s.bedsLost}§f, §fBBLR: ${getBblrColor(bblr)}`);
    ctx.client.sendChat(`${BULLET} §fCWS: ${getWinstreakColor(s.winstreak, 'current')}§f, §fBest: ${getWinstreakColor(s.bestWinstreak, 'best')}`);
    ctx.client.sendChat(`${DIVIDER}`);
  }

  private persistSession(): void {
    this.ctx.storage.set('session', this.session);
  }

  private onBedwarsGameEnd(payload: GameEndPayload): void {
    const s = this.session;
    s.gamesPlayed++;

    if (this.game) {
      s.finalKills += this.game.finalKills;
      s.finalDeaths += this.game.finalDeaths;
      s.bedsBroken += this.game.bedsBroken;
      s.bedsLost += this.game.bedsLost;
    }

    if (payload.result === 'victory') {
      s.wins++;
      s.winstreak++;
      if (s.winstreak > s.bestWinstreak) {
        s.bestWinstreak = s.winstreak;
      }
      this.lastGameWasVictory = true;

      if (this.streakAlerts && s.winstreak > 1 && s.winstreak % 3 === 0) {
        this.ctx.client.sendTitle(
          `§6§l${s.winstreak} Winstreak!`,
          '§eKeep it going!',
          { fadeIn: 5, stay: 40, fadeOut: 10 },
        );
        this.ctx.client.playSound('random.levelup', 1.0, 1.5);
      }
    } else if (payload.result === 'defeat') {
      s.losses++;
      if (this.streakAlerts && s.winstreak >= 3) {
        this.ctx.client.sendChat(`${PREFIX} §c${s.winstreak} winstreak ended. §8(§fWLR: ${getWlrColor(safeRatio(s.wins, s.losses))}§8)`);
      }
      s.winstreak = 0;
      this.lastGameWasVictory = false;
    }

    this.persistSession();
  }

  private checkThreats(rows: RowModel[]): void {
    if (!this.threatAlerts) return;
    const ctx = this.ctx;
    const self = ctx.client.username.toLowerCase();

    const threats = rows.filter(
      (r) =>
        !r.nicked &&
        r.username.toLowerCase() !== self &&
        (r.fkdr >= this.threatFkdrThreshold || r.stars >= this.threatStarsThreshold),
    );

    if (threats.length === 0) return;

    ctx.client.playSound('note.pling', 1.0, 0.5);
    ctx.client.sendChat(`${PREFIX} §c§l⚠ §r§c${threats.length} threat${threats.length > 1 ? 's' : ''} detected:`);
    for (const t of threats) {
      const star = formatBedwarsLevel(t.stars);
      const reasons: string[] = [];
      if (t.fkdr >= this.threatFkdrThreshold) reasons.push(`§fFKDR: ${getFkdrColor(t.fkdr)}`);
      if (t.stars >= this.threatStarsThreshold) reasons.push(`§fStars: ${formatBedwarsLevel(t.stars)}`);
      ctx.client.sendChat(
        `  §c▸ ${star} §e${t.username} §8(${reasons.join('§8, ')}§8)`,
      );
    }
  }

  private processBedwarsChat(flat: string): void {
    if (!this.game) return;
    const ctx = this.ctx;
    const self = ctx.client.username;

    if (flat.includes('FINAL KILL')) {
      if (flat.includes(self) && !flat.startsWith(self)) {
        this.game.finalKills++;
        if (this.finalKillAlerts) {
          ctx.client.playSound('random.orb', 0.8, 1.2);
          ctx.client.sendActionBar(`§a§lFinal Kill! §7(${this.game.finalKills} FK this game)`);
        }
      } else if (flat.startsWith(self)) {
        this.game.finalDeaths++;
        if (this.finalKillAlerts) {
          ctx.client.sendActionBar(`§c§lFinal Death! §7(${this.game.finalDeaths} FD this game)`);
        }
      }
    }

    const killMatch = flat.match(/^(\w+) (?:was .+ by|disconnected\.) ?(\w*)/);
    if (killMatch && !flat.includes('FINAL KILL')) {
      if (killMatch[2] === self) {
        this.game.kills++;
      } else if (killMatch[1] === self) {
        this.game.deaths++;
      }
    }

    if (flat.includes('BED DESTRUCTION')) {
      if (flat.includes('Your Bed') || flat.includes('your bed')) {
        this.game.bedsLost++;
        if (this.bedBreakAlerts) {
          ctx.client.playSound('mob.endermen.portal', 1.0, 0.5);
          ctx.client.sendTitle('', '§c§lYour bed was destroyed!', { fadeIn: 3, stay: 30, fadeOut: 10 });
        }
      } else if (flat.includes(self) || flat.includes('you!') || flat.includes('You!')) {
        this.game.bedsBroken++;
        if (this.bedBreakAlerts) {
          ctx.client.playSound('random.levelup', 0.8, 2.0);
          ctx.client.sendActionBar(`§a§lBed Destroyed! §7(${this.game.bedsBroken} beds this game)`);
        }
      } else if (this.bedBreakAlerts) {
        ctx.client.playSound('note.pling', 0.5, 1.5);
      }
    }
  }

  private openSettingsGUI(): void {
    const ctx = this.ctx;
    let gui: PluginChestGUI;
    try {
      gui = ctx.gui.createChestGUI('§cDuels§4+ §8» §fBedwars Settings', 5);
    } catch {
      ctx.client.sendChat(`${PREFIX} §cCould not open settings GUI.`);
      return;
    }

    gui.fillBlack();

    const BW_STAT_OPTIONS = ['None', 'Stars', 'Wins', 'Losses', 'WLR', 'FKDR', 'WS'] as const;
    type BwStat = (typeof BW_STAT_OPTIONS)[number];

    const cycleNext = <T>(current: T, options: readonly T[]): T => {
      const idx = options.indexOf(current);
      return options[(idx + 1) % options.length];
    };

    const makeToggle = (isOn: boolean, name: string, desc: string): ReturnType<typeof ctx.gui.createItem> => {
      return ctx.gui.createItem(
        isOn ? 351 : 352,
        0,
        `${isOn ? '§a' : '§c'}${name}`,
        [isOn ? '§7Status: §aEnabled' : '§7Status: §cDisabled', '', `§7${desc}`, '', '§eClick to toggle'],
      );
    };

    const makeCycle = (value: string, name: string, desc: string, options: readonly string[]): ReturnType<typeof ctx.gui.createItem> => {
      const lore: string[] = [`§7${desc}`, ''];
      for (const opt of options) {
        lore.push(opt === value ? `§a▸ ${opt}` : `§7  ${opt}`);
      }
      lore.push('', '§eClick to cycle');
      return ctx.gui.createItem(MATERIAL_PAPER, 0, `§e${name}: §f${value}`, lore);
    };

    const makeThreshold = (value: number, name: string, desc: string, step: number, min: number, max: number): ReturnType<typeof ctx.gui.createItem> => {
      return ctx.gui.createItem(
        MATERIAL_GOLD_INGOT, 0,
        `§e${name}: §f${value}`,
        [`§7${desc}`, '', `§7Current: §e${value}`, '', '§eLeft-click: +${step}', '§eRight-click: -${step}'],
      );
    };

    const setSetting = (key: string, value: unknown): void => {
      (this as Record<string, unknown>)[key] = value;
      ctx.storage.set(key, value);
    };

    const updateAll = (): void => {
      gui.updateSlot(10, makeToggle(this.autoRoster, 'Auto Roster', 'Print roster on game start'), () => {
        setSetting('autoRoster', !this.autoRoster);
        updateAll();
      });

      const prefix = (ctx.settings.get('statTagsPrefix') as string) || 'None';
      gui.updateSlot(11, makeCycle(prefix, 'Tag Prefix', 'Stat before player name', BW_STAT_OPTIONS), () => {
        const cur = (ctx.settings.get('statTagsPrefix') as string) || 'None';
        ctx.settings.set('statTagsPrefix', cycleNext(cur as BwStat, BW_STAT_OPTIONS));
        updateAll();
      });

      const suffix = (ctx.settings.get('statTagsSuffix') as string) || 'Wins';
      gui.updateSlot(12, makeCycle(suffix, 'Tag Suffix', 'Stat after player name', BW_STAT_OPTIONS), () => {
        const cur = (ctx.settings.get('statTagsSuffix') as string) || 'Wins';
        ctx.settings.set('statTagsSuffix', cycleNext(cur as BwStat, BW_STAT_OPTIONS));
        updateAll();
      });

      gui.updateSlot(19, makeToggle(this.threatAlerts, 'Threat Alerts', 'Warn about high-stat players'), () => {
        setSetting('threatAlerts', !this.threatAlerts);
        updateAll();
      });

      gui.updateSlot(20, makeThreshold(this.threatFkdrThreshold, 'Threat FKDR', 'Min FKDR for threat alert', 1, 1, 50), (_, button) => {
        let v = this.threatFkdrThreshold;
        v = button === 'left' ? Math.min(v + 1, 50) : Math.max(v - 1, 1);
        setSetting('threatFkdrThreshold', v);
        updateAll();
      });

      gui.updateSlot(21, makeThreshold(this.threatStarsThreshold, 'Threat Stars', 'Min stars for threat alert', 100, 100, 5000), (_, button) => {
        let v = this.threatStarsThreshold;
        v = button === 'left' ? Math.min(v + 100, 5000) : Math.max(v - 100, 100);
        setSetting('threatStarsThreshold', v);
        updateAll();
      });

      gui.updateSlot(28, makeToggle(this.finalKillAlerts, 'FK Alerts', 'Sound + action bar on final kills'), () => {
        setSetting('finalKillAlerts', !this.finalKillAlerts);
        updateAll();
      });

      gui.updateSlot(29, makeToggle(this.bedBreakAlerts, 'Bed Alerts', 'Sound + title on bed breaks'), () => {
        setSetting('bedBreakAlerts', !this.bedBreakAlerts);
        updateAll();
      });

      gui.updateSlot(30, makeToggle(this.streakAlerts, 'Streak Alerts', 'Title on winstreak milestones'), () => {
        setSetting('streakAlerts', !this.streakAlerts);
        updateAll();
      });

      gui.updateSlot(31, makeToggle(this.debugChat, 'Debug Chat', 'Log BW chat to console'), () => {
        setSetting('debugChat', !this.debugChat);
        updateAll();
      });

      gui.updateSlot(40, ctx.gui.createItem(MATERIAL_BOOK, 0, '§bSession Stats', ['§7View your BW session', '', '§eClick to view']), () => {
        gui.close();
        this.showSessionStats();
      });

      gui.updateSlot(44, ctx.gui.createItem(MATERIAL_BARRIER, 0, '§cClose', ['§7Close this menu']), () => {
        gui.close();
      });
    };

    updateAll();
    gui.open();
  }

  // TY DESSSSSS
  //
  // Sidebar-driven state machine. This is the primary source of phase
  // transitions; the event system (game:start, game:end, locraw:update)
  // runs alongside but loses to the sidebar on disagreement, since the
  // sidebar tracks what Hypixel is actually showing on screen.
  //
  // NotInBedWars / Lobby: clear any per-game state we still have.
  // Pregame: make sure we're tracking this server+mode. No /who fallback
  // while in queue; the roster isn't committed yet.
  // InGame: make sure we're tracking this server+mode. On the first tick
  // into InGame, fire /who to print the roster.
  //
  // Events still run and still trigger transitions. The next poll tick
  // reconciles anything they got wrong.
  private pollSidebarState(): void {
    // Older proxies don't implement getSidebar(). Kill the poller so we
    // don't throw every second.
    const sb = this.ctx.scoreboard as { getSidebar?: () => unknown };
    if (typeof sb.getSidebar !== 'function') {
      if (this.sidebarPollHandle !== null) {
        this.ctx.scheduler.clearInterval(this.sidebarPollHandle);
        this.sidebarPollHandle = null;
        this.ctx.logger.warn(
          '[Bedwars plugin debug uwu] ctx.scoreboard.getSidebar unavailable; sidebar phase detection disabled. Update the proxy to enable it.',
        );
      }
      return;
    }

    const snapshot = this.ctx.scoreboard.getSidebar();
    const status = getBedWarsStatus(snapshot);
    const prev = this.lastSidebarStatus;
    this.lastSidebarStatus = status;

    // Not in a BW match. Clear any tracking so stale per-game data
    // doesn't bleed into /bwgame or nametags next game.
    if (status === BedWarsStatus.NotInBedWars || status === BedWarsStatus.Lobby) {
      if (this.inBedwarsGame) {
        this.ctx.logger.debug(
          `[Bedwars plugin debug uwu] Sidebar reports ${status === BedWarsStatus.Lobby ? 'Lobby' : 'NotInBedWars'}; resetting per-game state`,
        );
        this.resetState();
      }
      return;
    }

    // In Pregame or InGame. Reconcile server+mode against locraw.
    const server = this.ctx.gameState.locraw.server ?? null;
    const mode = this.ctx.gameState.currentMode ?? this.currentMode;

    // Need a mode for roster and stat extraction. If locraw hasn't
    // arrived yet, the locraw:update handler will call enterBedwarsGame
    // and the next tick picks up from there.
    if (!mode) return;

    // Either we aren't tracking, or the mode/server changed.
    const needsEnter =
      !this.inBedwarsGame ||
      this.currentMode !== mode ||
      (server !== null && this.currentServer !== server);

    if (needsEnter) {
      // Clear any prior tracking so enterBedwarsGame's own guard
      // doesn't short-circuit.
      if (this.inBedwarsGame) {
        this.resetState();
      }
      const isPregame = status === BedWarsStatus.Pregame;
      this.ctx.logger.debug(
        `[Bedwars plugin debug uwu] Sidebar entered ${isPregame ? 'Pregame' : 'InGame'} for server=${server ?? 'unknown'} mode=${mode}`,
      );
      // Skip the 3.5s /who fallback in pregame. Roster isn't committed
      // and /who during queue is just chat spam.
      this.enterBedwarsGame(mode, server, { scheduleFallbackWho: !isPregame });
    }

    // Transition into InGame. This is our authoritative "match started"
    // signal. More reliable than the "Bed Wars" chat banner, which
    // sometimes drowns in chat spam.
    const enteredInGame =
      status === BedWarsStatus.InGame && prev !== BedWarsStatus.InGame;
    if (enteredInGame && this.autoRoster && server && this.rosterPrintedForServer !== server) {
      this.bannerSeen = true; // treat sidebar-in-game as the banner signal
      this.clearFallbackTimeout();
      this.ctx.logger.debug('[Bedwars plugin debug uwu] Sidebar reached InGame phase, sending /who');
      this.requestWhoAndPrintSoon('sidebar');
    }
  }

  private enterBedwarsGame(
    mode: string,
    server: string | null,
    opts: { scheduleFallbackWho?: boolean } = {},
  ): void {
    const scheduleFallbackWho = opts.scheduleFallbackWho ?? true;

    // Only bail out if we're on the same server AND mode. Server always
    // changes between games, so comparing mode alone treats back-to-back
    // games as one.
    if (
      this.inBedwarsGame &&
      this.currentMode === mode &&
      server !== null &&
      this.currentServer === server
    ) {
      return;
    }

    // New game. Wipe per-game tracking before setting up.
    this.clearRosterTimeout();
    this.clearFallbackTimeout();
    this.rosterPrintedForServer = null;
    this.currentMode = mode;
    this.currentServer = server;
    this.whoNames.clear();
    this.bannerSeen = false;
    this.inBedwarsGame = true;
    this.collectingEarlyChats = true;

    this.game = {
      finalKills: 0, finalDeaths: 0,
      bedsBroken: 0, bedsLost: 0,
      kills: 0, deaths: 0,
      startedAt: Date.now(),
    };

    if (this.autoRoster && scheduleFallbackWho) {
      this.fallbackRosterTimeout = this.ctx.scheduler.setTimeout(() => {
        this.fallbackRosterTimeout = null;
        if (this.inBedwarsGame && !this.bannerSeen && this.rosterPrintedForServer === null) {
          this.ctx.logger.debug('[Bedwars plugin debug uwu] Banner not detected, fallback /who trigger');
          this.requestWhoAndPrintSoon('fallback');
        }
      }, 3500);
    }
  }

  private onChatPacket(data: unknown): void {
    const packet = data as { message?: string };
    const raw = packet?.message;
    if (typeof raw !== 'string' || raw.length === 0) return;

    if (this.inBedwarsGame) {
      this.captureWhoResponse(raw);
      const flat = this.extractTextFromChatJson(raw);
      this.processBedwarsChat(flat);
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
    if (!this.inBedwarsGame || this.bannerSeen || !this.autoRoster) return;

    const flat = this.extractTextFromChatJson(raw);
    if (!isBedWarsTitleBanner(flat)) return;

    const server = this.ctx.gameState.locraw.server;
    if (!server || this.rosterPrintedForServer === server) return;

    this.bannerSeen = true;
    this.clearFallbackTimeout();
    this.ctx.logger.debug('[Bedwars plugin debug uwu] Banner detected, sending /who');
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
    console.log(`[Bedwars plugin debug uwu][chat-debug] pos=${String(packet.position ?? -1)} flat=${flat.slice(0, 400)}`);
    try {
      console.log('[Bedwars plugin debug uwu][chat-debug] parsed:', JSON.parse(raw));
    } catch {
      console.log('[Bedwars plugin debug uwu][chat-debug] raw:', raw.slice(0, 300));
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
      ctx.logger.warn('[Bedwars plugin debug uwu] /who returned no ONLINE names after retries');
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
    st: HypixelPlayerStats | null,
    modeKey: string,
  ): RowModel {
    const display = st?.displayname ?? username;
    if (!st) {
      return {
        username: display,
        wins: 0, losses: 0, wlr: 0, fkdr: 0, finalKills: 0, finalDeaths: 0, stars: 0,
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
    const wlr = safeRatio(wins, losses);
    const fd = usedOverallFallback ? overallFd : extracted.finalDeathsInMode;
    const fk = usedOverallFallback ? overallFk : extracted.finalKillsInMode;
    const fkdr = safeRatio(fk, fd);
    const stars = st?.bedwars?.stars ?? 0;
    const severity = wlr * 10_000 + fkdr * 100 + stars;
    return {
      username: display, wins, losses, wlr, fkdr, finalKills: fk, finalDeaths: fd, stars,
      nicked: false, usedOverallFallback, severity,
    };
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
      const mode = ctx.gameState.currentMode ?? this.currentMode ?? modeHint;
      const modeKey = locrawModeToBedwarsApiKey(mode);
      const self = ctx.client.username.toLowerCase();

      ctx.client.sendChat(`\n${DIVIDER}`);
      ctx.client.sendChat(`${PREFIX} §6Bedwars Roster §8(§f${players.length} §7players§8)`);
      ctx.client.sendChat(`${DIVIDER}`);

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

        const star = formatBedwarsLevel(r.stars);
        ctx.client.sendChat(
          `${bullet} ${star} §e${r.username} §fW: ${getWinsColorBedwars(r.wins)}§f, §fWLR: ${getWlrColor(r.wlr)}§f, §fFKDR: ${getFkdrColor(r.fkdr)}`,
        );
      }

      const nickCount = rows.filter((r) => r.nicked).length;
      if (nickCount > 0) {
        ctx.client.sendChat(`${BULLET} §7${nickCount} nicked player${nickCount > 1 ? 's' : ''}`);
      }
      ctx.client.sendChat(`${DIVIDER}`);

      this.rosterPrintedForServer = server;
      this.checkThreats(rows);
    } catch (e) {
      ctx.logger.warn('Bedwars roster failed', e);
    } finally {
      this.rosterBusy = false;
    }
  }

  private openRosterGUI(rows: RowModel[]): void {
    const ctx = this.ctx;
    const self = ctx.client.username.toLowerCase();
    const guiRows = Math.min(6, Math.max(2, Math.ceil(rows.length / 9) + 1)) as 1 | 2 | 3 | 4 | 5 | 6;

    let gui: PluginChestGUI;
    try {
      gui = ctx.gui.createChestGUI(`§cDuels§4+ §8» §fBedwars Roster §7(${rows.length})`, guiRows);
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

      let paneColor: number;
      if (isSelf) paneColor = 3;
      else if (r.fkdr >= 10) paneColor = 14;
      else if (r.fkdr >= 5) paneColor = 1;
      else if (r.fkdr >= 2) paneColor = 4;
      else if (r.fkdr >= 1) paneColor = 5;
      else paneColor = 0;

      const lore: string[] = [
        `§7Stars: ${formatBedwarsLevel(r.stars)}`,
        '',
        `§7Wins: ${getWinsColorBedwars(r.wins)}`,
        `§7Losses: ${getLossesColor(r.losses)}`,
        `§7WLR: ${getWlrColor(r.wlr)}`,
        '',
        `§7Final Kills: ${getFinalKillsColor(r.finalKills)}`,
        `§7Final Deaths: ${getLossesColor(r.finalDeaths)}`,
        `§7FKDR: ${getFkdrColor(r.fkdr)}`,
      ];
      if (r.usedOverallFallback) {
        lore.push('', '§8Overall stats (no mode data)');
      }
      if (!isSelf && (r.fkdr >= this.threatFkdrThreshold || r.stars >= this.threatStarsThreshold)) {
        lore.push('', '§c§l⚠ §r§cThreat');
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
    this.currentServer = null;
    this.whoNames.clear();
    this.earlyChats.length = 0;
    this.collectingEarlyChats = false;
    this.game = null;
    this.clearRosterTimeout();
    this.clearFallbackTimeout();
    // Leave lastSidebarStatus alone. It tracks the sidebar, not our
    // per-game event state; the poll loop refreshes it next tick.
  }

  onDisable(): void {
    if (this.sidebarPollHandle !== null) {
      this.ctx.scheduler.clearInterval(this.sidebarPollHandle);
      this.sidebarPollHandle = null;
    }
    this.resetState();
    this.persistSession();
  }
}
