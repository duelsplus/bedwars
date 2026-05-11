// Ported from openutils GameModeUtil.java (THANK YOU DES). Java's sb[0] is
// our title; sb[i+1] is our lines[i].

import type { SidebarSnapshot } from '@duelsplus/plugin-api';

export const enum BedWarsStatus {
  NotInBedWars = 0,
  Lobby = 1,
  Pregame = 2,
  InGame = 3,
}

function stripColorCodes(s: string): string {
  return s.replace(/§./g, '');
}

/** Unused by the status check (the BED WARS title is enough) but exposed for plugins that want a guard. */
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

// THANK YOU DES (x2)
// Unknown sidebar layouts fall through to NotInBedWars to avoid false-positives.
export function getBedWarsStatus(snapshot: SidebarSnapshot | null): BedWarsStatus {
  if (!snapshot) return BedWarsStatus.NotInBedWars;

  const title = snapshot.title;
  const lines = snapshot.lines;

  // lines[5] is the deepest row we read.
  if (lines.length < 6) return BedWarsStatus.NotInBedWars;

  if (!title.includes('BED') || !title.includes('WARS')) {
    return BedWarsStatus.NotInBedWars;
  }

  if (lines[0]?.includes('§8L')) {
    return BedWarsStatus.Lobby;
  }

  // Pregame player counter row.
  if (lines[3]?.includes('/') && lines[3]?.includes('§a')) {
    return BedWarsStatus.Pregame;
  }

  // Red and Blue team rows.
  if (lines[4]?.includes('§cR') && lines[5]?.includes('§9B')) {
    return BedWarsStatus.InGame;
  }

  return BedWarsStatus.NotInBedWars;
}
