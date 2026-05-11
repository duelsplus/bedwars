import type { PluginContext, PluginChestGUI, GUIItemData, GUIRows } from '@duelsplus/plugin-api';
import type { Settings } from '../core/Settings';
import type { Session } from '../core/Session';
import {
  PREFIX,
  MATERIAL_PAPER,
  MATERIAL_BARRIER,
  MATERIAL_BOOK,
  MATERIAL_GOLD_INGOT,
} from '../core/constants';

// ============================================================
// Item builders
// ============================================================

// Green dye / bone toggle. Visually mirrors the murder-mystery
// settings GUI so the two plugins feel consistent.
function makeToggle(
  ctx: PluginContext,
  isOn: boolean,
  name: string,
  desc: string,
  footnote?: string,
): GUIItemData {
  const lore: string[] = [
    isOn ? '§7Status: §aEnabled' : '§7Status: §cDisabled',
    '',
    `§7${desc}`,
  ];
  if (footnote) lore.push('', footnote);
  lore.push('', '§eClick to toggle');
  return ctx.gui.createItem(
    isOn ? 351 : 352,
    isOn ? 10 : 0,
    `${isOn ? '§a' : '§c'}${name}`,
    lore,
  );
}

// Item-specific toggle that adds an enchant glow when on. Use when the
// item itself communicates the meaning (e.g. golden sword for Final
// Kill Alerts, bed for Bed Alerts).
function makeSimpleToggle(
  ctx: PluginContext,
  isOn: boolean,
  itemId: number,
  name: string,
  desc: string,
  footnote?: string,
  damage: number = 0,
): GUIItemData {
  const lore: string[] = [
    isOn ? '§7Status: §aEnabled' : '§7Status: §cDisabled',
    '',
    `§7${desc}`,
  ];
  if (footnote) lore.push('', footnote);
  lore.push('', '§eClick to toggle');
  const item = ctx.gui.createItem(itemId, damage, `${isOn ? '§a' : '§c'}${name}`, lore);
  if (isOn) {
    const val = (item.nbtData as Record<string, unknown>)?.value as Record<string, unknown>;
    if (val) {
      val.ench = { type: 'list', value: { type: 'compound', value: [] } };
    }
  }
  return item;
}

// Category icon shown on the main menu. The status line beneath the
// title summarises the sub-menu's current state so users can see at a
// glance which features are on without drilling in.
function makeCategory(
  ctx: PluginContext,
  itemId: number,
  name: string,
  status: string,
  damage: number = 0,
): GUIItemData {
  return ctx.gui.createItem(itemId, damage, name, [
    status,
    '',
    '§eClick to open',
  ]);
}

function makeCycle(
  ctx: PluginContext,
  value: string,
  name: string,
  desc: string,
  options: readonly string[],
): GUIItemData {
  const lore: string[] = [`§7${desc}`, ''];
  for (const opt of options) {
    lore.push(opt === value ? `§a▸ ${opt}` : `§7  ${opt}`);
  }
  lore.push('', '§eClick to cycle');
  return ctx.gui.createItem(MATERIAL_PAPER, 0, `§e${name}: §f${value}`, lore);
}

function makeThreshold(
  ctx: PluginContext,
  value: number,
  name: string,
  desc: string,
  step: number,
  min: number,
  max: number,
): GUIItemData {
  return ctx.gui.createItem(
    MATERIAL_GOLD_INGOT,
    0,
    `§e${name}: §f${value}`,
    [
      `§7${desc}`,
      '',
      `§7Current: §e${value} §8(§7${min}–${max}§8)`,
      '',
      `§eLeft-click: §a+${step}`,
      `§eRight-click: §c-${step}`,
    ],
  );
}

function makeBack(ctx: PluginContext): GUIItemData {
  return ctx.gui.createItem(262, 0, '§cBack', ['§7Return to previous menu']);
}

function makeClose(ctx: PluginContext): GUIItemData {
  return ctx.gui.createItem(MATERIAL_BARRIER, 0, '§cClose', ['§7Close this menu']);
}

// ============================================================
// Status summaries (rendered on category items)
// ============================================================

function rosterStatus(s: Settings): string {
  return s.autoRoster ? '§aAuto-roster on' : '§cAuto-roster off';
}

function threatStatus(s: Settings): string {
  if (!s.threatAlerts) return '§cDisabled';
  return `§7≥ §e${s.threatFkdrThreshold} §7FKDR §8/ §e${s.threatStarsThreshold}§7★`;
}

function alertsStatus(s: Settings): string {
  const on: string[] = [];
  if (s.finalKillAlerts) on.push('§aFK');
  if (s.bedBreakAlerts) on.push('§aBeds');
  if (s.streakAlerts) on.push('§aStreaks');
  return on.length ? on.join('§7, ') : '§cAll off';
}

function statTagStatus(ctx: PluginContext): string {
  const prefix = (ctx.settings.get('statTagsPrefix') as string) || 'None';
  const suffix = (ctx.settings.get('statTagsSuffix') as string) || 'None';
  return `§7${prefix} §8» §fname §8» §7${suffix}`;
}

function advancedStatus(s: Settings): string {
  return s.debugChat ? '§eDebug chat: §aon' : '§7Debug chat: §8off';
}

// ============================================================
// Constants
// ============================================================

const BW_STAT_OPTIONS = ['None', 'Stars', 'Wins', 'Losses', 'WLR', 'FKDR', 'WS'] as const;
type BwStat = (typeof BW_STAT_OPTIONS)[number];

const cycleNext = <T>(current: T, options: readonly T[]): T => {
  const idx = options.indexOf(current);
  return options[(idx + 1) % options.length] as T;
};

function createGUI(
  ctx: PluginContext,
  subtitle?: string,
  rows: GUIRows = 3,
): PluginChestGUI | null {
  try {
    const title = subtitle
      ? `§cDuels§4+ §8» §fBedwars §8» ${subtitle}`
      : '§cDuels§4+ §8» §fBedwars';
    return ctx.gui.createChestGUI(title, rows);
  } catch {
    ctx.client.sendChat(`${PREFIX} §cCould not open settings GUI.`);
    return null;
  }
}

// ============================================================
// Main settings menu
// ============================================================

// Top-level category picker. Each slot opens a focused sub-menu so the
// flat layout doesn't get cramped as more toggles are added.
export function openSettingsGUI(
  ctx: PluginContext,
  settings: Settings,
  session: Session,
): void {
  const gui = createGUI(ctx);
  if (!gui) return;
  gui.fillBlack();

  const updateAll = (): void => {
    // Roster — bed icon (very Bedwars-y)
    gui.updateSlot(
      10,
      makeCategory(ctx, 355, '§eRoster', rosterStatus(settings)),
      () => {
        gui.close();
        openRosterGUI(ctx, settings, session);
      },
    );

    // Threats — golden sword
    gui.updateSlot(
      11,
      makeCategory(ctx, 283, '§6Threats', threatStatus(settings)),
      () => {
        gui.close();
        openThreatsGUI(ctx, settings, session);
      },
    );

    // Alerts — note block
    gui.updateSlot(
      12,
      makeCategory(ctx, 25, '§eAlerts', alertsStatus(settings)),
      () => {
        gui.close();
        openAlertsGUI(ctx, settings, session);
      },
    );

    // Stat Tags — paper
    gui.updateSlot(
      14,
      makeCategory(ctx, MATERIAL_PAPER, '§fStat Tags', statTagStatus(ctx)),
      () => {
        gui.close();
        openStatTagsGUI(ctx, settings, session);
      },
    );

    // Session — book (jumps straight to session.show())
    gui.updateSlot(
      15,
      ctx.gui.createItem(MATERIAL_BOOK, 0, '§bSession Stats', [
        "§7View this session's Bedwars stats",
        '',
        '§eClick to view',
      ]),
      () => {
        gui.close();
        session.show();
      },
    );

    // Advanced — redstone dust
    gui.updateSlot(
      16,
      makeCategory(ctx, 331, '§7Advanced', advancedStatus(settings)),
      () => {
        gui.close();
        openAdvancedGUI(ctx, settings, session);
      },
    );

    gui.updateSlot(22, makeClose(ctx), () => gui.close());
  };

  updateAll();
  gui.open();
}

// ============================================================
// Roster sub-menu
// ============================================================

function openRosterGUI(
  ctx: PluginContext,
  settings: Settings,
  session: Session,
): void {
  const gui = createGUI(ctx, '§eRoster');
  if (!gui) return;
  gui.fillBlack();

  const updateAll = (): void => {
    gui.updateSlot(
      13,
      makeSimpleToggle(
        ctx,
        settings.autoRoster,
        355,
        'Auto Roster',
        'Print the roster automatically when a Bedwars game starts',
      ),
      () => {
        settings.set('autoRoster', !settings.autoRoster);
        updateAll();
      },
    );

    gui.updateSlot(22, makeBack(ctx), () => {
      gui.close();
      openSettingsGUI(ctx, settings, session);
    });
  };

  updateAll();
  gui.open();
}

// ============================================================
// Threats sub-menu
// ============================================================

function openThreatsGUI(
  ctx: PluginContext,
  settings: Settings,
  session: Session,
): void {
  const gui = createGUI(ctx, '§6Threats');
  if (!gui) return;
  gui.fillBlack();

  const updateAll = (): void => {
    gui.updateSlot(
      11,
      makeSimpleToggle(
        ctx,
        settings.threatAlerts,
        283,
        'Threat Alerts',
        'Warn about high-stat opponents in chat after the roster prints',
      ),
      () => {
        settings.set('threatAlerts', !settings.threatAlerts);
        updateAll();
      },
    );

    gui.updateSlot(
      13,
      makeThreshold(
        ctx,
        settings.threatFkdrThreshold,
        'FKDR Threshold',
        'Min FKDR to flag as a threat',
        1,
        1,
        50,
      ),
      (_slot, button) => {
        let v = settings.threatFkdrThreshold;
        v = button === 'left' ? Math.min(v + 1, 50) : Math.max(v - 1, 1);
        settings.set('threatFkdrThreshold', v);
        updateAll();
      },
    );

    gui.updateSlot(
      15,
      makeThreshold(
        ctx,
        settings.threatStarsThreshold,
        'Stars Threshold',
        'Min Bedwars stars to flag as a threat',
        100,
        100,
        5000,
      ),
      (_slot, button) => {
        let v = settings.threatStarsThreshold;
        v = button === 'left' ? Math.min(v + 100, 5000) : Math.max(v - 100, 100);
        settings.set('threatStarsThreshold', v);
        updateAll();
      },
    );

    gui.updateSlot(22, makeBack(ctx), () => {
      gui.close();
      openSettingsGUI(ctx, settings, session);
    });
  };

  updateAll();
  gui.open();
}

// ============================================================
// Alerts sub-menu
// ============================================================

function openAlertsGUI(
  ctx: PluginContext,
  settings: Settings,
  session: Session,
): void {
  const gui = createGUI(ctx, '§eAlerts');
  if (!gui) return;
  gui.fillBlack();

  const updateAll = (): void => {
    gui.updateSlot(
      11,
      makeSimpleToggle(
        ctx,
        settings.finalKillAlerts,
        283,
        'Final Kill Alerts',
        'Sound + action bar on final kills and final deaths',
      ),
      () => {
        settings.set('finalKillAlerts', !settings.finalKillAlerts);
        updateAll();
      },
    );

    gui.updateSlot(
      13,
      makeSimpleToggle(
        ctx,
        settings.bedBreakAlerts,
        355,
        'Bed Alerts',
        'Sound + title when beds are destroyed',
      ),
      () => {
        settings.set('bedBreakAlerts', !settings.bedBreakAlerts);
        updateAll();
      },
    );

    gui.updateSlot(
      15,
      makeSimpleToggle(
        ctx,
        settings.streakAlerts,
        MATERIAL_GOLD_INGOT,
        'Streak Alerts',
        'Title + sound on winstreak milestones, chat on streak break',
      ),
      () => {
        settings.set('streakAlerts', !settings.streakAlerts);
        updateAll();
      },
    );

    gui.updateSlot(22, makeBack(ctx), () => {
      gui.close();
      openSettingsGUI(ctx, settings, session);
    });
  };

  updateAll();
  gui.open();
}

// ============================================================
// Stat Tags sub-menu
// ============================================================

// Stat-tag prefix/suffix live in `ctx.settings` (the proxy-side store)
// so the duels+ tag renderer and this GUI stay in sync. We don't
// persist them through `settings` because they're not Bedwars-only.
function openStatTagsGUI(
  ctx: PluginContext,
  settings: Settings,
  session: Session,
): void {
  const gui = createGUI(ctx, '§fStat Tags');
  if (!gui) return;
  gui.fillBlack();

  const updateAll = (): void => {
    const prefix = (ctx.settings.get('statTagsPrefix') as string) || 'None';
    gui.updateSlot(
      12,
      makeCycle(ctx, prefix, 'Tag Prefix', 'Stat shown before player names', BW_STAT_OPTIONS),
      () => {
        const cur = (ctx.settings.get('statTagsPrefix') as string) || 'None';
        ctx.settings.set('statTagsPrefix', cycleNext(cur as BwStat, BW_STAT_OPTIONS));
        updateAll();
      },
    );

    const suffix = (ctx.settings.get('statTagsSuffix') as string) || 'Wins';
    gui.updateSlot(
      14,
      makeCycle(ctx, suffix, 'Tag Suffix', 'Stat shown after player names', BW_STAT_OPTIONS),
      () => {
        const cur = (ctx.settings.get('statTagsSuffix') as string) || 'Wins';
        ctx.settings.set('statTagsSuffix', cycleNext(cur as BwStat, BW_STAT_OPTIONS));
        updateAll();
      },
    );

    gui.updateSlot(22, makeBack(ctx), () => {
      gui.close();
      openSettingsGUI(ctx, settings, session);
    });
  };

  updateAll();
  gui.open();
}

// ============================================================
// Advanced sub-menu
// ============================================================

function openAdvancedGUI(
  ctx: PluginContext,
  settings: Settings,
  session: Session,
): void {
  const gui = createGUI(ctx, '§7Advanced');
  if (!gui) return;
  gui.fillBlack();

  const updateAll = (): void => {
    gui.updateSlot(
      13,
      makeSimpleToggle(
        ctx,
        settings.debugChat,
        331,
        'Debug Chat',
        'Log Bedwars chat packets to the proxy console',
      ),
      () => {
        settings.set('debugChat', !settings.debugChat);
        updateAll();
      },
    );

    gui.updateSlot(22, makeBack(ctx), () => {
      gui.close();
      openSettingsGUI(ctx, settings, session);
    });
  };

  updateAll();
  gui.open();
}

// `makeToggle` is exported in spirit (used inside this module only); keep
// the symbol live so future refactors that want a non-icon toggle don't
// need to re-introduce the helper.
void makeToggle;
