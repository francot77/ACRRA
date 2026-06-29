import type { PersistedLiveIncident } from '../db/repositories';
import type { JsonRaceIncident, MatchedIncidentPair } from '../live/matchLiveIncidents';
import { buildIncidentReconstruction } from '../reconstruction/buildIncidentReconstruction';
import { createIncidentArtifacts } from '../reconstruction/createIncidentArtifacts';
import type { ReconstructionTrackContextInput } from '../reconstruction/reconstructionTypes';
import type { IncidentReconstructionDeliveryState, IncidentVisualArtifacts } from '../reconstruction/reconstructionTypes';
import type { ParsedRace } from '../types/assetto';
import { postDiscordWebhook, type DiscordWebhookMessage } from './sendWebhook';

type IncidentReportEntry = {
  liveIncident: PersistedLiveIncident;
  jsonIncident: JsonRaceIncident;
  match: MatchedIncidentPair;
};

type SendIncidentReportsInput = {
  enabled: boolean;
  webhookUrl: string;
  fileName: string;
  race: ParsedRace;
  incidents: IncidentReportEntry[];
  reconstructionTrackContext?: ReconstructionTrackContextInput;
};

export type SendIncidentReportsResult = Readonly<{
  status: 'sent' | 'skipped' | 'failed';
  deliveredIncidentIds: number[];
}>;

export type IncidentReportMessage = DiscordWebhookMessage;

type IncidentVisualStatus = Readonly<{
  delivery: IncidentReconstructionDeliveryState;
  frameCount: number;
  attachmentIncluded: boolean;
  notes: readonly string[];
}>;

type IncidentReportDelivery = Readonly<{
  primaryMessage: IncidentReportMessage;
  fallbackMessage?: IncidentReportMessage;
}>;

type IncidentReportDeliveryDependencies = Readonly<{
  buildScene?: typeof buildIncidentReconstruction;
  buildArtifacts?: typeof createIncidentArtifacts;
}>;

export async function sendIncidentReports(input: SendIncidentReportsInput): Promise<SendIncidentReportsResult> {
  if (!input.enabled) {
    log('Incident webhook disabled by config', { fileName: input.fileName, incidents: input.incidents.length });
    return { status: 'skipped', deliveredIncidentIds: [] };
  }

  if (!input.webhookUrl.trim()) {
    log('Incident webhook URL empty, skipping incident reports', { fileName: input.fileName, incidents: input.incidents.length });
    return { status: 'skipped', deliveredIncidentIds: [] };
  }

  const reportableIncidents = input.incidents.filter(isReportableIncident);

  if (reportableIncidents.length === 0) {
    return { status: 'skipped', deliveredIncidentIds: [] };
  }

  let hadFailure = false;
  const deliveredIncidentIds: number[] = [];

  for (const incident of reportableIncidents) {
    const delivery = createIncidentReportDelivery({
      fileName: input.fileName,
      race: input.race,
      liveIncident: incident.liveIncident,
      jsonIncident: incident.jsonIncident,
      match: incident.match,
      reconstructionTrackContext: input.reconstructionTrackContext,
    });
    let result = await postDiscordWebhook(input.webhookUrl, delivery.primaryMessage, {
      disabledLogMessage: 'Incident webhook disabled, skipping incident report',
      successLogMessage: 'Sent Discord incident report'
    });

    if (result === 'failed' && delivery.fallbackMessage) {
      log('Incident visual attachment failed, retrying text-only incident report', {
        fileName: input.fileName,
        incidentUid: incident.liveIncident.incidentUid,
      });
      result = await postDiscordWebhook(input.webhookUrl, delivery.fallbackMessage, {
        disabledLogMessage: 'Incident webhook disabled, skipping incident report',
        successLogMessage: 'Sent Discord incident report after visual fallback'
      });
    }

    if (result === 'failed') {
      hadFailure = true;
      continue;
    }

    deliveredIncidentIds.push(incident.liveIncident.id);
  }

  return {
    status: hadFailure ? 'failed' : 'sent',
    deliveredIncidentIds,
  };
}

function isReportableIncident(incident: IncidentReportEntry): boolean {
  return incident.liveIncident.type === 'collision_with_car';
}

export function createIncidentReportDelivery(
  input: {
    fileName: string;
    race: ParsedRace;
    liveIncident: PersistedLiveIncident;
    jsonIncident: JsonRaceIncident;
    match: MatchedIncidentPair;
    reconstructionTrackContext?: ReconstructionTrackContextInput;
  },
  dependencies: IncidentReportDeliveryDependencies = {}
): IncidentReportDelivery {
  const baseMessage = buildIncidentReportMessage(input);
  const buildScene = dependencies.buildScene ?? buildIncidentReconstruction;
  const buildArtifacts = dependencies.buildArtifacts ?? createIncidentArtifacts;

  if (!input.reconstructionTrackContext) {
    return { primaryMessage: baseMessage };
  }

  try {
    const scene = buildScene({
      incident: input.liveIncident,
      trackContextInput: input.reconstructionTrackContext,
    });
    const artifacts = buildArtifacts({ scene });
    const primaryStatus = createVisualStatus(artifacts, Boolean(artifacts.animationGif));

    if (!artifacts.animationGif) {
      return {
        primaryMessage: appendVisualStatus(baseMessage, primaryStatus),
      };
    }

    return {
      primaryMessage: appendVisualStatus(
        {
          ...baseMessage,
          attachments: Object.freeze([artifacts.animationGif]),
        },
        primaryStatus
      ),
      fallbackMessage: appendVisualStatus(
        baseMessage,
        Object.freeze({
          delivery: 'omitted',
          frameCount: artifacts.frames.length,
          attachmentIncluded: false,
          notes: Object.freeze([
            ...artifacts.notes,
            'incident.gif upload failed, so the report was sent without a visual attachment',
          ]),
        })
      ),
    };
  } catch (error) {
    return {
      primaryMessage: appendVisualStatus(
        baseMessage,
        Object.freeze({
          delivery: 'omitted',
          frameCount: 0,
          attachmentIncluded: false,
          notes: Object.freeze([
            `Visual reconstruction omitted after build failure: ${error instanceof Error ? error.message : String(error)}`,
          ]),
        })
      ),
    };
  }
}

export function buildIncidentReportMessage(input: {
  fileName: string;
  race: ParsedRace;
  liveIncident: PersistedLiveIncident;
  jsonIncident: JsonRaceIncident;
  match: MatchedIncidentPair;
}): IncidentReportMessage {
  const title = `📎 Reporte de incidente - ${input.race.trackName}`;
  const incidentType = input.liveIncident.type === 'collision_with_car' ? 'Auto vs auto' : 'Auto vs entorno';
  const involvedDrivers = formatInvolvedDrivers(input.race, input.jsonIncident, input.liveIncident);
  const snapshotCounts = getSnapshotCounts(input.liveIncident);
  const hasSnapshots = snapshotCounts.total > 0;
  const blamedDriver = hasSnapshots ? resolveDriverName(input.race, input.liveIncident.verdictBlamedCarId) : null;
  const verdictLabel = hasSnapshots ? formatVerdictLabel(input.liveIncident.verdictType) : 'no evaluada';
  const confidenceLabel = hasSnapshots ? formatConfidenceLabel(input.liveIncident.verdictConfidence) : 'baja';
  const impactSummary = [
    `Impacto live: ${input.liveIncident.impactSpeed.toFixed(1)} km/h`,
    `Diferencia contra JSON: ${input.match.impactDiffKmh.toFixed(1)} km/h`,
    `Distancia live/json: ${input.match.distanceM.toFixed(1)} m`
  ].join('\n');
  const matchContext = [
    `Archivo: ${input.fileName}`,
    `Evento JSON: #${input.jsonIncident.eventIndex}`,
    `Captura: ${new Date(input.liveIncident.firstReceivedAt).toISOString()} -> ${new Date(input.liveIncident.lastReceivedAt).toISOString()}`
  ].join('\n');
  const assistantSummary = [
    `Veredicto sugerido: ${verdictLabel}`,
    `Confianza: ${confidenceLabel}`,
    `Responsabilidad probable: ${blamedDriver ?? (hasSnapshots ? 'sin asignación clara' : 'sin base suficiente')}`
  ].join('\n');
  const explanation = formatExplanation(
    hasSnapshots
      ? input.liveIncident.verdictExplanation
      : ['Datos insuficientes: no se capturaron snapshots live antes o después del contacto', 'El incidente queda como no evaluado para evitar una conclusión fuerte sobre auto vs entorno o responsabilidad']
  );
  const snapshotSummary = [
    `Snapshots previos: ${snapshotCounts.pre}`,
    `Snapshots posteriores: ${snapshotCounts.post}`,
    `Snapshots totales: ${snapshotCounts.total}`
  ].join('\n');

  return {
    title,
    summaryText: [
      title,
      `Tipo: ${incidentType}`,
      `Involucrados: ${involvedDrivers}`,
      assistantSummary,
      impactSummary,
      `Contexto de match:\n${matchContext}`,
      `Snapshots:\n${snapshotSummary}`,
      `Notas del asistente:\n${explanation}`
    ].join('\n\n'),
    webhookBody: {
      content: `${title} · ${incidentType}`,
      embeds: [
        {
          title,
          description: [`Tipo: ${incidentType}`, `Involucrados: ${involvedDrivers}`].join('\n'),
          color: 0xf5a623,
          fields: [
            { name: 'Asistente', value: assistantSummary, inline: false },
            { name: 'Impacto y match', value: impactSummary, inline: false },
            { name: 'Contexto', value: matchContext, inline: false },
            { name: 'Snapshots', value: snapshotSummary, inline: false },
            { name: 'Notas del asistente', value: explanation, inline: false }
          ],
          footer: { text: `Canal separado de incidentes · ${input.fileName}` }
        }
      ]
    }
  };
}

function formatInvolvedDrivers(race: ParsedRace, incident: JsonRaceIncident, liveIncident: PersistedLiveIncident): string {
  if (incident.type === 'collision_with_car') {
    const primary = incident.driverName ?? resolveDriverName(race, incident.carId) ?? `Auto ${incident.carId}`;
    const secondary = incident.otherDriverName ?? resolveDriverName(race, incident.otherCarId) ?? `Auto ${incident.otherCarId}`;
    return `${primary} (#${incident.carId}) / ${secondary} (#${incident.otherCarId})`;
  }

  const driverName = incident.driverName ?? resolveDriverName(race, liveIncident.carId) ?? `Auto ${liveIncident.carId}`;
  return `${driverName} (#${liveIncident.carId})`;
}

function resolveDriverName(race: ParsedRace, carId: number | null | undefined): string | null {
  if (carId == null) {
    return null;
  }

  return race.drivers.find((driver) => driver.carId === carId)?.name ?? null;
}

function formatVerdictLabel(verdictType: PersistedLiveIncident['verdictType']): string {
  switch (verdictType) {
    case 'possible_rear_end':
      return 'posible choque de atrás';
    case 'possible_divebomb':
      return 'posible divebomb';
    case 'possible_squeeze':
      return 'posible cierre lateral';
    case 'possible_unsafe_rejoin':
      return 'posible reingreso inseguro';
    case 'racing_incident':
      return 'posible incidente de carrera';
    case 'environment_crash':
      return 'posible golpe con entorno';
    default:
      return 'sin señal concluyente';
  }
}

function formatConfidenceLabel(confidence: number | null): string {
  if (confidence == null) {
    return 'baja';
  }

  if (confidence >= 0.8) {
    return 'alta';
  }

  if (confidence >= 0.55) {
    return 'media';
  }

  return 'baja';
}

function getSnapshotCounts(incident: PersistedLiveIncident): { pre: number; post: number; total: number } {
  const pre = incident.snapshots.filter((snapshot) => snapshot.relativeMs < 0).length;
  const post = incident.snapshots.filter((snapshot) => snapshot.relativeMs > 0).length;
  return { pre, post, total: incident.snapshots.length };
}

function formatExplanation(explanation: string[]): string {
  if (explanation.length === 0) {
    return '- Sin notas adicionales del asistente';
  }

  return explanation.map((entry) => `- ${entry}`).join('\n');
}

function createVisualStatus(artifacts: IncidentVisualArtifacts, attachmentIncluded: boolean): IncidentVisualStatus {
  return Object.freeze({
    delivery: artifacts.delivery,
    frameCount: artifacts.frames.length,
    attachmentIncluded,
    notes: Object.freeze([...artifacts.notes]),
  });
}

function appendVisualStatus(message: IncidentReportMessage, status: IncidentVisualStatus): IncidentReportMessage {
  const visualSummary = formatVisualStatus(status);
  const embed = message.webhookBody.embeds[0];
  const embeds = embed
    ? [
        {
          ...embed,
          fields: [...embed.fields, { name: 'Reconstrucción visual', value: visualSummary, inline: false }],
        },
        ...message.webhookBody.embeds.slice(1),
      ]
    : message.webhookBody.embeds;

  return {
    ...message,
    summaryText: `${message.summaryText}\n\nReconstrucción visual:\n${visualSummary}`,
    webhookBody: {
      ...message.webhookBody,
      embeds,
    },
  };
}

function formatVisualStatus(status: IncidentVisualStatus): string {
  const lines = [
    `Estado: ${status.delivery}`,
    `Frames: ${status.frameCount}`,
    `Adjunto GIF: ${status.attachmentIncluded ? 'sí' : 'no'}`,
  ];

  if (status.notes.length > 0) {
    lines.push(`Notas:\n${status.notes.map((note) => `- ${note}`).join('\n')}`);
  }

  return lines.join('\n');
}

function log(message: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ level: 'info', component: 'discord-incidents', message, ...fields }));
}
