import type { IncidentScene, IncidentSceneCar, IncidentSceneFrame } from './reconstructionTypes';

const MAX_FRAMES = 5;
const MAX_DERIVED_GAP_MS = 400;

type FrameCandidate = Readonly<{
  atRelativeMs: number;
  source: IncidentSceneFrame['source'];
}>;

export function buildIncidentFrameSequence(scene: IncidentScene): readonly IncidentSceneFrame[] {
  const candidates = selectFrameCandidates(scene);

  return Object.freeze(candidates.map((candidate) => {
    const cars = scene.cars
      .map((car) => resolveFrameCar(car, candidate.atRelativeMs))
      .filter((entry): entry is IncidentSceneFrame['cars'][number] => entry !== null)
      .sort((left, right) => left.carId - right.carId);

    return Object.freeze({
      atRelativeMs: candidate.atRelativeMs,
      source: candidate.source,
      cars: Object.freeze(cars),
    });
  }).filter((frame) => frame.cars.length > 0));
}

function selectFrameCandidates(scene: IncidentScene): readonly FrameCandidate[] {
  const observedTimes = Array.from(new Set(
    scene.cars.flatMap((car) => car.placements)
      .filter((placement) => placement.forwardM != null && placement.lateralM != null)
      .map((placement) => placement.relativeMs),
  )).sort((left, right) => left - right);

  if (observedTimes.length === 0) {
    return Object.freeze([]);
  }

  const candidates = new Map<number, FrameCandidate>();
  for (const time of observedTimes) {
    candidates.set(time, Object.freeze({ atRelativeMs: time, source: 'observed' }));
  }

  for (let index = 0; index < observedTimes.length - 1; index += 1) {
    const start = observedTimes[index]!;
    const end = observedTimes[index + 1]!;
    const gap = end - start;
    if (gap > 1 && gap <= MAX_DERIVED_GAP_MS) {
      const midpoint = Math.round((start + end) / 2);
      if (!candidates.has(midpoint)) {
        candidates.set(midpoint, Object.freeze({ atRelativeMs: midpoint, source: 'derived' }));
      }
    }
  }

  const orderedCandidates = Array.from(candidates.values()).sort((left, right) => left.atRelativeMs - right.atRelativeMs);
  if (orderedCandidates.length <= MAX_FRAMES) {
    return Object.freeze(orderedCandidates);
  }

  const requiredIndexes = new Set<number>([
    0,
    orderedCandidates.length - 1,
    findNearestCandidateIndex(orderedCandidates, scene.anchorRelativeMs),
  ]);

  const selectedIndexes = Array.from(requiredIndexes).sort((left, right) => left - right);
  while (selectedIndexes.length < MAX_FRAMES) {
    const nextIndex = findLargestGapMidpoint(selectedIndexes, orderedCandidates.length);
    if (nextIndex == null) {
      break;
    }

    if (!requiredIndexes.has(nextIndex)) {
      requiredIndexes.add(nextIndex);
      selectedIndexes.push(nextIndex);
      selectedIndexes.sort((left, right) => left - right);
    }
  }

  return Object.freeze(selectedIndexes.map((index) => orderedCandidates[index]!).sort((left, right) => left.atRelativeMs - right.atRelativeMs));
}

function resolveFrameCar(car: IncidentSceneCar, atRelativeMs: number): IncidentSceneFrame['cars'][number] | null {
  const exact = car.placements.find((placement) => placement.relativeMs === atRelativeMs && placement.forwardM != null && placement.lateralM != null);
  if (exact) {
    return Object.freeze({
      carId: car.carId,
      forwardM: round(exact.forwardM!),
      lateralM: round(exact.lateralM!),
      evidence: exact.evidence.state,
    });
  }

  const finitePlacements = car.placements
    .filter((placement) => placement.forwardM != null && placement.lateralM != null)
    .sort((left, right) => left.relativeMs - right.relativeMs || (left.snapshotId ?? 0) - (right.snapshotId ?? 0));
  const before = finitePlacements.filter((placement) => placement.relativeMs < atRelativeMs).at(-1) ?? null;
  const after = finitePlacements.find((placement) => placement.relativeMs > atRelativeMs) ?? null;

  if (!before || !after) {
    return null;
  }

  const gap = after.relativeMs - before.relativeMs;
  if (gap <= 0 || gap > MAX_DERIVED_GAP_MS) {
    return null;
  }

  const ratio = (atRelativeMs - before.relativeMs) / gap;
  return Object.freeze({
    carId: car.carId,
    forwardM: round((before.forwardM!) + ((after.forwardM! - before.forwardM!) * ratio)),
    lateralM: round((before.lateralM!) + ((after.lateralM! - before.lateralM!) * ratio)),
    evidence: 'derived',
  });
}

function findNearestCandidateIndex(candidates: readonly FrameCandidate[], anchorRelativeMs: number): number {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  candidates.forEach((candidate, index) => {
    const distance = Math.abs(candidate.atRelativeMs - anchorRelativeMs);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
}

function findLargestGapMidpoint(selectedIndexes: readonly number[], total: number): number | null {
  const ordered = selectedIndexes.slice().sort((left, right) => left - right);
  let largestGap = 0;
  let midpoint: number | null = null;

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const left = ordered[index]!;
    const right = ordered[index + 1]!;
    const gap = right - left;
    if (gap > largestGap && gap > 1) {
      largestGap = gap;
      midpoint = left + Math.floor(gap / 2);
    }
  }

  if (midpoint == null && ordered[0] !== 0) {
    return Math.floor(ordered[0]! / 2);
  }

  if (midpoint == null && ordered[ordered.length - 1] !== total - 1) {
    const last = ordered[ordered.length - 1]!;
    return last + Math.ceil((total - 1 - last) / 2);
  }

  return midpoint;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
