import type { PluginContext, PluginLogger } from '@duelsplus/plugin-api';
import type { Settings } from './Settings';
import type { RowModel } from './types';

// 0xRRGGBB packed colours for ctx.glow.setGlowColor.
const COLOR_THREAT = 0xff3030;
const COLOR_LOW_STAT = 0x808080;

// Paints opponent outlines using the Lunar Apollo glow channel, color-coded
// by the same FKDR/stars tiers the chat threat alerts use. Lunar-only:
// silently does nothing when the player isn't on Lunar Client.
export class GlowManager {
  private decoratedUuids = new Set<string>();

  constructor(
    private ctx: PluginContext,
    private settings: Settings,
    private log: PluginLogger,
  ) {}

  /** Apply colours for every UUID-bearing row in the roster. */
  applyForRoster(rows: RowModel[]): void {
    if (!this.settings.glowEnabled) {
      this.clearAll();
      return;
    }
    if (!this.ctx.apollo.isUsingLunarClient) {
      // Not an error condition — the user's just on vanilla; bail quietly.
      return;
    }

    // Reset prior state so removed players don't keep glowing.
    this.clearAll();

    const self = this.ctx.client.username.toLowerCase();
    for (const r of rows) {
      if (r.nicked || !r.uuid) continue;
      if (r.username.toLowerCase() === self) continue;

      const isThreat =
        r.fkdr >= this.settings.threatFkdrThreshold ||
        r.stars >= this.settings.threatStarsThreshold;

      let color: number | null = null;
      if (isThreat && this.settings.glowThreats) {
        color = COLOR_THREAT;
      } else if (!isThreat && r.fkdr < 1 && this.settings.glowLowStat) {
        color = COLOR_LOW_STAT;
      }
      if (color === null) continue;

      try {
        this.ctx.glow.setGlowColor(r.uuid, color);
        this.decoratedUuids.add(r.uuid);
      } catch (e) {
        this.log.debug('setGlowColor threw', e);
      }
    }
  }

  /** Clear every glow override we applied. Safe to call without Lunar. */
  clearAll(): void {
    if (this.decoratedUuids.size === 0) return;
    try {
      this.ctx.glow.clearAll();
    } catch (e) {
      this.log.debug('glow clearAll threw', e);
    }
    this.decoratedUuids.clear();
  }
}
