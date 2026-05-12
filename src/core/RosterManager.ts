import type {
  PluginContext,
  PluginLogger,
  HypixelPlayerStats,
  RosterSource,
  WhoTracker,
  PartyTracker,
} from '@duelsplus/plugin-api';
import type { Settings } from './Settings';
import type { RowModel } from './types';
import { PREFIX, BULLET, SELF_BULLET, DIVIDER } from './constants';
import { locrawModeToBedwarsApiKey } from './modeDetection';
import { getBedwarsStats } from './hypixelBedwarsMode';
import {
  formatBedwarsLevel,
  getWinsColorBedwars,
  getWlrColor,
  getFkdrColor,
  getWinstreakColor,
} from '../util/statColors';
import { isValidUsername } from '../util/chatJson';
import { safeRatio } from '../util/format';
import { openRosterGUI } from '../ui/RosterGUI';

const ROSTER_POLL_MAX_ATTEMPTS = 12;
const ROSTER_POLL_INTERVAL_MS = 400;
const ROSTER_POLL_INITIAL_MS = 500;
// Every Nth tick we re-send /who in case the first one was dropped.
const ROSTER_POLL_RESEND_EVERY = 4;

export class RosterManager {
  private busy = false;
  private printedForServer: string | null = null;
  /** Usernames decorated in the tab list, cleared on resetState. */
  private decoratedUsernames = new Set<string>();
  /** External listeners notified after a roster is computed (GlowManager etc.). */
  private rosterListeners: Array<(rows: RowModel[]) => void> = [];
  lastRows: RowModel[] = [];

  constructor(
    private ctx: PluginContext,
    private settings: Settings,
    private who: WhoTracker,
    private party: PartyTracker,
    private log: PluginLogger,
  ) {}

  getPrintedForServer(): string | null {
    return this.printedForServer;
  }

  /** Lookup a row in the most recent roster by username (case-insensitive). */
  findRow(name: string): RowModel | null {
    const key = name.toLowerCase();
    return this.lastRows.find((r) => r.username.toLowerCase() === key) ?? null;
  }

  /** Subscribe to roster updates. Fires once per /bwroster or /bwparty run. */
  addRosterListener(cb: (rows: RowModel[]) => void): void {
    this.rosterListeners.push(cb);
  }

  clearPrintedForServer(): void {
    this.printedForServer = null;
    // Stickied decorations persist past state-machine resets so the player's
    // last roster badges remain in the lobby tab list until the next game's
    // roster overwrites them.
    if (!this.settings.stickyTabDecorations) {
      this.clearTabListDecorations();
    }
  }

  clearTabListDecorations(): void {
    if (this.decoratedUsernames.size === 0) return;
    for (const name of this.decoratedUsernames) {
      try {
        this.ctx.tabList.clearPlayerDisplay(name);
      } catch {
        /* best-effort */
      }
    }
    this.decoratedUsernames.clear();
  }

  /**
   * Apply tab-list badges for every non-nicked player in the roster.
   * Goes through the player_info UPDATE_DISPLAY_NAME channel which has no
   * 16-byte cap, unlike scoreboard team prefix/suffix.
   */
  private applyTabListDecorations(rows: RowModel[]): void {
    // Always start from a clean slate so a returning player from the prior
    // roster doesn't keep a stale badge after the new /who.
    this.clearTabListDecorations();
    for (const r of rows) {
      if (r.nicked) continue;
      const star = formatBedwarsLevel(r.stars);
      const fkdr = getFkdrColor(r.fkdr);
      const wl = getWlrColor(r.wlr);
      const ws = getWinstreakColor(r.winstreak, 'current');
      // Leading `§r ` separates from the server's name; `§7` trailers keep the
      // comma/label runs grey between coloured stats.
      const suffix = ` §r${star} ${fkdr}§7 fkdr, ${wl}§7 wl, ${ws}§7 ws`;
      try {
        const ok = this.ctx.tabList.setPlayerDisplay(r.username, { suffix });
        if (ok) this.decoratedUsernames.add(r.username);
      } catch {
        /* best-effort */
      }
    }
  }

  // `modeResolver` is called at trigger time so the mode is captured before
  // the tick loop runs.
  requestAndPrint(modeResolver: () => string | null, _reason: string): void {
    this.runRosterFlow({
      source: this.who,
      modeResolver,
      title: 'Bedwars Roster',
      gateOnServer: true,
      applyTabDecorations: true,
      checkThreats: true,
      noNamesMessage: '/who returned no ONLINE names after retries',
    });
  }

  /**
   * Same pipeline as `/bwroster` but pulls names from /p list instead of
   * /who. Not gated by server (party lookups are on-demand and re-runnable)
   * and skips tab decorations + threat alerts because the targets are
   * teammates, not opponents.
   */
  requestAndPrintParty(): void {
    this.runRosterFlow({
      source: this.party,
      modeResolver: () => this.ctx.gameState.currentMode,
      title: 'Party Roster',
      gateOnServer: false,
      applyTabDecorations: false,
      checkThreats: false,
      noNamesMessage: '/p list returned no party members after retries (are you in a party?)',
    });
  }

  // Generic poll + fetch + print pipeline shared by /bwroster and /bwparty.
  private runRosterFlow(opts: {
    source: RosterSource;
    modeResolver: () => string | null;
    title: string;
    gateOnServer: boolean;
    applyTabDecorations: boolean;
    checkThreats: boolean;
    noNamesMessage: string;
  }): void {
    const mode = opts.modeResolver();
    opts.source.clearNames();
    opts.source.send();

    let attempt = 0;
    const tick = (): void => {
      if (opts.gateOnServer && this.printedForServer === this.ctx.gameState.locraw.server) return;
      attempt++;
      if (opts.source.getNames().size > 0) {
        void this.printRoster(mode ?? '', opts);
        return;
      }
      if (attempt <= ROSTER_POLL_MAX_ATTEMPTS) {
        if (attempt % ROSTER_POLL_RESEND_EVERY === 0) opts.source.send();
        opts.source.scheduleRetry(tick, ROSTER_POLL_INTERVAL_MS);
        return;
      }
      this.log.warn(opts.noNamesMessage);
    };
    opts.source.scheduleRetry(tick, ROSTER_POLL_INITIAL_MS);
  }

  openGUI(): void {
    if (this.lastRows.length === 0) {
      this.ctx.client.sendChat(`${PREFIX} §cNo roster data yet.`);
      return;
    }
    openRosterGUI(this.ctx, this.settings, this.lastRows);
  }

  private async printRoster(
    modeHint: string,
    opts: {
      source: RosterSource;
      title: string;
      gateOnServer: boolean;
      applyTabDecorations: boolean;
      checkThreats: boolean;
    },
  ): Promise<void> {
    if (this.busy) return;
    const ctx = this.ctx;
    const server = ctx.gameState.locraw.server;
    if (opts.gateOnServer) {
      if (!server) return;
      if (this.printedForServer === server) return;
    }

    const players = Array.from(opts.source.getNames().values()).filter(isValidUsername);
    if (players.length === 0) return;

    this.busy = true;
    try {
      const mode = ctx.gameState.currentMode ?? modeHint;
      const modeKey = mode ? locrawModeToBedwarsApiKey(mode) : '';
      const self = ctx.client.username.toLowerCase();

      ctx.client.sendChat(`\n${DIVIDER}`);
      ctx.client.sendChat(`${PREFIX} §6${opts.title} §8(§f${players.length} §7players§8)`);
      ctx.client.sendChat(`${DIVIDER}`);

      const results = await Promise.allSettled(
        players.map(async (username) => {
          const st = await ctx.players.fetchStatsByUsername(username);
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
      for (const cb of this.rosterListeners) cb(rows);

      if (opts.applyTabDecorations) {
        // Tab-list decorations are uncapped, unlike the 16-byte scoreboard team
        // prefix channel; cleared on state-machine reset.
        this.applyTabListDecorations(rows);
      }

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

      if (opts.gateOnServer && server) {
        this.printedForServer = server;
      }
      if (opts.checkThreats) {
        this.checkThreats(rows);
      }
    } catch (e) {
      this.log.warn('roster fetch/print failed', e);
    } finally {
      this.busy = false;
    }
  }

  // Falls back to overall Bedwars stats when the active mode has no data
  // (common for lightly played rotating queues).
  private buildRow(
    username: string,
    st: HypixelPlayerStats | null,
    modeKey: string,
  ): RowModel {
    const display = st?.displayname ?? username;
    if (!st) {
      return {
        username: display,
        uuid: null,
        wins: 0,
        losses: 0,
        wlr: 0,
        fkdr: 0,
        finalKills: 0,
        finalDeaths: 0,
        stars: 0,
        winstreak: 0,
        nicked: true,
        usedOverallFallback: false,
        severity: -1,
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

    // The Hypixel `winstreak` field is sometimes missing for fresh accounts
    // and sometimes a string; coerce defensively.
    const overallWinstreakRaw = (bwRaw['winstreak'] as number | string | undefined) ?? 0;
    const overallWinstreak = typeof overallWinstreakRaw === 'string'
      ? parseInt(overallWinstreakRaw, 10) || 0
      : overallWinstreakRaw;
    const winstreak = usedOverallFallback
      ? overallWinstreak
      : (extracted.currentWinstreakInMode || overallWinstreak);

    const severity = wlr * 10_000 + fkdr * 100 + stars;
    return {
      username: display,
      uuid: st?.uuid ?? null,
      wins,
      losses,
      wlr,
      fkdr,
      finalKills: fk,
      finalDeaths: fd,
      stars,
      winstreak,
      nicked: false,
      usedOverallFallback,
      severity,
    };
  }

  private checkThreats(rows: RowModel[]): void {
    if (!this.settings.threatAlerts) return;
    const ctx = this.ctx;
    const self = ctx.client.username.toLowerCase();

    const threats = rows.filter(
      (r) =>
        !r.nicked &&
        r.username.toLowerCase() !== self &&
        (r.fkdr >= this.settings.threatFkdrThreshold ||
          r.stars >= this.settings.threatStarsThreshold),
    );

    if (threats.length === 0) return;

    // Pitch by worst-threat tier so the user can size up the lobby by ear:
    // the higher the FKDR of the worst player, the higher (more urgent) the pitch.
    const worstFkdr = Math.max(...threats.map((t) => t.fkdr));
    const pitch =
      worstFkdr >= 30 ? 2.0 :
      worstFkdr >= 20 ? 1.5 :
      worstFkdr >= 10 ? 1.0 :
      0.5;
    ctx.client.playSound('note.pling', 1.0, pitch);

    ctx.client.sendChat(
      `${PREFIX} §c§l⚠ §r§c${threats.length} threat${threats.length > 1 ? 's' : ''} detected:`,
    );
    for (const t of threats) {
      const star = formatBedwarsLevel(t.stars);
      const reasons: string[] = [];
      if (t.fkdr >= this.settings.threatFkdrThreshold) {
        reasons.push(`§fFKDR: ${getFkdrColor(t.fkdr)}`);
      }
      if (t.stars >= this.settings.threatStarsThreshold) {
        reasons.push(`§fStars: ${formatBedwarsLevel(t.stars)}`);
      }
      ctx.client.sendChat(
        `  §c▸ ${star} §e${t.username} §8(${reasons.join('§8, ')}§8)`,
      );
    }
  }
}
