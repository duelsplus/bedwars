// Helpers for deciding whether a given (gametype, mode) pair is the main
// Hypixel Bedwars experience (queues / in-game), and for normalizing
// locraw mode strings into the lowercase keys used by the stat API.

import { BW_DUELS_MODES } from './constants';

export function isBedwarsDuelsMode(mode: string | null): boolean {
  return mode !== null && BW_DUELS_MODES.has(mode);
}

export function isHypixelMainBedwars(
  gametype: string | null | undefined,
  mode: string | null,
): boolean {
  return (
    gametype === 'BEDWARS' &&
    mode !== null &&
    mode.startsWith('BEDWARS_') &&
    !isBedwarsDuelsMode(mode)
  );
}

export function locrawModeToBedwarsApiKey(mode: string): string {
  return mode.trim().toLowerCase();
}

// The "BED WARS" title banner shown in chat at game start. Strip color
// codes and normalize spacing so we don't miss it on slightly different
// formatting variants.
export function isBedWarsTitleBanner(flat: string): boolean {
  const s = flat
    .replace(/§[0-9a-fk-or]/gi, '')
    .replace(/\u00a7[0-9a-fk-or]/gi, '')
    .trim();
  return /^Bed Wars$/i.test(s);
}
