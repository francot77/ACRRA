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

export type SendIncidentReportsResult = Readonly<{
  status: 'sent' | 'skipped' | 'failed';
  deliveredIncidentIds: number[];
}>;

export type IncidentReportMessage = DiscordWebhookMessage;

type IncidentReportDelivery = Readonly<{
  primaryMessage: IncidentReportMessage;
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
    });
    const result = await postDiscordWebhook(input.webhookUrl, delivery.primaryMessage, {
      disabledLogMessage: 'Incident webhook disabled, skipping incident report',
      successLogMessage: 'Sent Discord incident report'
    });

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

export function createIncidentReportDelivery(input: {
  fileName: string;
  race: ParsedRace;
  liveIncident: PersistedLiveIncident;
  jsonIncident: JsonRaceIncident;
  match: MatchedIncidentPair;
}): IncidentReportDelivery {
  return { primaryMessage: buildIncidentReportMessage(input) };
}

export function buildIncidentReportMessage(input: {
  fileName: string;
  race: ParsedRace;
  liveIncident: PersistedLiveIncident;
  jsonIncident: JsonRaceIncident;
  match: MatchedIncidentPair;
}): IncidentReportMessage {
  const title = `🟠 Incidente para revisar - ${input.race.trackName}`;
  const incidentType = input.liveIncident.type === 'collision_with_car' ? 'Posible toque entre autos' : 'Posible toque con entorno';
  const involvedDrivers = formatInvolvedDrivers(input.race, input.jsonIncident, input.liveIncident);
  const snapshotCounts = getSnapshotCounts(input.liveIncident);
  const hasSnapshots = snapshotCounts.total > 0;
  const confidenceLabel = hasSnapshots ? formatConfidenceLabel(input.liveIncident.verdictConfidence) : 'baja';
  const reviewSummary = [
    `Lectura inicial: ${hasSnapshots ? formatVerdictLabel(input.liveIncident.verdictType) : 'sin lectura clara todavía'}`,
    formatResponsibilityLine(input.race, input.liveIncident, hasSnapshots),
    `Confianza del sistema: ${confidenceLabel}`
  ].join('\n');
  const impactSummary = [
    `Impacto estimado: ${input.liveIncident.impactSpeed.toFixed(1)} km/h`,
    `Diferencia live vs JSON: ${input.match.impactDiffKmh.toFixed(1)} km/h`,
    `Separación live vs JSON: ${input.match.distanceM.toFixed(1)} m`
  ].join('\n');
  const replayHint = [
    `Evento JSON: #${input.jsonIncident.eventIndex}`,
    `Hora de captura live: ${formatUtcTimeRange(input.liveIncident.firstReceivedAt, input.liveIncident.lastReceivedAt)}`,
    'Ventana sugerida: revisar unos segundos alrededor de ese momento'
  ].join('\n');
  const reason = hasSnapshots
    ? formatHumanReason(input.liveIncident.verdictType, input.liveIncident.verdictExplanation)
    : 'Faltan snapshots alrededor del toque, así que conviene revisar el replay sin tomar esto como una conclusión.';
  const invitation = createInvitation(input.race, input.liveIncident, hasSnapshots);

  return {
    title,
    summaryText: [
      title,
      incidentType,
      `Pilotos involucrados: ${involvedDrivers}`,
      `Impacto:\n${impactSummary}`,
      `Pista de replay:\n${replayHint}`,
      `Lectura inicial:\n${reviewSummary}`,
      `Motivo breve:\n${reason}`,
      `Revisión en comunidad:\n${invitation}`
    ].join('\n\n'),
    webhookBody: {
      content: `${title} · ${involvedDrivers}`,
      embeds: [
        {
          title,
          description: [incidentType, `Pilotos involucrados: ${involvedDrivers}`].join('\n'),
          color: 0xf5a623,
          fields: [
            { name: 'Qué revisar', value: reviewSummary, inline: false },
            { name: 'Impacto', value: impactSummary, inline: false },
            { name: 'Pista de replay', value: replayHint, inline: false },
            { name: 'Motivo breve', value: reason, inline: false },
            { name: 'Revisémoslo juntos', value: invitation, inline: false }
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
      return 'posible toque por alcance';
    case 'possible_divebomb':
      return 'posible divebomb';
    case 'possible_squeeze':
      return 'posible cierre lateral';
    case 'possible_unsafe_rejoin':
      return 'posible reingreso inseguro';
    case 'racing_incident':
      return 'incidente de carrera probable';
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

function formatResponsibilityLine(
  race: ParsedRace,
  incident: PersistedLiveIncident,
  hasSnapshots: boolean
): string {
  if (!hasSnapshots) {
    return 'Responsabilidad a revisar: sin base suficiente todavía';
  }

  const blamedDriver = resolveDriverName(race, incident.verdictBlamedCarId);
  const blamedLabel = blamedDriver
    ? `${blamedDriver} (#${incident.verdictBlamedCarId})`
    : 'sin asignación clara';

  if ((incident.verdictConfidence ?? 0) >= 0.9 && blamedDriver) {
    return `Responsabilidad probable: ${blamedLabel}`;
  }

  return `Responsabilidad a revisar: ${blamedLabel}`;
}

function formatHumanReason(verdictType: PersistedLiveIncident['verdictType'], explanation: string[]): string {
  const verdictReason = (() => {
    switch (verdictType) {
      case 'possible_rear_end':
        return 'Se ve un cierre desde atrás en el momento del contacto.';
      case 'possible_divebomb':
        return 'Se ve una entrada tardía a la curva en la maniobra.';
      case 'possible_squeeze':
        return 'Se ve poco espacio lateral entre los autos.';
      case 'possible_unsafe_rejoin':
        return 'Se ve un reingreso con tráfico cerca.';
      case 'racing_incident':
        return 'Los autos llegan muy juntos y la maniobra no queda clara a simple vista.';
      case 'environment_crash':
        return 'El auto termina contra el entorno después de perder la línea.';
      default:
        return 'La señal disponible no alcanza para una lectura firme.';
    }
  })();

  const firstExplanation = explanation[0]?.trim();
  if (!firstExplanation) {
    return verdictReason;
  }

  return `${verdictReason} ${simplifyExplanation(firstExplanation)}`;
}

function simplifyExplanation(explanation: string): string {
  const normalized = explanation
    .replace(/^telemetry suggests/i, 'La lectura inicial sugiere')
    .replace(/closing speed from behind/gi, 'un cierre desde atrás')
    .replace(/^no strong overlap/i, 'No se ve una superposición clara')
    .replace(/before contact/gi, 'antes del contacto')
    .replace(/^the car left the racing surface/i, 'El auto sale de la línea de carrera')
    .replace(/before impact/gi, 'antes del impacto')
    .replace(/\.$/, '');

  return normalized.endsWith('.') ? normalized : `${normalized}.`;
}

function createInvitation(race: ParsedRace, incident: PersistedLiveIncident, hasSnapshots: boolean): string {
  const blamedDriver = resolveDriverName(race, incident.verdictBlamedCarId);

  if (hasSnapshots && blamedDriver && (incident.verdictConfidence ?? 0) >= 0.9) {
    return `El sistema ve una señal bastante fuerte sobre ${blamedDriver}, pero igual conviene revisarlo entre todos antes de cerrar una conclusión.`;
  }

  return 'Tomalo como una alerta para mirar el replay juntos y discutirla en comunidad, no como un juicio automático.';
}

function formatUtcTimeRange(startIso: string, endIso: string): string {
  const start = formatUtcTime(startIso);
  const end = formatUtcTime(endIso);
  return start === end ? start : `${start} a ${end}`;
}

function formatUtcTime(iso: string): string {
  return `${new Date(iso).toISOString().slice(11, 19)} UTC`;
}

function log(message: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ level: 'info', component: 'discord-incidents', message, ...fields }));
}
