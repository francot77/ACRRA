import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseRaceJson } from '../parser/parseRaceJson';
import type { ParsedRace } from '../types/assetto';

export const DEFAULT_SCORING_TIMEZONE = 'America/Argentina/Buenos_Aires' as const;

export type ParsedRaceFilenameTimestamp = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  localDate: string;
  timestamp: Date;
};

export type RaceSourceConfig = {
  resultsDir: string;
  sourceGlob: string;
  minFileAgeMs: number;
  stabilityDelayMs?: number;
  raceWindowMinutes?: number;
};

export type ValidatedRaceSource = {
  fileName: string;
  filePath: string;
  fileHash: string;
  race: ParsedRace;
};

export async function findFirstEligibleRace(
  config: RaceSourceConfig,
  now = new Date(),
  slotDate = localDateKey(now, DEFAULT_SCORING_TIMEZONE),
  timezone: string = DEFAULT_SCORING_TIMEZONE
): Promise<ValidatedRaceSource | null> {
  const raceWindowMinutes = config.raceWindowMinutes ?? 60;
  if (!Number.isInteger(raceWindowMinutes) || raceWindowMinutes <= 0) {
    throw new Error('raceWindowMinutes must be a positive integer');
  }
  const window = getScoringWindowBounds(slotDate, timezone, raceWindowMinutes);
  if (!window) return null;
  const entries = await readdir(config.resultsDir, { withFileTypes: true }).catch(() => []);
  const names = entries
    .filter((entry) => entry.isFile() && matchesGlob(entry.name, config.sourceGlob))
    .map((entry) => entry.name)
    .map((fileName) => ({ fileName, parsed: parseRaceFilenameTimestamp(fileName, timezone) }))
    .filter(({ parsed }) => parsed !== null && parsed.localDate === slotDate && parsed.timestamp >= window.start && parsed.timestamp < window.end && parsed.timestamp <= now)
    .sort((left, right) => left.parsed!.timestamp.getTime() - right.parsed!.timestamp.getTime())
    .map(({ fileName }) => fileName);

  for (const fileName of names) {
    const candidate = await validateRaceFile(join(config.resultsDir, fileName), config, now);
    if (candidate) return candidate;
  }

  return null;
}

export function getScoringWindowBounds(slotDate: string, timezone: string = DEFAULT_SCORING_TIMEZONE, windowMinutes = 60): { start: Date; end: Date } | null {
  if (!Number.isInteger(windowMinutes) || windowMinutes <= 0) throw new Error('windowMinutes must be a positive integer');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(slotDate);
  if (!match) return null;
  const start = localDateTimeToInstant({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: 21, minute: 0 }, timezone);
  return start ? { start, end: new Date(start.getTime() + windowMinutes * 60_000) } : null;
}

export function parseRaceFilenameTimestamp(
  fileName: string,
  timezone: string = DEFAULT_SCORING_TIMEZONE
): ParsedRaceFilenameTimestamp | null {
  const match = /^(\d{4})_(\d{1,2})_(\d{1,2})_(\d{1,2})_(\d{1,2})_RACE\.json$/.exec(fileName);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    calendar.getUTCHours() !== hour ||
    calendar.getUTCMinutes() !== minute
  ) return null;

  const timestamp = localDateTimeToInstant({ year, month, day, hour, minute }, timezone);
  if (!timestamp) return null;
  return { year, month, day, hour, minute, localDate: `${year}-${pad(month)}-${pad(day)}`, timestamp };
}

export async function validateRaceFile(
  filePath: string,
  config: Pick<RaceSourceConfig, 'minFileAgeMs' | 'stabilityDelayMs'>,
  now = new Date()
): Promise<ValidatedRaceSource | null> {
  if (!parseRaceFilenameTimestamp(basename(filePath))) return null;
  const first = await stat(filePath).catch(() => null);
  if (!first || now.getTime() - first.mtimeMs < config.minFileAgeMs) return null;

  const content = await readFile(filePath, 'utf8').catch(() => null);
  if (content == null) return null;
  await delay(config.stabilityDelayMs ?? 25);

  const second = await stat(filePath).catch(() => null);
  if (!second || first.size !== second.size || first.mtimeMs !== second.mtimeMs) return null;

  let race: ParsedRace;
  try {
    race = parseRaceJson(content, basename(filePath));
  } catch {
    return null;
  }

  return {
    fileName: basename(filePath),
    filePath,
    fileHash: createHash('sha256').update(content).digest('hex'),
    race
  };
}

function matchesGlob(fileName: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(fileName);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function localDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localDateTimeToInstant(
  parts: Pick<ParsedRaceFilenameTimestamp, 'year' | 'month' | 'day' | 'hour' | 'minute'>,
  timezone: string
): Date | null {
  const targetUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let candidate = new Date(targetUtc);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(candidate);
    const values = Object.fromEntries(formatted.map((part) => [part.type, part.value]));
    const formattedUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
    candidate = new Date(candidate.getTime() + targetUtc - formattedUtc);
  }

  const verified = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
  }).formatToParts(candidate);
  const values = Object.fromEntries(verified.map((part) => [part.type, Number(part.value)]));
  return values.year === parts.year && values.month === parts.month && values.day === parts.day && values.hour === parts.hour && values.minute === parts.minute
    ? candidate
    : null;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
