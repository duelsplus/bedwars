// Bed Wars phase detection off the sidebar scoreboard.
// Ported from openutils GameModeUtil.java (THANK YOU DES). That version read
// the Minecraft scoreboard directly; we read a SidebarSnapshot handed to
// us by the proxy's SidebarReadHandler. Java's sb[0] is our title and
// sb[i+1] is our lines[i].

import type { SidebarSnapshot } from '@duelsplus/plugin-api';

// Bed Wars phase read off the sidebar.
export const enum BedWarsStatus {
  NotInBedWars = 0,
  Lobby = 1,
  Pregame = 2,
  InGame = 3,
}

// Strip § color codes.
function stripColorCodes(s: string): string {
  return s.replace(/§./g, '');
}

// True if any line or the title mentions hypixel.net. Not used by the
// status check (the BED WARS title is enough) but kept for plugins that
// want a guard.
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

// Phase derived from the sidebar. Layout matches Hypixel's default Bed
// Wars sidebar. Anything we don't recognize falls through to
// NotInBedWars so we don't false-positive.
// THANK YOU DES (x2)
export function getBedWarsStatus(snapshot: SidebarSnapshot | null): BedWarsStatus {
  if (!snapshot) return BedWarsStatus.NotInBedWars;

  const title = snapshot.title;
  const lines = snapshot.lines;

  // lines[5] is the deepest row we look at.
  if (lines.length < 6) return BedWarsStatus.NotInBedWars;

  if (!title.includes('BED') || !title.includes('WARS')) {
    return BedWarsStatus.NotInBedWars;
  }

  // Lobby row.
  if (lines[0]?.includes('§8L')) {
    return BedWarsStatus.Lobby;
  }

  // Pregame player counter.
  if (lines[3]?.includes('/') && lines[3]?.includes('§a')) {
    return BedWarsStatus.Pregame;
  }

  // Red and Blue team rows.
  if (lines[4]?.includes('§cR') && lines[5]?.includes('§9B')) {
    return BedWarsStatus.InGame;
  }

  return BedWarsStatus.NotInBedWars;
}
