import { z } from 'zod';

export const NO_TIME_SENTINEL = 999999999;

export const rawDriverSchema = z.object({
  Name: z.string(),
  Team: z.string(),
  Nation: z.string(),
  Guid: z.string(),
  GuidsList: z.array(z.string()).nullable().default([])
});

export const rawCarSchema = z.object({
  CarId: z.number().int(),
  Driver: rawDriverSchema,
  Model: z.string(),
  Skin: z.string(),
  BallastKG: z.number(),
  Restrictor: z.number()
});

export const rawResultSchema = z.object({
  DriverName: z.string(),
  DriverGuid: z.string(),
  CarId: z.number().int(),
  CarModel: z.string(),
  BestLap: z.number().int(),
  TotalTime: z.number().int(),
  BallastKG: z.number(),
  Restrictor: z.number()
});

export const rawLapSchema = z.object({
  DriverName: z.string(),
  DriverGuid: z.string(),
  CarId: z.number().int(),
  CarModel: z.string(),
  Timestamp: z.number().int(),
  LapTime: z.number().int(),
  Sectors: z.array(z.number().int()),
  Cuts: z.number().int(),
  BallastKG: z.number(),
  Tyre: z.string(),
  Restrictor: z.number()
});

export const vector3Schema = z.object({
  X: z.number(),
  Y: z.number(),
  Z: z.number()
});

export const rawEventSchema = z.object({
  Type: z.enum(['COLLISION_WITH_CAR', 'COLLISION_WITH_ENV']),
  CarId: z.number().int(),
  Driver: rawDriverSchema,
  OtherCarId: z.number().int(),
  OtherDriver: rawDriverSchema.optional(),
  ImpactSpeed: z.number(),
  WorldPosition: vector3Schema.optional(),
  RelPosition: vector3Schema.optional()
});

export const rawSessionSchema = z.object({
  TrackName: z.string(),
  TrackConfig: z.string(),
  Type: z.string(),
  DurationSecs: z.number().int(),
  RaceLaps: z.number().int(),
  Cars: z.array(rawCarSchema),
  Result: z.array(rawResultSchema),
  Laps: z.array(rawLapSchema),
  Events: z.array(rawEventSchema)
});

export type RawCar = z.infer<typeof rawCarSchema>;
export type RawResult = z.infer<typeof rawResultSchema>;
export type RawLap = z.infer<typeof rawLapSchema>;
export type RawEvent = z.infer<typeof rawEventSchema>;
export type RawSession = z.infer<typeof rawSessionSchema>;
export type Vector3 = z.infer<typeof vector3Schema>;
export type DriverIdentity =
  | { kind: 'guid'; value: string }
  | { kind: 'temp'; value: `temp:${string}:${number}` };

export interface ParsedDriver {
  carId: number;
  name: string;
  guid: string | null;
  identity: DriverIdentity;
  carModel: string;
  position: number;
  bestLap: number | null;
  totalTime: number;
}

export interface ParsedLap {
  carId: number;
  lapTime: number;
  sectors: number[];
  cuts: number;
  tyre: string;
  timestamp: number;
}

export interface ParsedCarCollisionEvent {
  index: number;
  type: 'COLLISION_WITH_CAR';
  carId: number;
  otherCarId: number;
  driverIdentity: DriverIdentity;
  otherDriverIdentity: DriverIdentity | null;
  driverName: string;
  otherDriverName: string;
  impactSpeed: number;
  worldPosition?: Vector3;
}

export interface ParsedEnvCollisionEvent {
  index: number;
  type: 'COLLISION_WITH_ENV';
  carId: number;
  driverIdentity: DriverIdentity;
  driverName: string;
  impactSpeed: number;
  worldPosition?: Vector3;
}

export type ParsedEvent = ParsedCarCollisionEvent | ParsedEnvCollisionEvent;

export interface ParsedRace {
  sourceFileName: string;
  trackName: string;
  trackConfig: string;
  type: 'RACE';
  raceLaps: number;
  carModel: string | null;
  drivers: ParsedDriver[];
  lapsByCarId: Map<number, ParsedLap[]>;
  events: ParsedEvent[];
}

export interface GroupedIncident {
  pairKey: string;
  driversInvolved: Array<{ carId: number; name: string; identity: DriverIdentity | null }>;
  carIdsInvolved: [number, number];
  maxImpact: number;
  avgImpact: number;
  representativeWorldPosition?: Vector3;
  rawEventCount: number;
}

export interface DriverStats {
  position: number;
  completedLaps: number;
  raceLaps: number;
  hasValidResult: boolean;
  active: boolean;
  inactive: boolean;
  finished: boolean;
  destructiveDnf: boolean;
  bestLap: number | null;
  avgLap: number | null;
  idealLap: number | null;
  consistency: number | null;
  totalCuts: number;
  carIncidentsGrouped: number;
  envHits: number;
  maxCarImpact: number;
  maxEnvImpact: number;
  maxImpact: number;
  rawCollisionEvents: number;
  'tyre usado más frecuente': string | null;
  totalTime: number;
  raceScore: number;
  oldSafetyRating: number;
  newSafetyRating: number;
}

export interface DriverRaceStats extends DriverStats {
  carId: number;
  name: string;
  guid: string | null;
  identity: DriverIdentity;
}

export type SafetyCategory =
  | '🧼 Limpio'
  | '✅ Correcto'
  | '⚠️ Dudoso'
  | '🚧 Peligroso'
  | '🚜 Terrorista de T1'
  | '☢️ Amenaza pública';
