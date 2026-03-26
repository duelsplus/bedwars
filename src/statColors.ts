/**
 * Stat tier colours aligned with Duels+ proxy (utils/statsColors).
 */

function formatAlternating(str: string, colors: string[]): string {
  let formatted = '';
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '.') {
      formatted += '§7' + char;
    } else {
      formatted += (colors[i % colors.length] ?? '§f') + char;
    }
  }
  return formatted;
}

export function getModeWinColor(wins: number): string {
  const winsStr = wins.toString();
  const cyanBlueColors = ['§b', '§3'];

  if (wins <= 49) return `§7${wins}`;
  if (wins <= 99) return `§8${wins}`;
  if (wins <= 249) return `§f${wins}`;
  if (wins <= 499) return `§6${wins}`;
  if (wins <= 999) return `§3${wins}`;
  if (wins <= 1999) return `§2${wins}`;
  if (wins <= 4999) return `§4${wins}`;
  if (wins <= 9999) return `§e${wins}`;
  if (wins <= 24999) return `§5${wins}`;
  if (wins <= 49999) return formatAlternating(winsStr, cyanBlueColors);
  if (wins <= 99999) return `§d${wins}`;
  return `§c${wins}`;
}

export function getWinsColorBedwars(wins: number): string {
  return getModeWinColor(wins);
}

export function getWlrColor(wlr: number): string {
  const wlrNum = parseFloat(String(wlr)) || 0;
  const wlrStr = wlrNum.toFixed(2).replace(/\.00$/, '');
  const cyanBlueColors = ['§b', '§3', '§7', '§b', '§3'];
  const rainbowColors = ['§c', '§e', '§a', '§b', '§3', '§9', '§d', '§5'];

  if (wlrNum >= 100) return formatAlternating(wlrStr, rainbowColors);
  if (wlrNum >= 75 && wlrNum < 100) return `§c${wlrStr}`;
  if (wlrNum >= 50 && wlrNum < 75) return `§d${wlrStr}`;
  if (wlrNum >= 25 && wlrNum < 50) return formatAlternating(wlrStr, cyanBlueColors);
  if (wlrNum >= 20 && wlrNum < 25) return `§5${wlrStr}`;
  if (wlrNum >= 15 && wlrNum < 20) return `§e${wlrStr}`;
  if (wlrNum >= 10 && wlrNum < 15) return `§4${wlrStr}`;
  if (wlrNum >= 5 && wlrNum < 10) return `§2${wlrStr}`;
  if (wlrNum >= 2 && wlrNum < 5) return `§b${wlrStr}`;
  if (wlrNum >= 1 && wlrNum < 2) return `§6${wlrStr}`;
  if (wlrNum >= 0.5 && wlrNum < 1) return `§f${wlrStr}`;
  return `§8${wlrStr}`;
}

export function getFkdrColor(fkdr: number): string {
  const fkdrNum = parseFloat(String(fkdr)) || 0;
  const fkdrStr = fkdrNum.toFixed(2).replace(/\.00$/, '');

  if (fkdrNum >= 100) return `§5${fkdrStr}`;
  if (fkdrNum >= 50) return `§d${fkdrStr}`;
  if (fkdrNum >= 30) return `§4${fkdrStr}`;
  if (fkdrNum >= 20) return `§c${fkdrStr}`;
  if (fkdrNum >= 10) return `§6${fkdrStr}`;
  if (fkdrNum >= 7) return `§e${fkdrStr}`;
  if (fkdrNum >= 5) return `§2${fkdrStr}`;
  if (fkdrNum >= 3) return `§a${fkdrStr}`;
  if (fkdrNum >= 1) return `§7${fkdrStr}`;
  return `§8${fkdrStr}`;
}

/** Simple star tier from Hypixel bedwars_level */
export function getStarsColor(stars: number): string {
  const s = Math.floor(stars);
  if (s >= 500) return `§5${s}✫`;
  if (s >= 300) return `§d${s}✫`;
  if (s >= 200) return `§c${s}✫`;
  if (s >= 120) return `§6${s}✫`;
  if (s >= 80) return `§e${s}✫`;
  if (s >= 40) return `§a${s}✫`;
  if (s >= 20) return `§b${s}✫`;
  return `§7${s}✫`;
}
