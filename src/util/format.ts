export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Returns the numerator when den is 0 (convention for W/L and FKDR). */
export function safeRatio(num: number, den: number): number {
  return den === 0 ? num : Math.round((num / den) * 100) / 100;
}
