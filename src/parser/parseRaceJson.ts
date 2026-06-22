import {
  NO_TIME_SENTINEL,
  ParsedCarCollisionEvent,
  ParsedDriver,
  ParsedEnvCollisionEvent,
  ParsedEvent,
  ParsedLap,
  ParsedRace,
  RawCar,
  RawResult,
  rawSessionSchema
} from '../types/assetto';

export class NonRaceSessionError extends Error {
  constructor(type: string) {
    super(`Skipping file because json.Type is not RACE: ${type}`);
  }
}

export function parseRaceJson(input: string | unknown, sourceFileName = 'unknown.json'): ParsedRace {
  const rawValue = typeof input === 'string' ? JSON.parse(input) : input;
  normalizeSessionEvents(rawValue);
  const session = rawSessionSchema.parse(rawValue);

  if (session.Type !== 'RACE') {
    throw new NonRaceSessionError(session.Type);
  }

  const carsById = new Map<number, RawCar>(session.Cars.map((car) => [car.CarId, car]));
  const activeResults = session.Result.filter((result) => !isPlaceholderResult(result));
  const drivers = activeResults.map((result, index) => toParsedDriver(result, carsById.get(result.CarId), sourceFileName, index + 1));
  const activeCarIds = new Set(drivers.map((driver) => driver.carId));
  const driversByCarId = new Map(drivers.map((driver) => [driver.carId, driver]));
  const lapsByCarId = new Map<number, ParsedLap[]>();

  for (const lap of session.Laps) {
    if (!activeCarIds.has(lap.CarId) || lap.LapTime >= NO_TIME_SENTINEL) {
      continue;
    }

    const parsedLap: ParsedLap = {
      carId: lap.CarId,
      lapTime: lap.LapTime,
      sectors: lap.Sectors,
      cuts: lap.Cuts,
      tyre: lap.Tyre,
      timestamp: lap.Timestamp
    };

    const current = lapsByCarId.get(lap.CarId) ?? [];
    current.push(parsedLap);
    lapsByCarId.set(lap.CarId, current);
  }

  const events: ParsedEvent[] = [];

  session.Events.forEach((event, index) => {
    if (!activeCarIds.has(event.CarId)) {
      return;
    }

    const driver = driversByCarId.get(event.CarId);
    if (!driver) {
      return;
    }

    if (event.Type === 'COLLISION_WITH_ENV') {
      const parsedEvent: ParsedEnvCollisionEvent = {
        index,
        type: 'COLLISION_WITH_ENV',
        carId: event.CarId,
        driverIdentity: driver.identity,
        driverName: driver.name,
        impactSpeed: event.ImpactSpeed,
        worldPosition: event.WorldPosition
      };

      events.push(parsedEvent);
      return;
    }

    if (!activeCarIds.has(event.OtherCarId)) {
      return;
    }

    const otherDriver = driversByCarId.get(event.OtherCarId) ?? null;
    const parsedEvent: ParsedCarCollisionEvent = {
      index,
      type: 'COLLISION_WITH_CAR',
      carId: event.CarId,
      otherCarId: event.OtherCarId,
      driverIdentity: driver.identity,
      otherDriverIdentity: otherDriver?.identity ?? null,
      driverName: driver.name,
      otherDriverName: otherDriver?.name ?? event.OtherDriver?.Name ?? '',
      impactSpeed: event.ImpactSpeed,
      worldPosition: event.WorldPosition
    };

    events.push(parsedEvent);
  });

  return {
    sourceFileName,
    trackName: session.TrackName,
    trackConfig: session.TrackConfig,
    type: 'RACE',
    raceLaps: session.RaceLaps,
    carModel: activeResults[0]?.CarModel ?? null,
    drivers,
    lapsByCarId,
    events
  };
}

function normalizeSessionEvents(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }

  const session = value as { Events?: unknown };
  if (session.Events == null) {
    session.Events = [];
  }
}

function isPlaceholderResult(result: RawResult): boolean {
  return (
    result.DriverName === '' &&
    result.DriverGuid === '' &&
    result.BestLap === NO_TIME_SENTINEL &&
    result.TotalTime === 0
  );
}

function toParsedDriver(result: RawResult, car: RawCar | undefined, sourceFileName: string, position: number): ParsedDriver {
  const guid = result.DriverGuid.trim() || car?.Driver.Guid.trim() || '';

  return {
    carId: result.CarId,
    name: result.DriverName || car?.Driver.Name || `Car ${result.CarId}`,
    guid: guid || null,
    identity: guid
      ? { kind: 'guid', value: guid }
      : { kind: 'temp', value: `temp:${sourceFileName}:${result.CarId}` },
    carModel: result.CarModel || car?.Model || 'unknown',
    position,
    bestLap: result.BestLap >= NO_TIME_SENTINEL ? null : result.BestLap,
    totalTime: result.TotalTime
  };
}
