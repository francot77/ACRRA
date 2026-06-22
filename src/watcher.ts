import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import chokidar, { FSWatcher } from 'chokidar';
import { ZodError } from 'zod';
import { AppConfig } from './config';
import { Repositories } from './db/repositories';
import { NonRaceSessionError } from './parser/parseRaceJson';

const STABILITY_RECHECK_MS = 250;
const INVALID_JSON_RETRY_LIMIT = 5;

type ProcessFile = (filePath: string) => Promise<'processed' | 'duplicate' | 'non-race'>;

export async function watchRaceResults(options: {
  config: AppConfig;
  repositories: Repositories;
  processFile: ProcessFile;
}): Promise<{ close: () => Promise<void> }> {
  const pending = new Map<string, NodeJS.Timeout>();
  const invalidJsonRetries = new Map<string, number>();
  const watcher = chokidar.watch(options.config.resultsDir, {
    ignoreInitial: !options.config.scanOnStart,
    persistent: true,
    ignorePermissionErrors: true,
    awaitWriteFinish: false
  });

  const schedule = (filePath: string, delayMs = options.config.minFileAgeMs): void => {
    const existing = pending.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    pending.set(
      filePath,
      setTimeout(() => {
        pending.delete(filePath);
        void handleFile(filePath);
      }, Math.max(delayMs, 50))
    );
  };

  const scheduleIfMatch = (filePath: string): void => {
    if (!matchesWatchGlob(basename(filePath), options.config.watchGlob)) {
      return;
    }

    schedule(filePath);
  };

  const handleFile = async (filePath: string): Promise<void> => {
    const fileName = basename(filePath);

    if (options.repositories.processedFiles.has(fileName)) {
      log('info', 'watcher', 'Skipping already processed file', { fileName });
      return;
    }

    let firstStat;
    try {
      firstStat = await stat(filePath);
    } catch {
      return;
    }

    const ageMs = Date.now() - firstStat.mtimeMs;
    if (ageMs < options.config.minFileAgeMs) {
      log('info', 'watcher', 'Race file still changing, delaying parse', { fileName });
      schedule(filePath, options.config.minFileAgeMs - ageMs);
      return;
    }

    await delay(STABILITY_RECHECK_MS);

    let secondStat;
    try {
      secondStat = await stat(filePath);
    } catch {
      return;
    }

    if (firstStat.size !== secondStat.size) {
      log('info', 'watcher', 'Race file still changing, delaying parse', { fileName });
      schedule(filePath);
      return;
    }

    try {
      await options.processFile(filePath);
      invalidJsonRetries.delete(filePath);
    } catch (error) {
      if (error instanceof NonRaceSessionError) {
        log('info', 'watcher', error.message, { fileName });
        return;
      }

      if (isRetryableJsonError(error)) {
        const attempt = (invalidJsonRetries.get(filePath) ?? 0) + 1;

        if (attempt < INVALID_JSON_RETRY_LIMIT) {
          invalidJsonRetries.set(filePath, attempt);
          log('info', 'watcher', 'Invalid race JSON, retrying', { fileName, attempt });
          schedule(filePath);
          return;
        }

        invalidJsonRetries.delete(filePath);
        log('error', 'watcher', 'Invalid race JSON, skipping', { fileName, attempt, error: error.message });
        return;
      }

      log('error', 'watcher', 'Unhandled processing error', {
        fileName,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };

  watcher.on('add', (filePath) => {
    scheduleIfMatch(filePath);
  });
  watcher.on('change', (filePath) => {
    scheduleIfMatch(filePath);
  });
  watcher.on('error', (error: unknown) => {
    log('error', 'watcher', 'Watcher error', { error: error instanceof Error ? error.message : String(error) });
  });

  return {
    async close() {
      for (const timeout of pending.values()) {
        clearTimeout(timeout);
      }

      pending.clear();
      invalidJsonRetries.clear();
      await watcher.close();
    }
  };
}

function isRetryableJsonError(error: unknown): error is SyntaxError | ZodError {
  return error instanceof SyntaxError || error instanceof ZodError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchesWatchGlob(fileName: string, pattern: string): boolean {
  const escapedPattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escapedPattern}$`).test(fileName);
}

function log(level: 'info' | 'error', component: string, message: string, fields: Record<string, unknown>): void {
  const payload = JSON.stringify({ level, component, message, ...fields });
  if (level === 'error') {
    console.error(payload);
    return;
  }

  console.info(payload);
}
