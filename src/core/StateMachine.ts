import {
  EarlyChatBuffer,
  GamePhaseDriver,
  type PluginContext,
  type PluginLogger,
  type WhoTracker,
} from '@duelsplus/plugin-api';
import type { Settings } from './Settings';
import type { RosterManager } from './RosterManager';
import type { GameStatsTracker } from './GameStatsTracker';
import { BedWarsStatus, getBedWarsStatus } from './gameModeUtil';
import { isBedWarsTitleBanner } from './modeDetection';
import { extractTextFromChatJson } from '../util/chatJson';

// How long to wait for the "BED WARS" banner before falling back to /who.
const FALLBACK_WHO_DELAY_MS = 3500;

// TY DESSSSSS
// Sidebar is the primary phase source; game:start / game:end / locraw:update
// run alongside but lose to the sidebar on disagreement.
export class StateMachine {
  inBedwarsGame = false;
  bannerSeen = false;
  currentMode: string | null = null;
  currentServer: string | null = null;

  private earlyChats = new EarlyChatBuffer();
  private fallbackRosterTimeout: number | null = null;
  private driver: GamePhaseDriver<BedWarsStatus>;

  constructor(
    private ctx: PluginContext,
    private settings: Settings,
    private roster: RosterManager,
    private gameStats: GameStatsTracker,
    private who: WhoTracker,
    private log: PluginLogger,
  ) {
    this.driver = new GamePhaseDriver<BedWarsStatus>(ctx, {
      detectPhase: getBedWarsStatus,
      onUnsupported: () =>
        this.log.warn(
          'ctx.scoreboard.getSidebar unavailable; sidebar phase detection disabled. Update the proxy to enable it.',
        ),
    });
    this.driver.onTransition((prev, next) => this.onPhaseTransition(prev, next));
    this.driver.onPoll((current) => this.reconcileWithLocraw(current));
  }

  startSidebarPoll(): void {
    this.driver.start();
  }

  stopSidebarPoll(): void {
    this.driver.stop();
  }

  // Idempotent on the same server+mode; otherwise resets per-game state and
  // arms a fallback /who timer.
  enterBedwarsGame(
    mode: string,
    server: string | null,
    opts: { scheduleFallbackWho?: boolean } = {},
  ): void {
    const scheduleFallbackWho = opts.scheduleFallbackWho ?? true;

    // Server always changes between games, so mode alone would treat
    // back-to-back games as one.
    if (
      this.inBedwarsGame &&
      this.currentMode === mode &&
      server !== null &&
      this.currentServer === server
    ) {
      return;
    }

    this.who.clearRetry();
    this.clearFallbackTimeout();
    this.roster.clearPrintedForServer();
    this.currentMode = mode;
    this.currentServer = server;
    this.who.clearNames();
    this.bannerSeen = false;
    this.inBedwarsGame = true;
    this.earlyChats.start();
    this.gameStats.begin();

    if (this.settings.autoRoster && scheduleFallbackWho) {
      this.fallbackRosterTimeout = this.ctx.scheduler.setTimeout(() => {
        this.fallbackRosterTimeout = null;
        if (
          this.inBedwarsGame &&
          !this.bannerSeen &&
          this.roster.getPrintedForServer() === null
        ) {
          this.log.debug('Banner not detected, fallback /who trigger');
          this.roster.requestAndPrint(
            () => this.currentMode ?? this.ctx.gameState.currentMode,
            'fallback',
          );
        }
      }, FALLBACK_WHO_DELAY_MS);
    }
  }

  resetState(): void {
    this.inBedwarsGame = false;
    this.bannerSeen = false;
    this.roster.clearPrintedForServer();
    this.currentMode = null;
    this.currentServer = null;
    this.who.clearNames();
    this.earlyChats.clear();
    this.gameStats.clear();
    this.who.clearRetry();
    this.clearFallbackTimeout();
  }

  onChatPacket(data: unknown): void {
    const packet = data as { message?: string };
    const raw = packet?.message;
    if (typeof raw !== 'string' || raw.length === 0) return;

    if (this.inBedwarsGame) {
      this.who.captureResponse(raw);
      const flat = extractTextFromChatJson(raw);
      this.gameStats.processChat(flat);
    }

    if (this.earlyChats.isCollecting && !this.inBedwarsGame) {
      this.earlyChats.push(raw);
      return;
    }

    this.tryDetectBanner(raw);
  }

  // Drains chats captured before locraw arrived so the banner / /who response
  // aren't missed when they came first.
  replayEarlyChats(): void {
    for (const raw of this.earlyChats.drain()) {
      this.who.captureResponse(raw);
      this.tryDetectBanner(raw);
    }
  }

  private tryDetectBanner(raw: string): void {
    if (!this.inBedwarsGame || this.bannerSeen || !this.settings.autoRoster) return;

    const flat = extractTextFromChatJson(raw);
    if (!isBedWarsTitleBanner(flat)) return;

    const server = this.ctx.gameState.locraw.server;
    if (!server || this.roster.getPrintedForServer() === server) return;

    this.bannerSeen = true;
    this.clearFallbackTimeout();
    this.log.debug('Banner detected, sending /who');
    this.roster.requestAndPrint(
      () => this.currentMode ?? this.ctx.gameState.currentMode,
      'banner',
    );
  }

  // Phase transitions: reset on Lobby/NotInBedWars, kick the roster on InGame.
  private onPhaseTransition(prev: BedWarsStatus | null, next: BedWarsStatus): void {
    if (next === BedWarsStatus.NotInBedWars || next === BedWarsStatus.Lobby) {
      if (this.inBedwarsGame) {
        this.log.debug(
          `Sidebar reports ${next === BedWarsStatus.Lobby ? 'Lobby' : 'NotInBedWars'}; resetting per-game state`,
        );
        this.resetState();
      }
      return;
    }

    // Sidebar reaching InGame is the authoritative "match started" signal;
    // more reliable than the "Bed Wars" chat banner.
    const enteredInGame = next === BedWarsStatus.InGame && prev !== BedWarsStatus.InGame;
    if (!enteredInGame) return;

    const server = this.ctx.gameState.locraw.server;
    if (
      this.settings.autoRoster &&
      server &&
      this.roster.getPrintedForServer() !== server
    ) {
      this.bannerSeen = true;
      this.clearFallbackTimeout();
      this.log.debug('Sidebar reached InGame phase, sending /who');
      this.roster.requestAndPrint(
        () => this.currentMode ?? this.ctx.gameState.currentMode,
        'sidebar',
      );
    }
  }

  // Defensive per-tick reconcile: catches the case where locraw mutated without
  // firing locraw:update, or where we entered Pregame/InGame before locraw
  // delivered a mode.
  private reconcileWithLocraw(status: BedWarsStatus): void {
    if (status === BedWarsStatus.NotInBedWars || status === BedWarsStatus.Lobby) {
      return;
    }
    const server = this.ctx.gameState.locraw.server ?? null;
    const mode = this.ctx.gameState.currentMode ?? this.currentMode;
    if (!mode) return;

    const needsEnter =
      !this.inBedwarsGame ||
      this.currentMode !== mode ||
      (server !== null && this.currentServer !== server);
    if (!needsEnter) return;

    if (this.inBedwarsGame) this.resetState();
    const isPregame = status === BedWarsStatus.Pregame;
    this.log.debug(
      `Sidebar entered ${isPregame ? 'Pregame' : 'InGame'} for server=${server ?? 'unknown'} mode=${mode}`,
    );
    // /who during queue is just chat spam; roster isn't committed yet.
    this.enterBedwarsGame(mode, server, { scheduleFallbackWho: !isPregame });
  }

  private clearFallbackTimeout(): void {
    if (this.fallbackRosterTimeout !== null) {
      this.ctx.scheduler.clearTimeout(this.fallbackRosterTimeout);
      this.fallbackRosterTimeout = null;
    }
  }
}
