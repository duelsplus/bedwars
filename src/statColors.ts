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

export function getLossesColor(losses: number): string {
  if (losses <= 49) return `§7${losses}`;
  if (losses <= 249) return `§8${losses}`;
  if (losses <= 499) return `§f${losses}`;
  if (losses <= 999) return `§b${losses}`;
  if (losses <= 1999) return `§3${losses}`;
  if (losses <= 4999) return `§d${losses}`;
  if (losses <= 9999) return `§5${losses}`;
  if (losses <= 24999) return `§c${losses}`;
  return `§4${losses}`;
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

function getStarIcon(level: number): string {
  if (level < 1100) return '✫';
  if (level < 2100) return '✪';
  if (level < 3100) return '⚝';
  return '✥';
}

function getPrestigePalette(prestige: number): string[] {
  if (prestige < 100) return ['§7', '§7', '§7', '§7', '§7', '§7', '§7'];
  if (prestige < 200) return ['§f', '§f', '§f', '§f', '§f', '§f', '§f'];
  if (prestige < 300) return ['§6', '§6', '§6', '§6', '§6', '§6', '§6'];
  if (prestige < 400) return ['§b', '§b', '§b', '§b', '§b', '§b', '§b'];
  if (prestige < 500) return ['§2', '§2', '§2', '§2', '§2', '§2', '§2'];
  if (prestige < 600) return ['§3', '§3', '§3', '§3', '§3', '§3', '§3'];
  if (prestige < 700) return ['§4', '§4', '§4', '§4', '§4', '§4', '§4'];
  if (prestige < 800) return ['§d', '§d', '§d', '§d', '§d', '§d', '§d'];
  if (prestige < 900) return ['§9', '§9', '§9', '§9', '§9', '§9', '§9'];
  if (prestige < 1000) return ['§5', '§5', '§5', '§5', '§5', '§5', '§5'];
  if (prestige < 1100) return ['§c', '§6', '§e', '§a', '§b', '§d', '§5'];
  if (prestige < 1200) return ['§7', '§f', '§f', '§f', '§f', '§7', '§7'];
  if (prestige < 1300) return ['§7', '§e', '§e', '§e', '§e', '§6', '§7'];
  if (prestige < 1400) return ['§7', '§b', '§b', '§b', '§b', '§3', '§7'];
  if (prestige < 1500) return ['§7', '§a', '§a', '§a', '§a', '§2', '§7'];
  if (prestige < 1600) return ['§7', '§3', '§3', '§3', '§3', '§9', '§7'];
  if (prestige < 1700) return ['§7', '§c', '§c', '§c', '§c', '§4', '§7'];
  if (prestige < 1800) return ['§7', '§d', '§d', '§d', '§d', '§5', '§7'];
  if (prestige < 1900) return ['§7', '§9', '§9', '§9', '§9', '§1', '§7'];
  if (prestige < 2000) return ['§7', '§5', '§5', '§5', '§5', '§8', '§7'];
  if (prestige < 2100) return ['§8', '§7', '§f', '§f', '§7', '§7', '§8'];
  if (prestige < 2200) return ['§f', '§e', '§e', '§6', '§6', '§6', '§6'];
  if (prestige < 2300) return ['§6', '§f', '§f', '§b', '§3', '§3', '§3'];
  if (prestige < 2400) return ['§5', '§d', '§d', '§6', '§e', '§e', '§e'];
  if (prestige < 2500) return ['§b', '§f', '§f', '§7', '§7', '§8', '§8'];
  if (prestige < 2600) return ['§f', '§a', '§a', '§2', '§2', '§2', '§2'];
  if (prestige < 2700) return ['§4', '§c', '§c', '§d', '§d', '§d', '§d'];
  if (prestige < 2800) return ['§e', '§f', '§f', '§8', '§8', '§8', '§8'];
  if (prestige < 2900) return ['§a', '§2', '§2', '§6', '§6', '§e', '§e'];
  if (prestige < 3000) return ['§b', '§3', '§3', '§9', '§9', '§1', '§1'];
  if (prestige < 3100) return ['§e', '§6', '§6', '§c', '§c', '§4', '§4'];
  return ['§7', '§7', '§7', '§7', '§7', '§7', '§7'];
}

export function formatBedwarsLevel(level: number): string {
  const starIcon = getStarIcon(level);
  const levelStr = level.toString();
  const prestige = Math.floor(level / 100) * 100;
  const colors = getPrestigePalette(prestige);
  const c = (i: number): string => colors[Math.min(i, colors.length - 1)] ?? '§7';

  let result = c(0) + '[';
  for (let i = 0; i < levelStr.length; i++) {
    result += c(i + 1) + levelStr[i];
  }
  result += c(levelStr.length + 1) + starIcon;
  result += c(levelStr.length + 2) + ']';
  return result;
}
