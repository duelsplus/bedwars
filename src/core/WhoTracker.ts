// Thin re-export. WhoTracker lives in @duelsplus/plugin-api/helpers now so it's
// reusable across game plugins; this alias keeps existing import paths working
// inside the bedwars plugin.
export { WhoTracker } from '@duelsplus/plugin-api';
export type { WhoTrackerOptions } from '@duelsplus/plugin-api';
