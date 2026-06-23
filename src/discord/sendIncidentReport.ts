import type { PersistedLiveIncident } from '../db/repositories';
import type { JsonRaceIncident, MatchedIncidentPair } from '../live/matchLiveIncidents';
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
};

export type IncidentReportMessage = DiscordWebhookMessage;

export async function sendIncidentReports(input: SendIncidentReportsInput): Promise<'sent' | 'skipped' | 'failed'> {
  if (!input.enabled) {
    log('Incident webhook disabled by config', { fileName: input.fileName, incidents: input.incidents.length });
    return 'skipped';
  }

  if (!input.webhookUrl.trim()) {
    log('Incident webhook URL empty, skipping incident reports', { fileName: input.fileName, incidents: input.incidents.length });
    return 'skipped';
  }

  if (input.incidents.length === 0) {
    return 'skipped';
  }

  let hadFailure = false;

  for (const incident of input.incidents) {
    const message = buildIncidentReportMessage({
      fileName: input.fileName,
      race: input.race,
      liveIncident: incident.liveIncident,
      jsonIncident: incident.jsonIncident,
      match: incident.match
    });
    const result = await postDiscordWebhook(input.webhookUrl, message, {
      disabledLogMessage: 'Incident webhook disabled, skipping incident report',
      successLogMessage: 'Sent Discord incident report'
    });

    if (result === 'failed') {
      hadFailure = true;
    }
  }

  return hadFailure ? 'failed' : 'sent';
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
  const blamedDriver = resolveDriverName(input.race, input.liveIncident.verdictBlamedCarId);
  const verdictLabel = formatVerdictLabel(input.liveIncident.verdictType);
  const confidenceLabel = formatConfidenceLabel(input.liveIncident.verdictConfidence);
  const snapshotCounts = getSnapshotCounts(input.liveIncident);
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
    `Responsabilidad probable: ${blamedDriver ?? 'sin asignación clara'}`
  ].join('\n');
  const explanation = formatExplanation(input.liveIncident.verdictExplanation);
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
  const post = incident.snapshots.filter((snapshot) => snapshot.relativeMs >= 0).length;
  return { pre, post, total: incident.snapshots.length };
}

function formatExplanation(explanation: string[]): string {
  if (explanation.length === 0) {
    return '- Sin notas adicionales del asistente';
  }

  return explanation.map((entry) => `- ${entry}`).join('\n');
}

function log(message: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ level: 'info', component: 'discord-incidents', message, ...fields }));
}
