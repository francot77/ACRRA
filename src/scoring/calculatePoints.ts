import type { FinishResult } from './types';

export const CHAMPIONSHIP_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] as const;

export function pointsForPosition(position: number): number {
  if (!Number.isInteger(position) || position < 1 || position > CHAMPIONSHIP_POINTS.length) {
    throw new RangeError(`Position must be an integer from 1 to ${CHAMPIONSHIP_POINTS.length}`);
  }
  return CHAMPIONSHIP_POINTS[position - 1];
}

export function calculatePoints(results: readonly FinishResult[]): number[] {
  return results.map((result) => result.classified ? pointsForPosition(result.position) : 0);
}

export function calculateAwards(results: readonly FinishResult[]): Array<FinishResult & { points: number }> {
  return results.map((result) => ({ ...result, points: result.classified ? pointsForPosition(result.position) : 0 }));
}
