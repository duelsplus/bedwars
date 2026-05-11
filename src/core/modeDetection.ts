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

// Tolerant match for the "Bed Wars" title banner posted in chat at game start.
export function isBedWarsTitleBanner(flat: string): boolean {
  const s = flat
    .replace(/§[0-9a-fk-or]/gi, '')
    .replace(/\u00a7[0-9a-fk-or]/gi, '')
    .trim();
  return /^Bed Wars$/i.test(s);
}
