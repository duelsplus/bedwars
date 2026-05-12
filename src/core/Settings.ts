import type { PluginContext } from '@duelsplus/plugin-api';

// Storage-backed plugin toggles. Fields are public so call-sites can read
// directly; writes must go through `set()` to persist.
export class Settings {
  debugChat: boolean;
  autoRoster: boolean;
  threatAlerts: boolean;
  threatFkdrThreshold: number;
  threatStarsThreshold: number;
  finalKillAlerts: boolean;
  bedBreakAlerts: boolean;
  streakAlerts: boolean;
  postGameRecap: boolean;
  deathRecap: boolean;
  stickyTabDecorations: boolean;
  generatorTimers: boolean;
  glowEnabled: boolean;
  glowThreats: boolean;
  glowLowStat: boolean;

  constructor(private ctx: PluginContext) {
    this.debugChat = ctx.storage.get<boolean>('debugChat') ?? false;
    this.autoRoster = ctx.storage.get<boolean>('autoRoster') ?? true;
    this.threatAlerts = ctx.storage.get<boolean>('threatAlerts') ?? true;
    this.threatFkdrThreshold = ctx.storage.get<number>('threatFkdrThreshold') ?? 5;
    this.threatStarsThreshold = ctx.storage.get<number>('threatStarsThreshold') ?? 500;
    this.finalKillAlerts = ctx.storage.get<boolean>('finalKillAlerts') ?? true;
    this.bedBreakAlerts = ctx.storage.get<boolean>('bedBreakAlerts') ?? true;
    this.streakAlerts = ctx.storage.get<boolean>('streakAlerts') ?? true;
    this.postGameRecap = ctx.storage.get<boolean>('postGameRecap') ?? true;
    this.deathRecap = ctx.storage.get<boolean>('deathRecap') ?? true;
    this.stickyTabDecorations = ctx.storage.get<boolean>('stickyTabDecorations') ?? false;
    this.generatorTimers = ctx.storage.get<boolean>('generatorTimers') ?? true;
    // Glow is Lunar-only and off by default; the user opts in once they
    // know their client supports it.
    this.glowEnabled = ctx.storage.get<boolean>('glowEnabled') ?? false;
    this.glowThreats = ctx.storage.get<boolean>('glowThreats') ?? true;
    this.glowLowStat = ctx.storage.get<boolean>('glowLowStat') ?? false;
  }

  set(key: string, value: unknown): void {
    (this as unknown as Record<string, unknown>)[key] = value;
    this.ctx.storage.set(key, value);
  }
}
