export type FinishResult = {
  driverName: string;
  driverGuid?: string | null;
  position: number;
  classified: boolean;
};

export type ScoringRace = {
  raceId: string;
  runId: string;
  results: readonly FinishResult[];
};

export type Award = {
  driverId: number;
  driverName: string;
  position: number;
  points: number;
};

export type ScoringDriver = {
  id: number;
  guid: string | null;
  displayName: string;
  normalizedName: string;
};
