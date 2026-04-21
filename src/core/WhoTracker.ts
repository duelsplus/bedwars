import type { PluginContext } from '@duelsplus/plugin-api';
import { extractTextFromChatJson, stripFormatting, isValidUsername } from '../util/chatJson';

// Minimum gap between `/who` sends. /who is a server-side command and
// spamming it is both rate-limited and rude.
const WHO_THROTTLE_MS = 1500;

// Manages the `/who` side-channel: sending the command, parsing the
// `ONLINE:` response out of chat, and holding the captured name set.
// Also exposes a single scheduled retry slot used by RosterManager.
export class WhoTracker {
  private whoNames = new Set<string>();
  private lastWhoAt = 0;
  private retryTimeout: number | null = null;

  constructor(private ctx: PluginContext) {}

  getNames(): Set<string> {
    return this.whoNames;
  }

  clearNames(): void {
    this.whoNames.clear();
    this.lastWhoAt = 0;
  }

  sendWho(): void {
    const now = Date.now();
    if (now - this.lastWhoAt < WHO_THROTTLE_MS) return;
    this.lastWhoAt = now;
    this.ctx.client.sendGameChat('/who');
  }

  // Parse a raw chat packet body for the `ONLINE:` line emitted by /who
  // and add discovered usernames to the set. Non-matching lines are
  // ignored.
  captureResponse(raw: string): void {
    const text = extractTextFromChatJson(raw);
    if (!/^ONLINE:/i.test(text.trim())) return;

    const namesPart = text.replace(/^ONLINE:\s*/i, '');
    const parts = namesPart
      .split(',')
      .map((s) => stripFormatting(s).trim())
      .filter((s) => isValidUsername(s));

    for (const p of parts) this.whoNames.add(p);
  }

  // Single-slot retry timer for drivers (RosterManager's tick loop).
  // Scheduling replaces any pending retry.
  scheduleRetry(fn: () => void, delayMs: number): void {
    this.clearRetry();
    this.retryTimeout = this.ctx.scheduler.setTimeout(fn, delayMs);
  }

  clearRetry(): void {
    if (this.retryTimeout !== null) {
      this.ctx.scheduler.clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }
}
