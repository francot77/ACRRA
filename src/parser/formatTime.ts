import { NO_TIME_SENTINEL } from '../types/assetto';

export function formatTime(milliseconds: number | null | undefined): string {
  if (milliseconds == null || milliseconds >= NO_TIME_SENTINEL) {
    return '--:--.---';
  }

  const minutes = Math.floor(milliseconds / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  const millis = milliseconds % 1000;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}
