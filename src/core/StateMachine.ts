import type { PluginContext } from '@duelsplus/plugin-api';
import type { Settings } from './Settings';
import type { RosterManager } from './RosterManager';
import type { GameStatsTracker } from './GameStatsTracker';
import type { WhoTracker } from './WhoTracker';
import { BedWarsStatus, getBedWarsStatus } from './gameModeUtil';
import { isBedWarsTitleBanner } from './modeDetection';
import { extractTextFromChatJson } from '../util/chatJson';

// 1s matches Hypixel's sidebar refresh cadence.
const SIDEBAR_POLL_INTERVAL_MS = 1000;

// How long to wait for the "BED WARS" banner before falling back to /who.
const FALLBACK_WHO_DELAY_MS = 3500;

// Cap on the pre-entry chat replay buffer.
const EARLY_CHAT_BUFFER_MAX = 50;

// TY DESSSSSS
// Sidebar is the primary phase source; game:start / game:end / locraw:update
// run alongside but lose to the sidebar on disagreement.
export class StateMachine {
  inBedwarsGame = false;
  bannerSeen = false;
  currentMode: string | null = null;
  currentServer: string | null = null;

  private earlyChats: string[] = [];
  private collectingEarlyChats = false;
  private fallbackRosterTimeout: number | null = null;

  // Backup for game:start / locraw:update, which sometimes miss back-to-back
  // games of the same mode.
  private lastSidebarStatus: BedWarsStatus = BedWarsStatus.NotInBedWars;
  private sidebarPollHandle: number | null = null;

  constructor(
    private ctx: PluginContext,
    private settings: Settings,
    private roster: RosterManager,
    private gameStats: GameStatsTracker,
    private who: WhoTracker,
  ) {}

  startSidebarPoll(): void {
    this.sidebarPollHandle = this.ctx.scheduler.setInterval(
      () => this.pollSidebarState(),
      SIDEBAR_POLL_INTERVAL_MS,
    );
  }

  stopSidebarPoll(): void {
    if (this.sidebarPollHandle !== null) {
      this.ctx.scheduler.clearInterval(this.sidebarPollHandle);
      this.sidebarPollHandle = null;
    }
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
    this.collectingEarlyChats = true;
    this.gameStats.begin();

    if (this.settings.autoRoster && scheduleFallbackWho) {
      this.fallbackRosterTimeout = this.ctx.scheduler.setTimeout(() => {
        this.fallbackRosterTimeout = null;
        if (
          this.inBedwarsGame &&
          !this.bannerSeen &&
          this.roster.getPrintedForServer() === null
        ) {
          this.ctx.logger.debug(
            '[Bedwars plugin debug uwu] Banner not detected, fallback /who trigger',
          );
          this.roster.requestAndPrint(
            () => this.currentMode ?? this.ctx.gameState.currentMode,
            'fallback',
          );
        }
      }, FALLBACK_WHO_DELAY_MS);
    }
  }

  // Leaves `lastSidebarStatus` alone; the poll loop refreshes it next tick.
  resetState(): void {
    this.inBedwarsGame = false;
    this.bannerSeen = false;
    this.roster.clearPrintedForServer();
    this.currentMode = null;
    this.currentServer = null;
    this.who.clearNames();
    this.earlyChats.length = 0;
    this.collectingEarlyChats = false;
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

    if (this.collectingEarlyChats && !this.inBedwarsGame) {
      if (this.earlyChats.length < EARLY_CHAT_BUFFER_MAX) {
        this.earlyChats.push(raw);
      }
      return;
    }

    this.tryDetectBanner(raw);
  }

  // Drains chats captured before locraw arrived so the banner / /who response
  // aren't missed when they came first.
  replayEarlyChats(): void {
    this.collectingEarlyChats = false;
    const chats = this.earlyChats.splice(0);
    for (const raw of chats) {
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
    this.ctx.logger.debug('[Bedwars plugin debug uwu] Banner detected, sending /who');
    this.roster.requestAndPrint(
      () => this.currentMode ?? this.ctx.gameState.currentMode,
      'banner',
    );
  }

  private pollSidebarState(): void {
    // Older proxies don't implement getSidebar(); kill the poller so we don't
    // throw every second.
    const sb = this.ctx.scoreboard as { getSidebar?: () => unknown };
    if (typeof sb.getSidebar !== 'function') {
      this.stopSidebarPoll();
      this.ctx.logger.warn(
        '[Bedwars plugin debug uwu] ctx.scoreboard.getSidebar unavailable; sidebar phase detection disabled. Update the proxy to enable it.',
      );
      return;
    }

    const snapshot = this.ctx.scoreboard.getSidebar();
    const status = getBedWarsStatus(snapshot);
    const prev = this.lastSidebarStatus;
    this.lastSidebarStatus = status;

    // Clear tracking so stale per-game data doesn't bleed into /bwgame next game.
    if (status === BedWarsStatus.NotInBedWars || status === BedWarsStatus.Lobby) {
      if (this.inBedwarsGame) {
        this.ctx.logger.debug(
          `[Bedwars plugin debug uwu] Sidebar reports ${status === BedWarsStatus.Lobby ? 'Lobby' : 'NotInBedWars'}; resetting per-game state`,
        );
        this.resetState();
      }
      return;
    }

    // Pregame or InGame: reconcile server+mode against locraw.
    const server = this.ctx.gameState.locraw.server ?? null;
    const mode = this.ctx.gameState.currentMode ?? this.currentMode;

    // Without a mode there's nothing for the roster / stat extractor to do;
    // locraw:update will call enterBedwarsGame and the next tick will pick up.
    if (!mode) return;

    const needsEnter =
      !this.inBedwarsGame ||
      this.currentMode !== mode ||
      (server !== null && this.currentServer !== server);

    if (needsEnter) {
      // enterBedwarsGame's own guard would short-circuit without this reset.
      if (this.inBedwarsGame) {
        this.resetState();
      }
      const isPregame = status === BedWarsStatus.Pregame;
      this.ctx.logger.debug(
        `[Bedwars plugin debug uwu] Sidebar entered ${isPregame ? 'Pregame' : 'InGame'} for server=${server ?? 'unknown'} mode=${mode}`,
      );
      // /who during queue is just chat spam; roster isn't committed yet.
      this.enterBedwarsGame(mode, server, { scheduleFallbackWho: !isPregame });
    }

    // Sidebar reaching InGame is the authoritative "match started" signal;
    // more reliable than the "Bed Wars" chat banner.
    const enteredInGame =
      status === BedWarsStatus.InGame && prev !== BedWarsStatus.InGame;
    if (
      enteredInGame &&
      this.settings.autoRoster &&
      server &&
      this.roster.getPrintedForServer() !== server
    ) {
      this.bannerSeen = true; // treat sidebar-in-game as the banner signal
      this.clearFallbackTimeout();
      this.ctx.logger.debug('[Bedwars plugin debug uwu] Sidebar reached InGame phase, sending /who');
      this.roster.requestAndPrint(
        () => this.currentMode ?? this.ctx.gameState.currentMode,
        'sidebar',
      );
    }
  }

  private clearFallbackTimeout(): void {
    if (this.fallbackRosterTimeout !== null) {
      this.ctx.scheduler.clearTimeout(this.fallbackRosterTimeout);
      this.fallbackRosterTimeout = null;
    }
  }
}
