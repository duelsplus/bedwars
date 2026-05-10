import type { PluginContext, PluginChestGUI } from '@duelsplus/plugin-api';
import type { Settings } from '../core/Settings';
import type { Session } from '../core/Session';
import {
  PREFIX,
  MATERIAL_PAPER,
  MATERIAL_BARRIER,
  MATERIAL_BOOK,
  MATERIAL_GOLD_INGOT,
} from '../core/constants';

// Built-in 5-row chest GUI for toggling plugin settings. All state is
// read from and written through the shared `Settings` instance. Stat-
// tag prefix/suffix options live in `ctx.settings` (core proxy store)
// so the duels tag renderer and this GUI stay in sync.
export function openSettingsGUI(
  ctx: PluginContext,
  settings: Settings,
  session: Session,
): void {
  let gui: PluginChestGUI;
  try {
    gui = ctx.gui.createChestGUI('§cDuels§4+ §8» §fBedwars Settings', 5);
  } catch {
    ctx.client.sendChat(`${PREFIX} §cCould not open settings GUI.`);
    return;
  }

  gui.fillBlack();

  const BW_STAT_OPTIONS = ['None', 'Stars', 'Wins', 'Losses', 'WLR', 'FKDR', 'WS'] as const;
  type BwStat = (typeof BW_STAT_OPTIONS)[number];

  const cycleNext = <T>(current: T, options: readonly T[]): T => {
    const idx = options.indexOf(current);
    return options[(idx + 1) % options.length];
  };

  const makeToggle = (
    isOn: boolean,
    name: string,
    desc: string,
  ): ReturnType<typeof ctx.gui.createItem> => {
    return ctx.gui.createItem(
      isOn ? 351 : 352,
      0,
      `${isOn ? '§a' : '§c'}${name}`,
      [
        isOn ? '§7Status: §aEnabled' : '§7Status: §cDisabled',
        '',
        `§7${desc}`,
        '',
        '§eClick to toggle',
      ],
    );
  };

  const makeCycle = (
    value: string,
    name: string,
    desc: string,
    options: readonly string[],
  ): ReturnType<typeof ctx.gui.createItem> => {
    const lore: string[] = [`§7${desc}`, ''];
    for (const opt of options) {
      lore.push(opt === value ? `§a▸ ${opt}` : `§7  ${opt}`);
    }
    lore.push('', '§eClick to cycle');
    return ctx.gui.createItem(MATERIAL_PAPER, 0, `§e${name}: §f${value}`, lore);
  };

  const makeThreshold = (
    value: number,
    name: string,
    desc: string,
    step: number,
    min: number,
    max: number,
  ): ReturnType<typeof ctx.gui.createItem> => {
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
  };

  const updateAll = (): void => {
    gui.updateSlot(10, makeToggle(settings.autoRoster, 'Auto Roster', 'Print roster on game start'), () => {
      settings.set('autoRoster', !settings.autoRoster);
      updateAll();
    });

    const prefix = (ctx.settings.get('statTagsPrefix') as string) || 'None';
    gui.updateSlot(11, makeCycle(prefix, 'Tag Prefix', 'Stat before player name', BW_STAT_OPTIONS), () => {
      const cur = (ctx.settings.get('statTagsPrefix') as string) || 'None';
      ctx.settings.set('statTagsPrefix', cycleNext(cur as BwStat, BW_STAT_OPTIONS));
      updateAll();
    });

    const suffix = (ctx.settings.get('statTagsSuffix') as string) || 'Wins';
    gui.updateSlot(12, makeCycle(suffix, 'Tag Suffix', 'Stat after player name', BW_STAT_OPTIONS), () => {
      const cur = (ctx.settings.get('statTagsSuffix') as string) || 'Wins';
      ctx.settings.set('statTagsSuffix', cycleNext(cur as BwStat, BW_STAT_OPTIONS));
      updateAll();
    });

    gui.updateSlot(19, makeToggle(settings.threatAlerts, 'Threat Alerts', 'Warn about high-stat players'), () => {
      settings.set('threatAlerts', !settings.threatAlerts);
      updateAll();
    });

    gui.updateSlot(20, makeThreshold(settings.threatFkdrThreshold, 'Threat FKDR', 'Min FKDR for threat alert', 1, 1, 50), (_, button) => {
      let v = settings.threatFkdrThreshold;
      v = button === 'left' ? Math.min(v + 1, 50) : Math.max(v - 1, 1);
      settings.set('threatFkdrThreshold', v);
      updateAll();
    });

    gui.updateSlot(21, makeThreshold(settings.threatStarsThreshold, 'Threat Stars', 'Min stars for threat alert', 100, 100, 5000), (_, button) => {
      let v = settings.threatStarsThreshold;
      v = button === 'left' ? Math.min(v + 100, 5000) : Math.max(v - 100, 100);
      settings.set('threatStarsThreshold', v);
      updateAll();
    });

    gui.updateSlot(28, makeToggle(settings.finalKillAlerts, 'FK Alerts', 'Sound + action bar on final kills'), () => {
      settings.set('finalKillAlerts', !settings.finalKillAlerts);
      updateAll();
    });

    gui.updateSlot(29, makeToggle(settings.bedBreakAlerts, 'Bed Alerts', 'Sound + title on bed breaks'), () => {
      settings.set('bedBreakAlerts', !settings.bedBreakAlerts);
      updateAll();
    });

    gui.updateSlot(30, makeToggle(settings.streakAlerts, 'Streak Alerts', 'Title on winstreak milestones'), () => {
      settings.set('streakAlerts', !settings.streakAlerts);
      updateAll();
    });

    gui.updateSlot(31, makeToggle(settings.debugChat, 'Debug Chat', 'Log BW chat to console'), () => {
      settings.set('debugChat', !settings.debugChat);
      updateAll();
    });

    gui.updateSlot(
      40,
      ctx.gui.createItem(MATERIAL_BOOK, 0, '§bSession Stats', ['§7View your BW session', '', '§eClick to view']),
      () => {
        gui.close();
        session.show();
      },
    );

    gui.updateSlot(
      44,
      ctx.gui.createItem(MATERIAL_BARRIER, 0, '§cClose', ['§7Close this menu']),
      () => gui.close(),
    );
  };

  updateAll();
  gui.open();
}
