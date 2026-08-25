export type FinishResult = {
  driverName: string;
  driverGuid?: string | null;
  driverId?: number;
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

export type ScoringStanding = {
  driverName: string;
  points: number;
  races: number;
  wins: number;
  podiums: number;
};

export type ScoringDriver = {
  id: number;
  guid: string | null;
  displayName: string;
  normalizedName: string;
};
