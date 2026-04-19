/**
 * Sidebar-scoreboard-based game state detection for Hypixel Bed Wars.
 *
 * Ported from an external Forge-client util (afterlike/openutils
 * `GameModeUtil.java`). Original Java read the Minecraft scoreboard directly
 * via `WorldUtil.getScoreboard()`. Here we receive a snapshot
 * (`SidebarSnapshot`) read from the proxy's `SidebarReadHandler`, which
 * gives us the same data: the sidebar title plus the visible lines in
 * top-to-bottom display order.
 *
 * The friend's original sidebar indices treated `sb[0]` as the title and
 * `sb[1..]` as sidebar entries. We adapt those to our `{ title, lines }`
 * shape: `sb[0]` → `title`, `sb[i+1]` → `lines[i]`.
 */

import type { SidebarSnapshot } from '@duelsplus/plugin-api';

/** Current Bed Wars status derived from the sidebar scoreboard. */
export const enum BedWarsStatus {
  /** Not on Bed Wars at all. */
  NotInBedWars = 0,
  /** Sitting in the Bed Wars lobby (pre-queue). */
  Lobby = 1,
  /** In a game server but still in the pregame countdown / waiting room. */
  Pregame = 2,
  /** Actively in a Bed Wars match. */
  InGame = 3,
}

/** Strip Minecraft color codes (§ followed by any char). */
function stripColorCodes(s: string): string {
  return s.replace(/§./g, '');
}

/**
 * Returns true if the current sidebar looks like a Hypixel sidebar
 * (any line contains "hypixel.net"). The Bed Wars status helper does not
 * require this, since the "BED WARS" title is already a strong signal, but
 * plugins can use it as a guard when needed.
 */
export function onHypixel(snapshot: SidebarSnapshot | null): boolean {
  if (!snapshot) return false;
  if (stripColorCodes(snapshot.title).toLowerCase().includes('hypixel.net')) {
    return true;
  }
  for (const line of snapshot.lines) {
    if (stripColorCodes(line).toLowerCase().includes('hypixel.net')) {
      return true;
    }
  }
  return false;
}

/**
 * Returns the current Bed Wars status derived from a sidebar snapshot.
 *
 * Line layout assumptions (matching the original Java helper, where `sb[0]`
 * was the title and `sb[1..]` were the visible sidebar rows):
 *
 * - `title` contains both "BED" and "WARS" → we're somewhere in Bed Wars.
 * - `lines[0]` contains "§8L"  → Bed Wars main lobby.
 * - `lines[3]` contains "/" and "§a" → pregame (e.g. "§a5§f/§a8" player count).
 * - `lines[4]` contains "§cR" AND `lines[5]` contains "§9B" → in-game
 *   (the Red and Blue team status rows).
 *
 * This matches Hypixel's default Bed Wars sidebar layout at time of
 * writing and is intentionally conservative — unknown layouts return
 * `NotInBedWars` rather than false-positives.
 */
export function getBedWarsStatus(snapshot: SidebarSnapshot | null): BedWarsStatus {
  if (!snapshot) return BedWarsStatus.NotInBedWars;

  const title = snapshot.title;
  const lines = snapshot.lines;

  // Need title + at least 6 sidebar rows for the in-game check (lines[5]).
  if (lines.length < 6) return BedWarsStatus.NotInBedWars;

  if (!title.includes('BED') || !title.includes('WARS')) {
    return BedWarsStatus.NotInBedWars;
  }

  // sb.get(1) in Java → lines[0] here: lobby row starts with "§8L…".
  if (lines[0]?.includes('§8L')) {
    return BedWarsStatus.Lobby;
  }

  // sb.get(4) in Java → lines[3]: pregame shows "§a5§f/§a8" style counter.
  if (lines[3]?.includes('/') && lines[3]?.includes('§a')) {
    return BedWarsStatus.Pregame;
  }

  // sb.get(5)/sb.get(6) in Java → lines[4]/lines[5]: Red / Blue team rows.
  if (lines[4]?.includes('§cR') && lines[5]?.includes('§9B')) {
    return BedWarsStatus.InGame;
  }

  return BedWarsStatus.NotInBedWars;
}
