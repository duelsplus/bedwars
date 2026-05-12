import type { PluginContext, PluginLogger, SidebarSnapshot } from '@duelsplus/plugin-api';
import type { Settings } from './Settings';

const POLL_MS = 1000;
// Push to the action bar only when a tier-up is imminent; otherwise the bar
// gets too noisy and stomps on FK/bed alerts.
const URGENT_THRESHOLD_S = 10;
// Lines like "Diamond I §a00:09" or "Diamond II in §a01:00" after colour-stripping.
const TIMER_LINE_RE = /\b(Diamond|Emerald)\b[^0-9]*(\d{1,2}):(\d{2})/i;

interface ActiveTimer {
  resource: 'Diamond' | 'Emerald';
  remainingSec: number;
  rawLine: string;
}

function stripColorCodes(s: string): string {
  return s.replace(/§./g, '');
}

// Reads diamond/emerald tier-up countdowns straight off the sidebar and
// projects them onto the action bar when they're about to fire, so the
// player can position near the gen without staring at the sidebar.
export class GeneratorTimers {
  private handle: number | null = null;
  // Track the last urgent-tier message we showed so we don't spam the bar
  // every tick with the same string.
  private lastShown: string | null = null;

  constructor(
    private ctx: PluginContext,
    private settings: Settings,
    private log: PluginLogger,
  ) {}

  start(): void {
    if (this.handle !== null) return;
    this.handle = this.ctx.scheduler.setInterval(() => this.tick(), POLL_MS);
  }

  stop(): void {
    if (this.handle !== null) {
      this.ctx.scheduler.clearInterval(this.handle);
      this.handle = null;
    }
    this.lastShown = null;
  }

  private tick(): void {
    if (!this.settings.generatorTimers) {
      this.lastShown = null;
      return;
    }

    const sb = this.ctx.scoreboard as { getSidebar?: () => SidebarSnapshot | null };
    if (typeof sb.getSidebar !== 'function') {
      // Same self-disable pattern GamePhaseDriver uses: older proxies don't
      // expose getSidebar(), kill the loop rather than throwing every second.
      this.stop();
      this.log.warn('ctx.scoreboard.getSidebar unavailable; generator timers disabled.');
      return;
    }
    const snapshot = sb.getSidebar();
    if (!snapshot) return;

    const timer = this.findNearestTimer(snapshot);
    if (!timer || timer.remainingSec > URGENT_THRESHOLD_S) {
      this.lastShown = null;
      return;
    }

    const color = timer.resource === 'Diamond' ? '§b' : '§a';
    const msg = `${color}§l${timer.resource}§r§7 tier-up in §f${timer.remainingSec}s`;
    if (msg === this.lastShown) return;
    this.lastShown = msg;
    this.ctx.client.sendActionBar(msg);
  }

  private findNearestTimer(snapshot: SidebarSnapshot): ActiveTimer | null {
    let best: ActiveTimer | null = null;
    for (const rawLine of snapshot.lines) {
      const line = stripColorCodes(rawLine);
      const match = TIMER_LINE_RE.exec(line);
      if (!match) continue;
      const resource = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase() as 'Diamond' | 'Emerald';
      const minutes = parseInt(match[2], 10);
      const seconds = parseInt(match[3], 10);
      const total = minutes * 60 + seconds;
      if (!Number.isFinite(total)) continue;
      if (!best || total < best.remainingSec) {
        best = { resource, remainingSec: total, rawLine };
      }
    }
    return best;
  }
}
