import {
  Plugin,
  createLogger,
  type PluginContext,
  type GameStartPayload,
  type GameEndPayload,
  type LocrawUpdatePayload,
  type PluginStatTagOption,
  type ScopedLogger,
} from '@duelsplus/plugin-api';

import { getBedwarsStats } from './core/hypixelBedwarsMode';
import {
  formatBedwarsLevel,
  getWinsColorBedwars,
  getWlrColor,
  getFkdrColor,
  getLossesColor,
  getBblrColor,
  getFinalKillsColor,
} from './util/statColors';
import { PREFIX, BULLET, DIVIDER } from './core/constants';
import { isHypixelMainBedwars } from './core/modeDetection';
import { safeRatio } from './util/format';
import { extractTextFromChatJson } from './util/chatJson';
import { Settings } from './core/Settings';
import { Session } from './core/Session';
import { GameStatsTracker } from './core/GameStatsTracker';
import { WhoTracker } from './core/WhoTracker';
import { RosterManager } from './core/RosterManager';
import { StateMachine } from './core/StateMachine';
import { openSettingsGUI } from './ui/SettingsGUI';

export default class BedwarsPlugin extends Plugin {
  id = 'bedwars';
  name = 'Bedwars Plugin';
  description = 'Official Bedwars plugin for Duels+ proxy';
  version = '2.0.0';
  author = 'DuelsPlus';

  private ctx!: PluginContext;
  private settings!: Settings;
  private session!: Session;
  private gameStats!: GameStatsTracker;
  private whoTracker!: WhoTracker;
  private roster!: RosterManager;
  // `Plugin.state` is taken by the base lifecycle getter, hence `stateMachine`.
  private stateMachine!: StateMachine;
  private chatDebugLog!: ScopedLogger;

  onLoad(ctx: PluginContext): void {
    this.ctx = ctx;

    const stateLog = createLogger(ctx.logger, 'state-machine');
    const rosterLog = createLogger(ctx.logger, 'roster');
    this.chatDebugLog = createLogger(ctx.logger, 'chat-debug');

    this.settings = new Settings(ctx);
    this.session = new Session(ctx, this.settings);
    this.gameStats = new GameStatsTracker(ctx, this.settings);
    this.whoTracker = new WhoTracker(ctx);
    this.roster = new RosterManager(ctx, this.settings, this.whoTracker, rosterLog);
    this.stateMachine = new StateMachine(
      ctx,
      this.settings,
      this.roster,
      this.gameStats,
      this.whoTracker,
      stateLog,
    );

    // Stat-tag options surfaced in /ds prefix/suffix cycles while the user is
    // in a matching Bedwars mode.
    const fkdrOption: PluginStatTagOption = {
      id: 'FKDR',
      display: 'FKDR',
      extract: (stats) => {
        const fk = stats.tagKills;
        const fd = stats.tagDeaths;
        const raw = fd === 0 ? fk : Math.round((fk / fd) * 100) / 100;
        return { display: raw.toFixed(2), raw };
      },
      color: 'ratio',
    };
    const starsOption: PluginStatTagOption = {
      id: 'Stars',
      display: 'Stars',
      extract: (stats) => {
        const raw = stats.level ?? 0;
        return { display: String(raw), raw };
      },
      color: 'level',
    };

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
        const level = achievements?.bedwars_level ?? 0;
        return {
          wins: e.winsInMode,
          losses: e.lossesInMode,
          winstreak: e.currentWinstreakInMode,
          bestWinstreak: 0,
          tagKills: e.finalKillsInMode,
          tagDeaths: e.finalDeathsInMode,
          level,
        };
      },
      statTagColorProfile: 'ratio',
      showLevelInAutoStats: true,
      statTagOptions: [fkdrOption, starsOption],
    });

    ctx.events.on('game:start', (payload: GameStartPayload) => {
      if (!isHypixelMainBedwars(payload.gametype, payload.mode)) return;
      this.stateMachine.enterBedwarsGame(
        payload.mode,
        ctx.gameState.locraw.server ?? null,
      );
    });

    ctx.events.on('locraw:update', (payload: LocrawUpdatePayload) => {
      const { gametype, mode, server } = payload.data;
      if (!isHypixelMainBedwars(gametype, mode ?? null)) {
        this.stateMachine.resetState();
      } else {
        this.stateMachine.enterBedwarsGame(mode!, server ?? null);
        this.stateMachine.replayEarlyChats();
      }
    });

    ctx.events.on('game:end', (payload: GameEndPayload) => {
      if (this.stateMachine.inBedwarsGame) {
        this.session.onGameEnd(payload, this.gameStats.current);
      }
      this.stateMachine.resetState();
    });
    ctx.events.on('game:leave', () => this.stateMachine.resetState());
    ctx.events.on('lobby:join', () => this.stateMachine.resetState());

    ctx.packets.onClientbound('chat', (data) => {
      this.debugChatPacket(data);
      this.stateMachine.onChatPacket(data);
    });

    // Fallback for cases where game:end never fires or locraw:update arrives stale.
    this.stateMachine.startSidebarPoll();

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
          this.roster.openGUI();
          return;
        }
        if (
          !isHypixelMainBedwars(
            ctx.gameState.currentGametype,
            ctx.gameState.currentMode,
          )
        ) {
          ctx.client.sendChat(`${PREFIX} §cNot in main Bedwars.`);
          return;
        }
        this.stateMachine.currentMode = ctx.gameState.currentMode;
        this.roster.requestAndPrint(() => this.stateMachine.currentMode, 'manual');
      },
    });

    ctx.commands.register({
      name: 'bwsettings',
      description: 'Open Bedwars plugin settings',
      aliases: ['bws'],
      usage: '/bwsettings',
      execute: () => openSettingsGUI(this.ctx, this.settings, this.session),
    });

    ctx.commands.register({
      name: 'bwcheck',
      description: "Look up a player's Bedwars stats",
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
      execute: () => this.gameStats.show(),
    });

    ctx.commands.register({
      name: 'bwsession',
      description: 'Show Bedwars session stats',
      aliases: ['bwss'],
      usage: '/bwsession [reset]',
      execute: (args) => {
        if (args[0]?.toLowerCase() === 'reset') {
          this.session.reset();
          ctx.client.sendChat(`${PREFIX} §aSession stats reset.`);
          return;
        }
        this.session.show();
      },
    });

    ctx.commands.register({
      name: 'bwdebugchat',
      description: 'Log Bedwars chat packets to the proxy console',
      usage: '/bwdebugchat [on|off]',
      execute: (args) => {
        const sub = args[0]?.toLowerCase();
        if (sub === 'on') {
          this.settings.set('debugChat', true);
          ctx.logger.info('[Bedwars plugin debug uwu] chat packet debug ON');
        } else if (sub === 'off') {
          this.settings.set('debugChat', false);
          ctx.logger.info('[Bedwars plugin debug uwu] chat packet debug OFF');
        } else {
          ctx.logger.info(
            `[Bedwars plugin debug uwu] chat debug: ${this.settings.debugChat ? 'ON' : 'OFF'}`,
          );
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
    const bblr = safeRatio(bw.bedsBroken, bw.bedsLost);
    const starStr = formatBedwarsLevel(stars);

    ctx.client.sendChat(`\n${DIVIDER}`);
    ctx.client.sendChat(`${PREFIX} §6Bedwars Stats §8— §e${st.displayname}`);
    ctx.client.sendChat(`${DIVIDER}`);
    ctx.client.sendChat(`${BULLET} ${starStr} §7Stars`);
    ctx.client.sendChat(
      `${BULLET} §fW: ${getWinsColorBedwars(bw.wins)}§f, §fL: ${getLossesColor(bw.losses)}§f, §fWLR: ${getWlrColor(wlr)}`,
    );
    ctx.client.sendChat(
      `${BULLET} §fFK: ${getFinalKillsColor(bw.finalKills)}§f, §fFD: ${getLossesColor(bw.finalDeaths)}§f, §fFKDR: ${getFkdrColor(fkdr)}`,
    );
    ctx.client.sendChat(
      `${BULLET} §fBB: §a${bw.bedsBroken}§f, §fBL: §c${bw.bedsLost}§f, §fBBLR: ${getBblrColor(bblr)}`,
    );
    ctx.client.sendChat(`${DIVIDER}`);
  }

  private debugChatPacket(data: unknown): void {
    if (!this.settings.debugChat) return;
    if (this.ctx.gameState.locraw.gametype !== 'BEDWARS') return;

    const packet = data as { message?: string; position?: number };
    const raw = packet?.message;
    if (typeof raw !== 'string' || raw.length === 0) return;

    const flat = extractTextFromChatJson(raw);
    this.ctx.logger.debug(
      `[Bedwars plugin debug uwu][chat-debug] pos=${String(packet.position ?? -1)} flat=${flat.slice(0, 400)}`,
    );
    try {
      this.ctx.logger.debug('[Bedwars plugin debug uwu][chat-debug] parsed:', JSON.parse(raw));
    } catch {
      this.ctx.logger.debug('[Bedwars plugin debug uwu][chat-debug] raw:', raw.slice(0, 300));
    }
  }

  onDisable(): void {
    this.stateMachine.stopSidebarPoll();
    this.stateMachine.resetState();
    this.session.persist();
  }
}
