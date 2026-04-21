import type { PluginContext, HypixelPlayerStats } from '@duelsplus/plugin-api';
import type { Settings } from './Settings';
import type { WhoTracker } from './WhoTracker';
import type { RowModel } from './types';
import { PREFIX, BULLET, SELF_BULLET, DIVIDER } from './constants';
import { locrawModeToBedwarsApiKey } from './modeDetection';
import { getBedwarsStats } from './hypixelBedwarsMode';
import {
  formatBedwarsLevel,
  getWinsColorBedwars,
  getWlrColor,
  getFkdrColor,
} from '../util/statColors';
import { isValidUsername } from '../util/chatJson';
import { safeRatio } from '../util/format';
import { openRosterGUI } from '../ui/RosterGUI';

// Max retries for the tick loop that waits for /who names to arrive.
const ROSTER_POLL_MAX_ATTEMPTS = 12;
// Delay between retries of the tick loop (ms).
const ROSTER_POLL_INTERVAL_MS = 400;
// Initial delay before the first tick runs, giving /who time to reply.
const ROSTER_POLL_INITIAL_MS = 500;
// Every Nth tick we re-send /who in case the first one was dropped.
const ROSTER_POLL_RESEND_EVERY = 4;

// Drives roster printing: fires /who, waits for names, fetches stats,
// prints the color-coded chat roster, and warns about threats.
// Also exposes the last computed rows so the GUI command can show
// them without re-fetching.
export class RosterManager {
  private busy = false;
  private printedForServer: string | null = null;
  lastRows: RowModel[] = [];

  constructor(
    private ctx: PluginContext,
    private settings: Settings,
    private who: WhoTracker,
  ) {}

  getPrintedForServer(): string | null {
    return this.printedForServer;
  }

  clearPrintedForServer(): void {
    this.printedForServer = null;
  }

  // Trigger: send /who, retry until we have names, then print.
  // `modeResolver` is called at trigger time to capture the current
  // mode for use throughout the tick loop (matches the original
  // closure-capture behavior).
  requestAndPrint(modeResolver: () => string | null, _reason: string): void {
    const ctx = this.ctx;
    const mode = modeResolver();
    if (!mode) return;

    this.who.clearNames();
    this.who.sendWho();

    let attempt = 0;
    const tick = (): void => {
      if (this.printedForServer === ctx.gameState.locraw.server) return;
      attempt++;
      if (this.who.getNames().size > 0) {
        void this.printRoster(mode);
        return;
      }
      if (attempt <= ROSTER_POLL_MAX_ATTEMPTS) {
        if (attempt % ROSTER_POLL_RESEND_EVERY === 0) this.who.sendWho();
        this.who.scheduleRetry(tick, ROSTER_POLL_INTERVAL_MS);
        return;
      }
      ctx.logger.warn('[Bedwars plugin debug uwu] /who returned no ONLINE names after retries');
    };
    this.who.scheduleRetry(tick, ROSTER_POLL_INITIAL_MS);
  }

  // Open the GUI roster using the last printed rows. If no rows yet,
  // tell the user.
  openGUI(): void {
    if (this.lastRows.length === 0) {
      this.ctx.client.sendChat(`${PREFIX} §cNo roster data yet.`);
      return;
    }
    openRosterGUI(this.ctx, this.settings, this.lastRows);
  }

  // Fetch stats for every player we captured, print a sorted chat
  // roster, and run threat detection.
  private async printRoster(modeHint: string): Promise<void> {
    if (this.busy) return;
    const ctx = this.ctx;
    const server = ctx.gameState.locraw.server;
    if (!server) return;
    if (this.printedForServer === server) return;

    const players = Array.from(this.who.getNames().values()).filter(isValidUsername);
    if (players.length === 0) return;

    this.busy = true;
    try {
      const mode = ctx.gameState.currentMode ?? modeHint;
      const modeKey = locrawModeToBedwarsApiKey(mode);
      const self = ctx.client.username.toLowerCase();

      ctx.client.sendChat(`\n${DIVIDER}`);
      ctx.client.sendChat(`${PREFIX} §6Bedwars Roster §8(§f${players.length} §7players§8)`);
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

      this.printedForServer = server;
      this.checkThreats(rows);
    } catch (e) {
      ctx.logger.warn('Bedwars roster failed', e);
    } finally {
      this.busy = false;
    }
  }

  // Turn a player's stats blob into a display row. Falls back to overall
  // Bedwars stats when the current mode has no data (common for lightly
  // played rotating queues).
  private buildRow(
    username: string,
    st: HypixelPlayerStats | null,
    modeKey: string,
  ): RowModel {
    const display = st?.displayname ?? username;
    if (!st) {
      return {
        username: display,
        wins: 0,
        losses: 0,
        wlr: 0,
        fkdr: 0,
        finalKills: 0,
        finalDeaths: 0,
        stars: 0,
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
    const severity = wlr * 10_000 + fkdr * 100 + stars;
    return {
      username: display,
      wins,
      losses,
      wlr,
      fkdr,
      finalKills: fk,
      finalDeaths: fd,
      stars,
      nicked: false,
      usedOverallFallback,
      severity,
    };
  }

  // Emit a chat warning for high-stat opponents. Skips self and nicked
  // players; gated by the user's threat-alert setting.
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

    ctx.client.playSound('note.pling', 1.0, 0.5);
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
