// Shared strings, Minecraft material IDs, and mode sets used across
// the Bedwars plugin.

export const PREFIX = '§8[§cDuels§4+§8] §8»';
export const BULLET = ' §4§l¤';
export const SELF_BULLET = ' §3§l¤';
export const DIVIDER = '§8' + '═'.repeat(35);

export const MATERIAL_STAINED_GLASS = 160;
export const MATERIAL_PAPER = 339;
export const MATERIAL_BARRIER = 166;
export const MATERIAL_BOOK = 340;
export const MATERIAL_GOLD_INGOT = 266;

// Bedwars duels modes are hosted under gametype=BEDWARS but aren't main
// Bedwars queues; skip them when deciding whether to engage.
export const BW_DUELS_MODES = new Set<string>([
  'BEDWARS_TWO_ONE_DUELS',
  'BEDWARS_TWO_ONE_DUELS_RUSH',
]);
