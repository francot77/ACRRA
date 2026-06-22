import { DriverRaceStats, SafetyCategory } from '../types/assetto';

export function calculateRaceSafety(
  stats: Pick<DriverRaceStats, 'carIncidentsGrouped' | 'envHits' | 'totalCuts' | 'maxImpact' | 'finished' | 'destructiveDnf'>
): number {
  let score = 100;
  score -= stats.carIncidentsGrouped * 10;
  score -= stats.envHits * 6;
  score -= stats.totalCuts * 2;
  if (stats.maxImpact > 60) score -= 10;
  if (stats.maxImpact > 120) score -= 20;
  if (stats.maxImpact > 200) score -= 35;
  if (stats.destructiveDnf) score -= 15;
  if (stats.finished) score += 5;
  if (stats.finished && stats.envHits === 0) score += 5;
  return clamp(score, 0, 100);
}

export function updateSafetyRating(oldSafety: number, raceScore: number, safetyMemoryFactor = 0.85): number {
  return Number((oldSafety * safetyMemoryFactor + raceScore * (1 - safetyMemoryFactor)).toFixed(2));
}

export function getSafetyCategory(score: number): SafetyCategory {
  if (score >= 90) return '🧼 Limpio';
  if (score >= 75) return '✅ Correcto';
  if (score >= 60) return '⚠️ Dudoso';
  if (score >= 40) return '🚧 Peligroso';
  if (score >= 20) return '🚜 Terrorista de T1';
  return '☢️ Amenaza pública';
}

export function applySafetyRatings(
  stats: DriverRaceStats[],
  historicalRatings: Partial<Record<string, number>> = {},
  defaultSafetyRating = 75,
  safetyMemoryFactor = 0.85
): DriverRaceStats[] {
  return stats.map((entry) => {
    const oldSafetyRating = entry.guid ? historicalRatings[entry.guid] ?? defaultSafetyRating : defaultSafetyRating;
    if (!entry.active) {
      return {
        ...entry,
        raceScore: 0,
        oldSafetyRating,
        newSafetyRating: oldSafetyRating
      };
    }

    const raceScore = calculateRaceSafety(entry);
    const newSafetyRating = updateSafetyRating(oldSafetyRating, raceScore, safetyMemoryFactor);

    return {
      ...entry,
      raceScore,
      oldSafetyRating,
      newSafetyRating
    };
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
