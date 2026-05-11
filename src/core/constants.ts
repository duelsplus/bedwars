export const PREFIX = '§8[§cDuels§4+§8] §8»';
export const BULLET = ' §4§l¤';
export const SELF_BULLET = ' §3§l¤';
export const DIVIDER = '§8' + '═'.repeat(35);

export const MATERIAL_STAINED_GLASS = 160;
export const MATERIAL_PAPER = 339;
export const MATERIAL_BARRIER = 166;
export const MATERIAL_BOOK = 340;
export const MATERIAL_GOLD_INGOT = 266;

// Bedwars duels modes share gametype=BEDWARS but aren't main queues.
export const BW_DUELS_MODES = new Set<string>([
  'BEDWARS_TWO_ONE_DUELS',
  'BEDWARS_TWO_ONE_DUELS_RUSH',
]);
