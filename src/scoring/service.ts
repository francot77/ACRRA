import { buildStandingsMessage, type StandingsReport } from '../discord/buildStandingsMessage';
import { sendStandingsWebhook } from '../discord/sendStandingsWebhook';
import type { ValidatedRaceSource } from './acsmAdapter';
import { calculateAwards } from './calculatePoints';
import { ScoringStore } from './store';
import type { FinishResult } from './types';

export type DeliveryState = 'pending' | 'sent' | 'failed-retryable';

export type ScoringRunResult = Readonly<{
  raceId: string;
  runId: string;
  reportId: string;
  committed: 'inserted' | 'duplicate';
  delivery: DeliveryState;
}>;

export class ScoringRunService {
  constructor(
    private readonly store: ScoringStore,
    private readonly webhookUrl: string,
    private readonly deliver: (url: string, report: StandingsReport) => Promise<'sent' | 'logged' | 'failed'> = sendStandingsWebhook
  ) {}

  async process(slotKey: string, source: ValidatedRaceSource): Promise<ScoringRunResult> {
    const raceId = `race:${source.fileName}:${source.fileHash}`;
    const runId = `run:${slotKey}:${source.fileHash}`;
    const results = source.race.drivers.map<FinishResult>((driver) => ({
      driverName: driver.name,
      driverGuid: driver.guid,
      position: driver.position,
      classified: driver.totalTime > 0
    }));
    const calculated = calculateAwards(results);
    const awards = calculated.map((result) => {
      const identity = this.store.identities.resolve(result.driverName, result.driverGuid);
      return { driverId: identity.id, driverName: identity.displayName, position: result.position, points: result.points };
    }).filter((award) => award.points > 0);
    const reportId = `report:${raceId}:${runId}`;
    const report = buildStandingsMessage({ reportId, raceId, runId, rows: awards });
    const committed = this.store.commitAwardsAndQueue({ raceId, runId, results }, awards, report);
    const delivery = await this.deliverOutbox(reportId);
    return { raceId, runId, reportId, committed, delivery };
  }

  async retry(reportId: string): Promise<DeliveryState> {
    return this.deliverOutbox(reportId);
  }

  private async deliverOutbox(reportId: string): Promise<DeliveryState> {
    const entry = this.store.getReport(reportId);
    if (!entry) throw new Error(`Scoring report ${reportId} was not found`);
    if (entry.status === 'sent') return 'sent';
    const report = JSON.parse(entry.payloadJson) as StandingsReport;
    const result = await this.deliver(this.webhookUrl, report);
    if (result === 'sent') {
      this.store.markReportSent(reportId);
      return 'sent';
    }
    this.store.markReportFailed(reportId, result === 'logged' ? 'Dedicated scoring results webhook is not configured' : 'Discord delivery failed');
    return 'failed-retryable';
  }
}
