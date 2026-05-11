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

  constructor(private ctx: PluginContext) {
    this.debugChat = ctx.storage.get<boolean>('debugChat') ?? false;
    this.autoRoster = ctx.storage.get<boolean>('autoRoster') ?? true;
    this.threatAlerts = ctx.storage.get<boolean>('threatAlerts') ?? true;
    this.threatFkdrThreshold = ctx.storage.get<number>('threatFkdrThreshold') ?? 5;
    this.threatStarsThreshold = ctx.storage.get<number>('threatStarsThreshold') ?? 500;
    this.finalKillAlerts = ctx.storage.get<boolean>('finalKillAlerts') ?? true;
    this.bedBreakAlerts = ctx.storage.get<boolean>('bedBreakAlerts') ?? true;
    this.streakAlerts = ctx.storage.get<boolean>('streakAlerts') ?? true;
  }

  set(key: string, value: unknown): void {
    (this as unknown as Record<string, unknown>)[key] = value;
    this.ctx.storage.set(key, value);
  }
}
