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

// Item builders

// Icon toggle with an enchant glow when on. Use when the item itself
// communicates the meaning (golden sword for Final Kill Alerts, bed for Bed Alerts).
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

// Category icon for the main menu; the `status` line summarises the sub-menu.
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

// Status summaries rendered on category items

function rosterStatus(s: Settings): string {
  const parts: string[] = [];
  parts.push(s.autoRoster ? '§aAuto-roster' : '§cAuto-roster');
  if (s.stickyTabDecorations) parts.push('§aSticky');
  return parts.join('§7, ');
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
  if (s.postGameRecap) on.push('§aRecap');
  if (s.deathRecap) on.push('§aDeath');
  if (s.generatorTimers) on.push('§aGen');
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

const LUNAR_NOTE = '§8Lunar Client only';

function glowStatus(s: Settings): string {
  if (!s.glowEnabled) return '§cDisabled';
  const on: string[] = [];
  if (s.glowThreats) on.push('§cThreats');
  if (s.glowLowStat) on.push('§7Low');
  return on.length ? on.join('§7, ') : '§7No tiers';
}

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

// Main settings menu

export function openSettingsGUI(
  ctx: PluginContext,
  settings: Settings,
  session: Session,
): void {
  const gui = createGUI(ctx);
  if (!gui) return;
  gui.fillBlack();

  const updateAll = (): void => {
    gui.updateSlot(
      10,
      makeCategory(ctx, 355, '§eRoster', rosterStatus(settings)),
      () => {
        gui.close();
        openRosterGUI(ctx, settings, session);
      },
    );

    gui.updateSlot(
      11,
      makeCategory(ctx, 283, '§6Threats', threatStatus(settings)),
      () => {
        gui.close();
        openThreatsGUI(ctx, settings, session);
      },
    );

    gui.updateSlot(
      12,
      makeCategory(ctx, 25, '§eAlerts', alertsStatus(settings)),
      () => {
        gui.close();
        openAlertsGUI(ctx, settings, session);
      },
    );

    gui.updateSlot(
      13,
      makeCategory(ctx, 370, '§bGlow', glowStatus(settings)),
      () => {
        gui.close();
        openGlowGUI(ctx, settings, session);
      },
    );

    gui.updateSlot(
      14,
      makeCategory(ctx, MATERIAL_PAPER, '§fStat Tags', statTagStatus(ctx)),
      () => {
        gui.close();
        openStatTagsGUI(ctx, settings, session);
      },
    );

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

// Roster sub-menu

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
      11,
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

    gui.updateSlot(
      15,
      makeSimpleToggle(
        ctx,
        settings.stickyTabDecorations,
        421,
        'Sticky Decorations',
        'Keep tab-list stat badges pinned across game ends until the next roster prints',
      ),
      () => {
        settings.set('stickyTabDecorations', !settings.stickyTabDecorations);
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

// Threats sub-menu

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

// Alerts sub-menu

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
      14,
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

    gui.updateSlot(
      15,
      makeSimpleToggle(
        ctx,
        settings.postGameRecap,
        340,
        'Post-Game Recap',
        'Print this game\'s FK/FD/beds and session totals after every game',
      ),
      () => {
        settings.set('postGameRecap', !settings.postGameRecap);
        updateAll();
      },
    );

    gui.updateSlot(
      16,
      makeSimpleToggle(
        ctx,
        settings.deathRecap,
        397,
        'Death Recap',
        'When you die, chat the killer\'s stars + FKDR pulled from the roster cache',
      ),
      () => {
        settings.set('deathRecap', !settings.deathRecap);
        updateAll();
      },
    );

    gui.updateSlot(
      17,
      makeSimpleToggle(
        ctx,
        settings.generatorTimers,
        264,
        'Gen Timers',
        'Action-bar countdown when a diamond/emerald gen is about to tier up',
      ),
      () => {
        settings.set('generatorTimers', !settings.generatorTimers);
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

// Stat Tags sub-menu

// Backed by `ctx.settings` (proxy-side) so the tag renderer and this GUI stay
// in sync; not Bedwars-only state so it doesn't live on `settings`.
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

// Advanced sub-menu

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

// Glow sub-menu

function openGlowGUI(
  ctx: PluginContext,
  settings: Settings,
  session: Session,
): void {
  const gui = createGUI(ctx, '§bGlow');
  if (!gui) return;
  gui.fillBlack();

  const updateAll = (): void => {
    gui.updateSlot(
      11,
      makeSimpleToggle(
        ctx,
        settings.glowEnabled,
        370,
        'Enable Glow',
        'Master switch for Lunar Client outline colours on opponents',
        LUNAR_NOTE,
      ),
      () => {
        settings.set('glowEnabled', !settings.glowEnabled);
        updateAll();
      },
    );

    gui.updateSlot(
      13,
      makeSimpleToggle(
        ctx,
        settings.glowThreats,
        351,
        '§cThreat Glow',
        'Outline high-stat opponents in red (FKDR / stars threshold)',
        LUNAR_NOTE,
        1, // dye damage = red
      ),
      () => {
        settings.set('glowThreats', !settings.glowThreats);
        updateAll();
      },
    );

    gui.updateSlot(
      15,
      makeSimpleToggle(
        ctx,
        settings.glowLowStat,
        351,
        '§7Low-Stat Glow',
        'Outline sub-1 FKDR opponents in grey so you can tell them apart at a glance',
        LUNAR_NOTE,
        8, // dye damage = grey
      ),
      () => {
        settings.set('glowLowStat', !settings.glowLowStat);
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
