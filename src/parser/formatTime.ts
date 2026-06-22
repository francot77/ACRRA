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

export function formatLapTime(milliseconds: number | null | undefined): string {
  if (milliseconds == null || milliseconds >= NO_TIME_SENTINEL) {
    return '--:--.---';
  }

  const rounded = Math.round(milliseconds);
  const minutes = Math.floor(rounded / 60000);
  const seconds = Math.floor((rounded % 60000) / 1000);
  const millis = rounded % 1000;

  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function formatGap(milliseconds: number | null | undefined): string {
  if (milliseconds == null || !Number.isFinite(milliseconds) || milliseconds < 0) {
    return '--:--.---';
  }

  return `+${formatTime(Math.round(milliseconds))}`;
}

export function formatConsistency(milliseconds: number | null | undefined): string {
  if (milliseconds == null || !Number.isFinite(milliseconds)) {
    return 'Sin datos';
  }

  const rounded = Math.round(milliseconds);
  const minutes = Math.floor(rounded / 60000);
  const seconds = Math.floor((rounded % 60000) / 1000);
  const millis = rounded % 1000;

  if (minutes === 0) {
    return `±${seconds}.${String(millis).padStart(3, '0')}s`;
  }

  return `±${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}
