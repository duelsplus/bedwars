import type { PluginContext, GameEndPayload } from '@duelsplus/plugin-api';
import type { GameTracker, MapStatsEntry, MapStatsStore } from './types';
import { PREFIX, BULLET, DIVIDER } from './constants';
import { safeRatio } from '../util/format';
import {
  getFinalKillsColor,
  getFkdrColor,
  getLossesColor,
  getWinsColorBedwars,
  getWlrColor,
} from '../util/statColors';

const STORAGE_KEY = 'mapStats';
const DEFAULT_LIST_LIMIT = 10;

function freshEntry(): MapStatsEntry {
  return {
    wins: 0,
    losses: 0,
    finalKills: 0,
    finalDeaths: 0,
    bedsBroken: 0,
    bedsLost: 0,
    gamesPlayed: 0,
    lastPlayed: 0,
  };
}

// Cumulative per-map performance, persisted forever (unlike Session, which
// has a 6-hour TTL). Useful for "I always win on Glade", "I have a terrible
// FKDR on Eastwood" — actionable signals for map-veto and pick-prep.
export class MapStats {
  private store: MapStatsStore;

  constructor(private ctx: PluginContext) {
    this.store = ctx.storage.get<MapStatsStore>(STORAGE_KEY) ?? {};
  }

  recordGame(payload: GameEndPayload, game: GameTracker | null): void {
    const map = payload.map ?? this.ctx.gameState.currentMap;
    if (!map) return;

    const entry = this.store[map] ?? freshEntry();
    entry.gamesPlayed++;
    entry.lastPlayed = Date.now();

    if (payload.result === 'victory') entry.wins++;
    else if (payload.result === 'defeat') entry.losses++;

    if (game) {
      entry.finalKills += game.finalKills;
      entry.finalDeaths += game.finalDeaths;
      entry.bedsBroken += game.bedsBroken;
      entry.bedsLost += game.bedsLost;
    }

    this.store[map] = entry;
    this.persist();
  }

  show(arg: string | undefined): void {
    const ctx = this.ctx;
    const trimmed = (arg ?? '').trim();

    if (trimmed === 'clear' || trimmed === 'reset') {
      this.store = {};
      this.persist();
      ctx.client.sendChat(`${PREFIX} §aMap stats cleared.`);
      return;
    }

    const entries = Object.entries(this.store);
    if (entries.length === 0) {
      ctx.client.sendChat(`${PREFIX} §cNo map stats yet.`);
      return;
    }

    if (trimmed === 'current') {
      const current = ctx.gameState.currentMap;
      if (!current) {
        ctx.client.sendChat(`${PREFIX} §cNot currently on a map.`);
        return;
      }
      this.printOne(current);
      return;
    }

    if (trimmed && trimmed !== 'top' && trimmed !== 'all') {
      const match = this.findMapByName(trimmed);
      if (!match) {
        ctx.client.sendChat(`${PREFIX} §cNo stats for map §e${trimmed}§c.`);
        return;
      }
      this.printOne(match);
      return;
    }

    const limit = trimmed === 'all' ? entries.length : DEFAULT_LIST_LIMIT;
    const sorted = entries
      .map(([name, entry]) => ({ name, ...entry }))
      .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
      .slice(0, limit);

    ctx.client.sendChat(`\n${DIVIDER}`);
    ctx.client.sendChat(`${PREFIX} §6Bedwars Map Stats §8(§7top ${sorted.length} of ${entries.length}§8)`);
    ctx.client.sendChat(DIVIDER);
    for (const r of sorted) {
      const wlr = safeRatio(r.wins, r.losses);
      const fkdr = safeRatio(r.finalKills, r.finalDeaths);
      ctx.client.sendChat(
        `${BULLET} §e${r.name} §8» §fG: §b${r.gamesPlayed}§f, §fW/L: ${getWlrColor(wlr)}§f, §fFKDR: ${getFkdrColor(fkdr)}`,
      );
    }
    ctx.client.sendChat(DIVIDER);
  }

  // Case-insensitive prefix match so users can type partial names ("east"
  // matches "Eastwood"). Returns the first match by playcount.
  private findMapByName(name: string): string | null {
    const lower = name.toLowerCase();
    const exact = Object.keys(this.store).find((k) => k.toLowerCase() === lower);
    if (exact) return exact;
    const candidates = Object.entries(this.store)
      .filter(([k]) => k.toLowerCase().startsWith(lower))
      .sort((a, b) => b[1].gamesPlayed - a[1].gamesPlayed);
    return candidates[0]?.[0] ?? null;
  }

  private printOne(mapName: string): void {
    const ctx = this.ctx;
    const entry = this.store[mapName];
    if (!entry || entry.gamesPlayed === 0) {
      ctx.client.sendChat(`${PREFIX} §cNo stats for map §e${mapName}§c yet.`);
      return;
    }
    const wlr = safeRatio(entry.wins, entry.losses);
    const fkdr = safeRatio(entry.finalKills, entry.finalDeaths);
    const days = (Date.now() - entry.lastPlayed) / 86_400_000;
    const lastPlayed = days < 1 ? 'today' : `${Math.floor(days)}d ago`;

    ctx.client.sendChat(`\n${DIVIDER}`);
    ctx.client.sendChat(`${PREFIX} §6Map Stats §8» §e${mapName}`);
    ctx.client.sendChat(DIVIDER);
    ctx.client.sendChat(
      `${BULLET} §fGames: §e${entry.gamesPlayed}§f, §fW: ${getWinsColorBedwars(entry.wins)}§f, §fL: ${getLossesColor(entry.losses)}§f, §fWLR: ${getWlrColor(wlr)}`,
    );
    ctx.client.sendChat(
      `${BULLET} §fFK: ${getFinalKillsColor(entry.finalKills)}§f, §fFD: ${getLossesColor(entry.finalDeaths)}§f, §fFKDR: ${getFkdrColor(fkdr)}`,
    );
    ctx.client.sendChat(
      `${BULLET} §fBeds: §a${entry.bedsBroken}§f, §fLost: §c${entry.bedsLost}`,
    );
    ctx.client.sendChat(`${BULLET} §fLast played: §7${lastPlayed}`);
    ctx.client.sendChat(DIVIDER);
  }

  private persist(): void {
    this.ctx.storage.set(STORAGE_KEY, this.store);
  }
}
