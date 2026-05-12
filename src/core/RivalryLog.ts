import type { PluginContext, GameEndPayload } from '@duelsplus/plugin-api';
import type { RivalryEntry, RivalryStore, RowModel } from './types';
import { PREFIX, BULLET, DIVIDER } from './constants';
import { safeRatio } from '../util/format';
import { getWlrColor } from '../util/statColors';

const STORAGE_KEY = 'rivalries';
const DEFAULT_LIST_LIMIT = 10;

function freshEntry(): RivalryEntry {
  return { wins: 0, losses: 0, gamesShared: 0, lastSeen: 0 };
}

// Records "who I've shared lobbies with" alongside session W/L versus that
// lobby. Doesn't know about teams; just tracks co-occurrence. Useful for
// answering "who do I keep running into" and "do I tend to win or lose when
// X is around."
export class RivalryLog {
  private store: RivalryStore;

  constructor(private ctx: PluginContext) {
    this.store = ctx.storage.get<RivalryStore>(STORAGE_KEY) ?? {};
  }

  // Update entries for everyone in the roster. Self is filtered out by the
  // caller; nicked players are skipped here since their name isn't stable.
  recordGame(payload: GameEndPayload, rows: RowModel[]): void {
    const self = this.ctx.client.username.toLowerCase();
    const now = Date.now();
    const win = payload.result === 'victory';
    const loss = payload.result === 'defeat';

    for (const r of rows) {
      if (r.nicked) continue;
      if (r.username.toLowerCase() === self) continue;

      const key = r.username.toLowerCase();
      const entry = this.store[key] ?? freshEntry();
      entry.gamesShared++;
      if (win) entry.wins++;
      else if (loss) entry.losses++;
      entry.lastSeen = now;
      this.store[key] = entry;
    }

    this.persist();
  }

  // Print the top N rivals by games shared, or look up one player.
  show(arg: string | undefined): void {
    const ctx = this.ctx;
    const trimmed = (arg ?? '').trim();

    if (trimmed === 'clear' || trimmed === 'reset') {
      this.store = {};
      this.persist();
      ctx.client.sendChat(`${PREFIX} §aRivalry log cleared.`);
      return;
    }

    const entries = Object.entries(this.store);
    if (entries.length === 0) {
      ctx.client.sendChat(`${PREFIX} §cNo rivalry data yet. Play a game with the auto-roster on.`);
      return;
    }

    if (trimmed && trimmed !== 'top' && trimmed !== 'all') {
      this.printOne(trimmed);
      return;
    }

    const limit = trimmed === 'all' ? entries.length : DEFAULT_LIST_LIMIT;
    const sorted = entries
      .map(([name, entry]) => ({ name, ...entry }))
      .sort((a, b) => b.gamesShared - a.gamesShared)
      .slice(0, limit);

    ctx.client.sendChat(`\n${DIVIDER}`);
    ctx.client.sendChat(`${PREFIX} §6Bedwars Rivalry §8(§7top ${sorted.length} of ${entries.length}§8)`);
    ctx.client.sendChat(DIVIDER);
    for (const r of sorted) {
      const wlr = safeRatio(r.wins, r.losses);
      ctx.client.sendChat(
        `${BULLET} §e${r.name} §8» §fshared: §b${r.gamesShared}§f, §fW: §a${r.wins}§f, §fL: §c${r.losses}§f, §fWLR: ${getWlrColor(wlr)}`,
      );
    }
    ctx.client.sendChat(DIVIDER);
  }

  private printOne(username: string): void {
    const ctx = this.ctx;
    const key = username.toLowerCase();
    const entry = this.store[key];
    if (!entry) {
      ctx.client.sendChat(`${PREFIX} §cNo rivalry data for §e${username}§c.`);
      return;
    }
    const wlr = safeRatio(entry.wins, entry.losses);
    const days = (Date.now() - entry.lastSeen) / 86_400_000;
    const lastSeen = days < 1 ? 'today' : `${Math.floor(days)}d ago`;

    ctx.client.sendChat(`\n${DIVIDER}`);
    ctx.client.sendChat(`${PREFIX} §6Rivalry §8» §e${username}`);
    ctx.client.sendChat(
      `${BULLET} §fShared: §b${entry.gamesShared}§f, §fW: §a${entry.wins}§f, §fL: §c${entry.losses}§f, §fWLR: ${getWlrColor(wlr)}`,
    );
    ctx.client.sendChat(`${BULLET} §fLast seen: §7${lastSeen}`);
    ctx.client.sendChat(DIVIDER);
  }

  private persist(): void {
    this.ctx.storage.set(STORAGE_KEY, this.store);
  }
}
