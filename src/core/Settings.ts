import type { PluginContext } from '@duelsplus/plugin-api';

// Holds all user-tunable plugin toggles and thresholds. Loads defaults
// from storage on construction and writes back through `set()` so the
// GUI and command handlers don't need to know the storage keys.
//
// Settings fields are intentionally public so call-sites can read them
// directly (e.g. `settings.autoRoster`). Use `set()` for writes so the
// value is persisted.
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

  // Update a field and persist it. The string-typed signature mirrors
  // the original inline-GUI pattern where we drive updates via a key
  // name; callers pass one of the field names above.
  set(key: string, value: unknown): void {
    (this as unknown as Record<string, unknown>)[key] = value;
    this.ctx.storage.set(key, value);
  }
}
