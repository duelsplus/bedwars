export interface BedwarsExtractedModeStats {
  winsInMode: number;
  lossesInMode: number;
  currentWinstreakInMode: number;
  finalKillsInMode: number;
  finalDeathsInMode: number;
  bedBreaksInMode: number;
  bedBrokenInMode: number;
}

const bedwarsModes: Record<string, { prefix: string; suffix: string }> = {
  bedwars_eight_one: { prefix: 'eight_one', suffix: '_bedwars' },
  bedwars_eight_two: { prefix: 'eight_two', suffix: '_bedwars' },
  bedwars_four_three: { prefix: 'four_three', suffix: '_bedwars' },
  bedwars_four_four: { prefix: 'four_four', suffix: '_bedwars' },
  bedwars_two_four: { prefix: 'two_four', suffix: '_bedwars' },
  bedwars_capture: { prefix: 'capture', suffix: '_bedwars' },
  bedwars_eight_two_rush: { prefix: 'eight_two_rush', suffix: '_bedwars' },
  bedwars_four_four_rush: { prefix: 'four_four_rush', suffix: '_bedwars' },
  bedwars_eight_one_rush: { prefix: 'eight_one_rush', suffix: '_bedwars' },
  bedwars_eight_two_swap: { prefix: 'eight_two_swap', suffix: '_bedwars' },
  bedwars_four_four_swap: { prefix: 'four_four_swap', suffix: '_bedwars' },
  bedwars_eight_two_ultimate: { prefix: 'eight_two_ultimate', suffix: '_bedwars' },
  bedwars_four_four_ultimate: { prefix: 'four_four_ultimate', suffix: '_bedwars' },
  bedwars_eight_one_ultimate: { prefix: 'eight_one_ultimate', suffix: '_bedwars' },
  bedwars_castle: { prefix: 'castle', suffix: '_bedwars' },
  bedwars_eight_two_voidless: { prefix: 'eight_two_voidless', suffix: '_bedwars' },
  bedwars_four_four_voidless: { prefix: 'four_four_voidless', suffix: '_bedwars' },
  bedwars_eight_two_underworld: { prefix: 'eight_two_underworld', suffix: '_bedwars' },
  bedwars_four_four_underworld: { prefix: 'four_four_underworld', suffix: '_bedwars' },
  bedwars_eight_two_armed: { prefix: 'eight_two_armed', suffix: '_bedwars' },
  bedwars_four_four_armed: { prefix: 'four_four_armed', suffix: '_bedwars' },
  bedwars_eight_two_lucky: { prefix: 'eight_two_lucky', suffix: '_bedwars' },
  bedwars_four_four_lucky: { prefix: 'four_four_lucky', suffix: '_bedwars' },
};

const bedwarsCombinedStatsKeys: Record<string, string[]> = {
  bedwars_overall: ['eight_one', 'eight_two', 'four_three', 'four_four', 'two_four'],
  bedwars_rush: ['eight_one_rush', 'eight_two_rush', 'four_four_rush'],
  bedwars_ultimate: ['eight_one_ultimate', 'eight_two_ultimate', 'four_four_ultimate'],
  bedwars_void: ['eight_two_voidless', 'four_four_voidless'],
  bedwars_armed: ['eight_two_armed', 'four_four_armed'],
  bedwars_lucky: ['eight_two_lucky', 'four_four_lucky'],
  bedwars_swap: ['eight_two_swap', 'four_four_swap'],
  bedwars_underworld: ['eight_two_underworld', 'four_four_underworld'],
};

export function getBedwarsStats(
  modeValue: string,
  bwStats: Record<string, number | string>,
): BedwarsExtractedModeStats {
  const stats: BedwarsExtractedModeStats = {
    winsInMode: 0,
    lossesInMode: 0,
    currentWinstreakInMode: 0,
    finalKillsInMode: 0,
    finalDeathsInMode: 0,
    bedBreaksInMode: 0,
    bedBrokenInMode: 0,
  };

  if (bedwarsCombinedStatsKeys[modeValue]) {
    for (const mode of bedwarsCombinedStatsKeys[modeValue]) {
      stats.winsInMode += (bwStats[`${mode}_wins_bedwars`] as number) || 0;
      stats.lossesInMode += (bwStats[`${mode}_losses_bedwars`] as number) || 0;
      stats.currentWinstreakInMode += (bwStats[`${mode}_winstreak`] as number) || 0;
      stats.finalKillsInMode += (bwStats[`${mode}_final_kills_bedwars`] as number) || 0;
      stats.finalDeathsInMode += (bwStats[`${mode}_final_deaths_bedwars`] as number) || 0;
      stats.bedBreaksInMode += (bwStats[`${mode}_beds_broken_bedwars`] as number) || 0;
      stats.bedBrokenInMode += (bwStats[`${mode}_beds_lost_bedwars`] as number) || 0;
    }
    return stats;
  }

  let config = bedwarsModes[modeValue];
  if (!config && modeValue.startsWith('bedwars_')) {
    // Longest prefix wins so rotating queue variants still resolve.
    const suffix = modeValue.slice('bedwars_'.length);
    const known = Object.values(bedwarsModes)
      .map((m) => m.prefix)
      .sort((a, b) => b.length - a.length);
    const match = known.find((p) => suffix === p || suffix.startsWith(`${p}_`));
    if (match) {
      config = { prefix: match, suffix: '_bedwars' };
    }
  }

  if (config) {
    const { prefix, suffix } = config;
    stats.winsInMode = (bwStats[`${prefix}_wins${suffix}`] as number) || 0;
    stats.lossesInMode = (bwStats[`${prefix}_losses${suffix}`] as number) || 0;
    stats.currentWinstreakInMode = (bwStats[`${prefix}_winstreak`] as number) || 0;
    stats.finalKillsInMode = (bwStats[`${prefix}_final_kills${suffix}`] as number) || 0;
    stats.finalDeathsInMode = (bwStats[`${prefix}_final_deaths${suffix}`] as number) || 0;
    stats.bedBreaksInMode = (bwStats[`${prefix}_beds_broken${suffix}`] as number) || 0;
    stats.bedBrokenInMode = (bwStats[`${prefix}_beds_lost${suffix}`] as number) || 0;
  }

  return stats;
}
