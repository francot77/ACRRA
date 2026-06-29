import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRaceMessage } from '../src/discord/buildRaceMessage';
import { postDiscordWebhook, sendWebhook } from '../src/discord/sendWebhook';
import { DriverRaceStats, GroupedIncident, ParsedRace } from '../src/types/assetto';

function createRace(): ParsedRace {
  return {
    sourceFileName: 'sample-race.json',
    trackName: 'monza',
    trackConfig: '',
    type: 'RACE',
    raceLaps: 3,
    carModel: 'lotus_exos_125_s1',
    drivers: [],
    lapsByCarId: new Map(),
    events: []
  };
}

function createStat(overrides: Partial<DriverRaceStats> = {}): DriverRaceStats {
  return {
    carId: overrides.carId ?? 1,
    name: overrides.name ?? 'Guid Driver',
    guid: overrides.guid ?? 'guid-1',
    identity: overrides.identity ?? { kind: 'guid', value: String(overrides.guid ?? 'guid-1') },
    position: overrides.position ?? 1,
    completedLaps: overrides.completedLaps ?? 3,
    raceLaps: overrides.raceLaps ?? 3,
    hasValidResult: overrides.hasValidResult ?? true,
    active: overrides.active ?? true,
    inactive: overrides.inactive ?? false,
    finished: overrides.finished ?? true,
    destructiveDnf: overrides.destructiveDnf ?? false,
    bestLap: overrides.bestLap === undefined ? 90000 : overrides.bestLap,
    avgLap: overrides.avgLap === undefined ? 90500 : overrides.avgLap,
    idealLap: overrides.idealLap === undefined ? 89000 : overrides.idealLap,
    consistency: overrides.consistency === undefined ? 250 : overrides.consistency,
    totalCuts: overrides.totalCuts ?? 0,
    carIncidentsGrouped: overrides.carIncidentsGrouped ?? 0,
    envHits: overrides.envHits ?? 0,
    maxCarImpact: overrides.maxCarImpact ?? 0,
    maxEnvImpact: overrides.maxEnvImpact ?? 0,
    maxImpact: overrides.maxImpact ?? 0,
    rawCollisionEvents: overrides.rawCollisionEvents ?? 0,
    'tyre usado más frecuente': overrides['tyre usado más frecuente'] ?? 'Soft',
    totalTime: overrides.totalTime ?? 300000,
    raceScore: overrides.raceScore ?? 95,
    oldSafetyRating: overrides.oldSafetyRating ?? 75,
    newSafetyRating: overrides.newSafetyRating ?? 78,
    safetyChangeReason: overrides.safetyChangeReason ?? 'updated'
  };
}

function createGroupedIncident(): GroupedIncident {
  return {
    pairKey: '1:2',
    driversInvolved: [
      { carId: 1, name: 'Guid Driver', identity: { kind: 'guid', value: 'guid-1' } },
      { carId: 2, name: 'Rival Driver', identity: { kind: 'guid', value: 'guid-2' } }
    ],
    carIdsInvolved: [1, 2],
    maxImpact: 140,
    avgImpact: 120,
    rawEventCount: 2
  };
}

function getAwardsValue(message: ReturnType<typeof buildRaceMessage>): string {
  return message.webhookBody.embeds[0]?.fields.find((field) => field.name === 'Premios')?.value ?? '';
}

const DEFAULT_NUCLEAR_MISSILE_MIN_CAR_IMPACT_KMH = 100;

type BuildMessageInput = Omit<Parameters<typeof buildRaceMessage>[0], 'nuclearMissileMinCarImpactKmh'> & {
  nuclearMissileMinCarImpactKmh?: number;
};

function buildMessage(input: BuildMessageInput): ReturnType<typeof buildRaceMessage> {
  return buildRaceMessage({
    ...input,
    nuclearMissileMinCarImpactKmh: input.nuclearMissileMinCarImpactKmh ?? DEFAULT_NUCLEAR_MISSILE_MIN_CAR_IMPACT_KMH
  });
}

test('empty webhook falls back to console logging without crashing', async (t) => {
  const infoLogs: string[] = [];
  const originalInfo = console.info;
  console.info = (message?: unknown) => {
    infoLogs.push(String(message));
  };
  t.after(() => {
    console.info = originalInfo;
  });

  const message = buildMessage({
    fileName: 'sample-race.json',
    race: createRace(),
    stats: [createStat()],
    groupedIncidents: [],
    minActiveDriversForSafetyGain: 3
  });

  const result = await sendWebhook('', message);

  assert.equal(result, 'logged');
  assert.equal(infoLogs.length, 1);

  const payload = JSON.parse(infoLogs[0] ?? '{}') as { message?: string; summary?: string };
  assert.equal(payload.message, 'Discord webhook disabled, logging race summary instead');
  assert.match(payload.summary ?? '', /Race Report - monza/);
  assert.match(payload.summary ?? '', /Archivo procesado: sample-race.json/);
});

test('configured webhook sends exactly one request with the required race report contract', async (t) => {
  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const infoLogs: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ input: String(input), init });
    return new Response(null, { status: 200, statusText: 'OK' });
  }) as typeof fetch;
  console.info = (message?: unknown) => {
    infoLogs.push(String(message));
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
  });

  const message = buildMessage({
    fileName: 'sample-race.json',
    race: createRace(),
    stats: [
      createStat(),
      createStat({
        carId: 2,
        name: 'Rival Driver',
        guid: 'guid-2',
        identity: { kind: 'guid', value: 'guid-2' },
        position: 2,
        bestLap: 93000,
        avgLap: 94000,
        idealLap: 92000,
        consistency: 500,
        carIncidentsGrouped: 1,
        envHits: 1,
        maxImpact: 140,
        rawCollisionEvents: 2,
        raceScore: 62,
        oldSafetyRating: 80,
        newSafetyRating: 77.3
      })
    ],
    groupedIncidents: [createGroupedIncident()],
    minActiveDriversForSafetyGain: 3
  });

  const result = await sendWebhook('https://discord.example/webhook', message);

  assert.equal(result, 'sent');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.input, 'https://discord.example/webhook');
  assert.equal(fetchCalls[0]?.init?.method, 'POST');
  assert.equal((fetchCalls[0]?.init?.headers as Record<string, string>)['content-type'], 'application/json');
  assert.equal(infoLogs.length, 1);

  const body = JSON.parse(String(fetchCalls[0]?.init?.body)) as {
    content: string;
    embeds: Array<{
      title: string;
      description: string;
      footer?: { text?: string };
      fields: Array<{ name: string; value: string }>;
    }>;
  };
  const embed = body.embeds[0];
  const fieldNames = embed?.fields.map((field) => field.name) ?? [];
  const awardsField = embed?.fields.find((field) => field.name === 'Premios');

  assert.equal(body.content, '🏁 Race Report - monza');
  assert.equal(embed?.title, '🏁 Race Report - monza');
  assert.match(embed?.description ?? '', /Auto principal: lotus_exos_125_s1/);
  assert.match(embed?.description ?? '', /Vueltas pactadas: 3/);
  assert.equal(embed?.footer?.text, 'Archivo procesado: sample-race.json');
  assert.deepEqual(fieldNames, ['Podio', '⚡ Vuelta rápida', 'Premios', 'Safety', 'Resumen de incidentes']);
  assert.doesNotMatch(awardsField?.value ?? '', /⚡ Vuelta rápida/);
  assert.match(awardsField?.value ?? '', /🧼 Más limpio/);
  assert.match(awardsField?.value ?? '', /🧱 Albañil del día/);
  assert.match(awardsField?.value ?? '', /💥 Misil nuclear/);
  assert.match(awardsField?.value ?? '', /🚜 Cono del día/);
  assert.match(awardsField?.value ?? '', /📈 Más consistente/);
  assert.match(awardsField?.value ?? '', /🐢 Tortuga digna/);
  assert.doesNotMatch(awardsField?.value ?? '', /No aplica/);
});

test('postDiscordWebhook sends multipart form data when attachments are present', async (t) => {
  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ input: String(input), init });
    return new Response(null, { status: 200, statusText: 'OK' });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await postDiscordWebhook(
    'https://discord.example/webhook',
    {
      title: 'Incident visual report',
      summaryText: 'Incident visual report summary',
      webhookBody: {
        content: 'Incident visual report',
        embeds: [
          {
            title: 'Incident visual report',
            description: 'Attachment test',
            color: 0xf5a623,
            fields: [],
            footer: { text: 'footer' },
          },
        ],
      },
      attachments: [
        {
          filename: 'incident.svg',
          contentType: 'image/svg+xml',
          bytes: Buffer.from('<svg></svg>', 'utf8'),
        },
      ],
    },
    {
      disabledLogMessage: 'disabled',
      successLogMessage: 'sent',
    }
  );

  assert.equal(result, 'sent');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.input, 'https://discord.example/webhook');
  assert.equal(fetchCalls[0]?.init?.method, 'POST');
  assert.equal(fetchCalls[0]?.init?.headers, undefined);
  assert.ok(fetchCalls[0]?.init?.body instanceof FormData);

  const form = fetchCalls[0]?.init?.body as FormData;
  assert.equal(form.get('payload_json'), JSON.stringify({
    content: 'Incident visual report',
    embeds: [
      {
        title: 'Incident visual report',
        description: 'Attachment test',
        color: 0xf5a623,
        fields: [],
        footer: { text: 'footer' },
      },
    ],
  }));

  const attachment = form.get('files[0]');
  assert.ok(attachment instanceof File);
  assert.equal(attachment?.name, 'incident.svg');
  assert.equal(attachment?.type, 'image/svg+xml');
  assert.equal(await attachment?.text(), '<svg></svg>');
});

test('report excludes DNS from awards, marks DNF and DNS, and formats impacts without raw milliseconds', () => {
  const message = buildMessage({
    fileName: 'sample-race.json',
    race: createRace(),
    stats: [
      createStat(),
      createStat({
        carId: 2,
        name: 'DNS Driver',
        guid: 'guid-2',
        identity: { kind: 'guid', value: 'guid-2' },
        position: 2,
        completedLaps: 0,
        hasValidResult: false,
        active: false,
        inactive: true,
        finished: false,
        bestLap: null,
        avgLap: null,
        idealLap: null,
        consistency: null,
        totalTime: 0,
        raceScore: 0,
        oldSafetyRating: 88,
        newSafetyRating: 88,
        safetyChangeReason: 'inactive'
      }),
      createStat({
        carId: 3,
        name: 'Crash Driver',
        guid: 'guid-3',
        identity: { kind: 'guid', value: 'guid-3' },
        position: 3,
        completedLaps: 0,
        hasValidResult: false,
        active: true,
        inactive: false,
        finished: false,
        destructiveDnf: true,
        bestLap: null,
        avgLap: null,
        idealLap: null,
        consistency: null,
        envHits: 1,
        maxCarImpact: 140,
        maxEnvImpact: 70,
        maxImpact: 140,
        rawCollisionEvents: 3,
        totalTime: 0,
        raceScore: 59,
        oldSafetyRating: 80,
        newSafetyRating: 76.85,
        safetyChangeReason: 'updated'
      }),
      createStat({
        carId: 4,
        name: 'Active Three',
        guid: 'guid-4',
        identity: { kind: 'guid', value: 'guid-4' },
        position: 4,
        finished: false,
        completedLaps: 1,
        hasValidResult: false,
        bestLap: null,
        avgLap: null,
        idealLap: null,
        consistency: null,
        totalTime: 0,
        oldSafetyRating: 77,
        newSafetyRating: 79,
        safetyChangeReason: 'updated'
      })
    ],
    groupedIncidents: [createGroupedIncident()],
    minActiveDriversForSafetyGain: 3
  });

  const embed = message.webhookBody.embeds[0];
  const awardsField = embed.fields.find((field) => field.name === 'Premios');
  const podiumField = embed.fields.find((field) => field.name === 'Podio');
  const incidentsField = embed.fields.find((field) => field.name === 'Resumen de incidentes');

  const safetyField = embed.fields.find((field) => field.name === 'Safety');

  assert.match(podiumField?.value ?? '', /Crash Driver \(DNF 0\/3 vueltas\)/);
  assert.doesNotMatch(podiumField?.value ?? '', /DNS Driver/);
  assert.doesNotMatch(awardsField?.value ?? '', /DNS Driver/);
  assert.match(awardsField?.value ?? '', /Crash Driver \(3 impactos antes de empezar\)/);
  assert.doesNotMatch(awardsField?.value ?? '', /🧼 Más limpio/);
  assert.doesNotMatch(awardsField?.value ?? '', /📈 Más consistente/);
  assert.doesNotMatch(awardsField?.value ?? '', /🐢 Tortuga digna/);
  assert.doesNotMatch(awardsField?.value ?? '', /No aplica/);
  assert.doesNotMatch(awardsField?.value ?? '', /\b\d+(?:\.\d+)? ms\b/);
  assert.doesNotMatch(safetyField?.value ?? '', /DNS Driver/);
  assert.match(safetyField?.value ?? '', /P3 Crash Driver \(DNF 0\/3 vueltas\): 80\.00 -> 76\.85/);
  assert.match(incidentsField?.value ?? '', /Impacto máximo entre autos: 140\.00/);
  assert.match(incidentsField?.value ?? '', /Impacto máximo con entorno: 70\.00/);
  assert.match(incidentsField?.value ?? '', /Impacto máximo total: 140\.00/);
});

test('report explains unchanged safety below the active-driver minimum without placeholder awards', () => {
  const message = buildMessage({
    fileName: 'sample-race.json',
    race: createRace(),
    stats: [
      createStat({
        name: 'Solo Driver',
        bestLap: 91513,
        avgLap: 91513,
        oldSafetyRating: 75,
        newSafetyRating: 75,
        safetyChangeReason: 'not-eligible'
      }),
      createStat({
        carId: 2,
        name: 'DNS Driver',
        guid: 'guid-2',
        identity: { kind: 'guid', value: 'guid-2' },
        position: 2,
        completedLaps: 0,
        hasValidResult: false,
        active: false,
        inactive: true,
        finished: false,
        bestLap: null,
        avgLap: null,
        idealLap: null,
        consistency: null,
        totalTime: 0,
        raceScore: 0,
        oldSafetyRating: 88,
        newSafetyRating: 88,
        safetyChangeReason: 'inactive'
      })
    ],
    groupedIncidents: [],
    minActiveDriversForSafetyGain: 3
  });

  const embed = message.webhookBody.embeds[0];
  const awardsField = embed.fields.find((field) => field.name === 'Premios');
  const safetyField = embed.fields.find((field) => field.name === 'Safety');

  assert.equal(awardsField?.value, '');
  assert.doesNotMatch(awardsField?.value ?? '', /⚡ Vuelta rápida|No aplica|Sin datos|Más limpio|Más consistente|Tortuga digna/);
  assert.equal(safetyField?.value, 'No puntuable: 1 pilotos activos. Mínimo requerido: 3.');
});

test('report hides tortuga digna when a single finisher has no real competition', () => {
  const awards = getAwardsValue(
    buildMessage({
      fileName: 'sample-race.json',
      race: createRace(),
      stats: [
        createStat({ name: 'Kanus', bestLap: 91513, avgLap: 91513, raceScore: 100 }),
        createStat({
          carId: 2,
          name: 'ramen',
          guid: 'guid-2',
          identity: { kind: 'guid', value: 'guid-2' },
          position: 2,
          completedLaps: 0,
          hasValidResult: false,
          finished: false,
          destructiveDnf: true,
          envHits: 2,
          maxEnvImpact: 55,
          maxImpact: 55,
          rawCollisionEvents: 3,
          raceScore: 59,
          bestLap: null,
          avgLap: null,
          idealLap: null,
          consistency: null,
          totalTime: 0
        }),
        createStat({
          carId: 3,
          name: 'DNS One',
          guid: 'guid-3',
          identity: { kind: 'guid', value: 'guid-3' },
          position: 3,
          active: false,
          inactive: true,
          finished: false,
          completedLaps: 0,
          hasValidResult: false,
          bestLap: null,
          avgLap: null,
          idealLap: null,
          consistency: null,
          totalTime: 0,
          raceScore: 0,
          safetyChangeReason: 'inactive'
        }),
        createStat({
          carId: 4,
          name: 'DNS Two',
          guid: 'guid-4',
          identity: { kind: 'guid', value: 'guid-4' },
          position: 4,
          active: false,
          inactive: true,
          finished: false,
          completedLaps: 0,
          hasValidResult: false,
          bestLap: null,
          avgLap: null,
          idealLap: null,
          consistency: null,
          totalTime: 0,
          raceScore: 0,
          safetyChangeReason: 'inactive'
        })
      ],
      groupedIncidents: [],
      minActiveDriversForSafetyGain: 3
    })
  );

  assert.doesNotMatch(awards, /🐢 Tortuga digna|🧼 Más limpio|📈 Más consistente|No aplica/);
  assert.doesNotMatch(awards, /⚡ Vuelta rápida/);
  assert.match(awards, /🧱 Albañil del día: ramen \(2 golpes al entorno\)/);
  assert.doesNotMatch(awards, /💥 Misil nuclear/);
  assert.match(awards, /🚜 Cono del día: ramen \(59\.00 puntos\)/);
  assert.match(awards, /🪦 DNF destructivo: ramen \(3 impactos antes de empezar\)/);
});

test('report hides clean and consistent awards without enough finished candidates', () => {
  const awards = getAwardsValue(
    buildMessage({
      fileName: 'sample-race.json',
      race: createRace(),
      stats: [
        createStat({ name: 'Solo Driver', bestLap: 91513, avgLap: 91600, consistency: 100, raceScore: 95 }),
        createStat({
          carId: 2,
          name: 'DNF Driver',
          guid: 'guid-2',
          identity: { kind: 'guid', value: 'guid-2' },
          position: 2,
          finished: false,
          completedLaps: 1,
          consistency: null,
          bestLap: 93000,
          avgLap: 94000,
          raceScore: 79,
          totalTime: 0
        })
      ],
      groupedIncidents: [],
      minActiveDriversForSafetyGain: 3
    })
  );

  assert.doesNotMatch(awards, /🧼 Más limpio|📈 Más consistente|🐢 Tortuga digna|No aplica|Sin datos/);
});

test('report hides tortuga digna when fastest-lap winner is also tortoise and there is no real competition', () => {
  const awards = getAwardsValue(
    buildMessage({
      fileName: 'sample-race.json',
      race: createRace(),
      stats: [
        createStat({ name: 'Solo Pace', bestLap: 90000, avgLap: 95000, raceScore: 96, consistency: 120 }),
        createStat({
          carId: 2,
          name: 'Quick DNF',
          guid: 'guid-2',
          identity: { kind: 'guid', value: 'guid-2' },
          position: 2,
          finished: false,
          completedLaps: 1,
          bestLap: 91000,
          avgLap: 93000,
          consistency: null,
          raceScore: 85,
          totalTime: 0
        })
      ],
      groupedIncidents: [],
      minActiveDriversForSafetyGain: 3
    })
  );

  assert.doesNotMatch(awards, /🐢 Tortuga digna|No aplica|Sin datos/);
});

test('report marks two-active-driver race as no puntuable and omits dns plus old safety sections', () => {
  const message = buildMessage({
    fileName: 'sample-race.json',
    race: createRace(),
    stats: [
      createStat({ name: 'Active One', oldSafetyRating: 75, newSafetyRating: 75, safetyChangeReason: 'not-eligible' }),
      createStat({
        carId: 2,
        name: 'Active Two',
        guid: 'guid-2',
        identity: { kind: 'guid', value: 'guid-2' },
        position: 2,
        finished: false,
        completedLaps: 1,
        oldSafetyRating: 84,
        newSafetyRating: 84,
        safetyChangeReason: 'not-eligible'
      }),
      createStat({
        carId: 3,
        name: 'DNS Driver',
        guid: 'guid-3',
        identity: { kind: 'guid', value: 'guid-3' },
        position: 3,
        active: false,
        inactive: true,
        finished: false,
        completedLaps: 0,
        hasValidResult: false,
        bestLap: null,
        avgLap: null,
        idealLap: null,
        consistency: null,
        totalTime: 0,
        raceScore: 0,
        oldSafetyRating: 91,
        newSafetyRating: 91,
        safetyChangeReason: 'inactive'
      })
    ],
    groupedIncidents: [],
    minActiveDriversForSafetyGain: 3
  });

  const embed = message.webhookBody.embeds[0];
  const podium = embed.fields.find((field) => field.name === 'Podio')?.value ?? '';
  const safety = embed.fields.find((field) => field.name === 'Safety')?.value ?? '';

  assert.match(safety, /No puntuable: 2 pilotos activos\. Mínimo requerido: 3\./);
  assert.doesNotMatch(message.summaryText, /DNS/);
  assert.doesNotMatch(message.summaryText, /Safety actualizada|Safety sin cambios/);
  assert.doesNotMatch(podium, /DNS Driver/);
});

test('env-only impact never renders misil nuclear', () => {
  const awards = getAwardsValue(
    buildMessage({
      fileName: 'sample-race.json',
      race: createRace(),
      stats: [createStat({ name: 'Builder', envHits: 2, maxEnvImpact: 150, maxImpact: 150 })],
      groupedIncidents: [],
      minActiveDriversForSafetyGain: 3
    })
  );

  assert.doesNotMatch(awards, /💥 Misil nuclear/);
});

test('car-to-car impact under threshold does not render misil nuclear', () => {
  const awards = getAwardsValue(
    buildMessage({
      fileName: 'sample-race.json',
      race: createRace(),
      stats: [createStat(), createStat({ carId: 2, name: 'Rival', guid: 'guid-2', identity: { kind: 'guid', value: 'guid-2' }, position: 2 })],
      groupedIncidents: [{ ...createGroupedIncident(), maxImpact: 80, avgImpact: 80 }],
      minActiveDriversForSafetyGain: 3
    })
  );

  assert.doesNotMatch(awards, /💥 Misil nuclear/);
});

test('car-to-car impact over threshold renders misil nuclear', () => {
  const awards = getAwardsValue(
    buildMessage({
      fileName: 'sample-race.json',
      race: createRace(),
      stats: [createStat(), createStat({ carId: 2, name: 'Rival Driver', guid: 'guid-2', identity: { kind: 'guid', value: 'guid-2' }, position: 2 })],
      groupedIncidents: [{ ...createGroupedIncident(), maxImpact: 130, avgImpact: 120 }],
      minActiveDriversForSafetyGain: 3
    })
  );

  assert.match(awards, /💥 Misil nuclear: Guid Driver y Rival Driver \(130\.00 km\/h de impacto\)/);
});
