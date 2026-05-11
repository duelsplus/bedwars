import type { PluginContext, PluginChestGUI } from '@duelsplus/plugin-api';
import type { Settings } from '../core/Settings';
import type { RowModel } from '../core/types';
import {
  PREFIX,
  MATERIAL_STAINED_GLASS,
  MATERIAL_BARRIER,
} from '../core/constants';
import {
  formatBedwarsLevel,
  getWinsColorBedwars,
  getLossesColor,
  getWlrColor,
  getFinalKillsColor,
  getFkdrColor,
} from '../util/statColors';

// Chest GUI mirroring the chat roster. FKDR tier picks the stained-glass colour.
export function openRosterGUI(
  ctx: PluginContext,
  settings: Settings,
  rows: RowModel[],
): void {
  const self = ctx.client.username.toLowerCase();
  // 2 rows minimum, 6 max; one row per 9 players plus a spacer.
  const guiRows = Math.min(6, Math.max(2, Math.ceil(rows.length / 9) + 1)) as
    | 1
    | 2
    | 3
    | 4
    | 5
    | 6;

  let gui: PluginChestGUI;
  try {
    gui = ctx.gui.createChestGUI(
      `§cDuels§4+ §8» §fBedwars Roster §7(${rows.length})`,
      guiRows,
    );
  } catch {
    ctx.client.sendChat(`${PREFIX} §cCould not open GUI.`);
    return;
  }

  gui.fillBlack();

  for (let i = 0; i < rows.length && i < guiRows * 9; i++) {
    const r = rows[i];
    const isSelf = r.username.toLowerCase() === self;

    if (r.nicked) {
      const item = ctx.gui.createItem(
        MATERIAL_BARRIER,
        0,
        `§c${r.username} §7(Nicked)`,
        ['§8No stats available'],
      );
      gui.setItem(i, item);
      continue;
    }

    // Self is cyan; others escalate green -> purple by FKDR tier.
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
    if (
      !isSelf &&
      (r.fkdr >= settings.threatFkdrThreshold ||
        r.stars >= settings.threatStarsThreshold)
    ) {
      lore.push('', '§c§l⚠ §r§cThreat');
    }

    const item = ctx.gui.createItem(
      MATERIAL_STAINED_GLASS,
      paneColor,
      `${isSelf ? '§b' : '§e'}${r.username}`,
      lore,
    );
    gui.setItem(i, item);
  }

  gui.open();
}
