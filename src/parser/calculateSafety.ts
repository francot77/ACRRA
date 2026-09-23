import { DriverRaceStats, SafetyCategory } from '../types/assetto';

/** Stable identifier for the currently persisted safety calculation behavior. */
export const SAFETY_FORMULA_VERSION = 'safety-v2' as const;

/**
 * safety-v2 inputs are intentionally limited to normalized race statistics.
 * Existing ratings are not recalculated when this contract is introduced.
 */
export const SAFETY_V2_INPUTS = [
  'carIncidentsGrouped',
  'envHits',
  'totalCuts',
  'maxImpact',
  'finished'
] as const;

/** @deprecated Use SAFETY_V2_INPUTS. Kept as an export alias for compatibility. */
export const SAFETY_V1_INPUTS = SAFETY_V2_INPUTS;

export function calculateRaceSafety(
  stats: Pick<DriverRaceStats, 'carIncidentsGrouped' | 'envHits' | 'totalCuts' | 'maxImpact' | 'finished'>
): number {
  validateSafetyV2Inputs(stats);
  let score = 100;
  score -= stats.carIncidentsGrouped * 10;
  score -= stats.envHits * 6;
  score -= stats.totalCuts * 2;
  if (stats.maxImpact > 60) score -= 10;
  if (stats.maxImpact > 120) score -= 20;
  if (stats.maxImpact > 200) score -= 35;
  if (stats.finished) score += 5;
  if (stats.finished && stats.envHits === 0) score += 5;
  return clamp(score, 0, 100);
}

function validateSafetyV2Inputs(
  stats: Pick<DriverRaceStats, 'carIncidentsGrouped' | 'envHits' | 'totalCuts' | 'maxImpact' | 'finished'>
): void {
  const numericInputs = ['carIncidentsGrouped', 'envHits', 'totalCuts', 'maxImpact'] as const;
  const incompleteInput = numericInputs.find((input) => !Number.isFinite(stats[input]));
  if (incompleteInput) {
    throw new Error(`Cannot calculate safety-v2: incomplete input ${incompleteInput}`);
  }

  if (typeof stats.finished !== 'boolean') {
    throw new Error('Cannot calculate safety-v2: unsupported input types');
  }
}

export function updateSafetyRating(oldSafety: number, raceScore: number, safetyMemoryFactor = 0.85): number {
  return Number((oldSafety * safetyMemoryFactor + raceScore * (1 - safetyMemoryFactor)).toFixed(2));
}

type ApplySafetyRatingsOptions = {
  defaultSafetyRating?: number;
  safetyMemoryFactor?: number;
  minActiveDriversForSafety?: number;
};

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
  options: ApplySafetyRatingsOptions = {}
): DriverRaceStats[] {
  const {
    defaultSafetyRating = 75,
    safetyMemoryFactor = 0.85,
    minActiveDriversForSafety = 1
  } = options;
  const activeDrivers = stats.filter((entry) => entry.active).length;
  const safetyEligible = activeDrivers >= minActiveDriversForSafety;

  return stats.map((entry) => {
    const oldSafetyRating = entry.guid ? historicalRatings[entry.guid] ?? defaultSafetyRating : defaultSafetyRating;
    if (!entry.active) {
      return {
        ...entry,
        raceScore: 0,
        oldSafetyRating,
        newSafetyRating: oldSafetyRating,
        safetyChangeReason: 'inactive'
      };
    }

    const raceScore = calculateRaceSafety(entry);

    if (!safetyEligible) {
      return {
        ...entry,
        raceScore,
        oldSafetyRating,
        newSafetyRating: oldSafetyRating,
        safetyChangeReason: 'not-eligible'
      };
    }

    const newSafetyRating = !entry.finished && !hasMeaningfulIncident(entry)
      ? oldSafetyRating
      : !entry.finished
        ? Math.min(oldSafetyRating, updateSafetyRating(oldSafetyRating, raceScore, safetyMemoryFactor))
        : updateSafetyRating(oldSafetyRating, raceScore, safetyMemoryFactor);

    return {
      ...entry,
      raceScore,
      oldSafetyRating,
      newSafetyRating,
      safetyChangeReason: 'updated'
    };
  });
}

function hasMeaningfulIncident(
  stats: Pick<DriverRaceStats, 'carIncidentsGrouped' | 'envHits' | 'totalCuts' | 'maxImpact'>
): boolean {
  return stats.carIncidentsGrouped > 0 || stats.envHits > 0 || stats.totalCuts > 0 || stats.maxImpact > 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
