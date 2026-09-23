export type DailyScoringSchedule = {
  expression: string;
  minute: number;
  hour: number;
};

const DAILY_SCHEDULE_PATTERN = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/;

export function parseDailyScoringSchedule(value: string): DailyScoringSchedule {
  const match = DAILY_SCHEDULE_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error('SCORING_SCHEDULE must be a daily cron expression in the form "minute hour * * *"');
  }

  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (minute > 59 || hour > 23) {
    throw new Error('SCORING_SCHEDULE minute must be 0-59 and hour must be 0-23');
  }

  return { expression: `${minute} ${hour} * * *`, minute, hour };
}

export const DEFAULT_DAILY_SCORING_SCHEDULE = parseDailyScoringSchedule('0 21 * * *');
