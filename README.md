# AC Race Monitor MVP

Worker Dockerizado que escanea exports de Assetto Corsa `*RACE*.json`, persiste resultados y safety en SQLite, y envía un resumen final a Discord. Si `DISCORD_WEBHOOK_URL` está vacío, registra el mismo reporte en consola y sigue corriendo.

## Quick Path

### Local run

```bash
cp .env.example .env
npm install
npm run dev
```

### Sample test

```bash
cp /path/to/RACE.json ./samples/results/
```

### Docker local

```bash
docker compose up --build
```

### Oracle deploy

```bash
sudo mkdir -p /opt/ac-race-monitor/data
sudo mkdir -p /opt/assetto/server/results
git clone <repo> /opt/ac-race-monitor
cd /opt/ac-race-monitor
cp .env.example .env
nano .env
docker compose -f docker-compose.oracle.yml up -d --build
docker logs -f ac-race-monitor
```

### Oracle env edits

```dotenv
HOST_ASSETTO_RESULTS_DIR=/ruta/real/del/acServer/results
HOST_MONITOR_DATA_DIR=/opt/ac-race-monitor/data
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

## Runtime Contract

| Variable | Default | Uso |
|---|---|---|
| `RESULTS_DIR` | `/app/results` | Directorio observado para `*RACE*.json`. |
| `DATABASE_PATH` | `/app/data/ac-race-monitor.sqlite` | SQLite persistente. |
| `DATABASE_ARCHIVE_DIR` | empty | Destination for verified timestamped incident archives; empty means beside the database. |
| `DISCORD_WEBHOOK_URL` | empty | Si está vacío, hace fallback a consola. |
| `PROCESSED_FILE_STRATEGY` | `sqlite` | Dedupe por `processed_files`. |
| `SCAN_ON_START` | `true` | Reprocesa la carpeta al arrancar con las mismas reglas de estabilidad. |
| `MIN_FILE_AGE_MS` | `3000` | Espera mínima antes de parsear. |
| `WATCH_GLOB` | `*RACE*.json` | Filtro de archivos observados. |
| `DEFAULT_SAFETY_RATING` | `75` | Safety inicial para GUIDs nuevos. |
| `SAFETY_MEMORY_FACTOR` | `0.85` | Memoria histórica de safety. |
| `MIN_ACTIVE_DRIVERS_FOR_SAFETY_GAIN` | `3` | Mínimo de pilotos activos para que la carrera puntúe safety. |
| `NUCLEAR_MISSILE_MIN_CAR_IMPACT_KMH` | `100` | Umbral mínimo de impacto auto vs auto para `💥 Misil nuclear`. |
| `NODE_ENV` | `production` | Modo runtime. |
| `HOST_ASSETTO_RESULTS_DIR` | `/opt/assetto/server/results` | Host path para Compose. |
| `HOST_MONITOR_DATA_DIR` | `/opt/ac-race-monitor/data` | Host path para SQLite persistente. |

### Phase-1 authority and deprecated settings

Only stable filenames matching `*RACE*.json` are race authority. Each filename
is parsed after the stability gate, persisted transactionally, and reported at
most once through `processed_files`. Duplicate filenames are skipped; invalid
JSON, malformed sessions, and non-`RACE` sessions are rejected or skipped with
an actionable log and never create partial race state.

The following settings are deprecated compatibility inputs: `LIVE_UDP_ENABLED`,
`LIVE_UDP_DEBUG`, `INCIDENTS_WEBHOOK_ENABLED`,
`INCIDENTS_DISCORD_WEBHOOK_URL`, `AC_UDP_SERVER_HOST`,
`AC_UDP_SERVER_PLUGIN_PORT`, `AC_UDP_PLUGIN_LISTEN_PORT`,
`REALTIME_REPORT_INTERVAL_MS`, `SNAPSHOT_RING_BUFFER_MS`, `INCIDENT_PRE_MS`,
`INCIDENT_POST_MS`, `INCIDENT_DEBUG`, `INCIDENT_MATCH_MAX_DISTANCE_M`, and
`INCIDENT_MATCH_MAX_IMPACT_DIFF_KMH`. They are accepted for compatibility,
reported as deprecated, and ignored. Startup does not open UDP, perform live
matching, write live incidents, or persist heuristic verdicts.

## Local Run

```bash
cp .env.example .env
npm install
npm run dev
```

Para probar un archivo manualmente, copiá un `RACE.json` dentro de `./samples/results/`:

```bash
cp /path/to/RACE.json ./samples/results/
```

Para reiniciar limpio entre pruebas, borrá `data/*.sqlite`.

## Oracle Compose

```bash
sudo mkdir -p /opt/ac-race-monitor/data
sudo mkdir -p /opt/assetto/server/results
git clone <repo> /opt/ac-race-monitor
cd /opt/ac-race-monitor
cp .env.example .env
nano .env
docker compose -f docker-compose.oracle.yml up -d --build
docker logs -f ac-race-monitor
```

Editá `.env` con este bloque:

```dotenv
HOST_ASSETTO_RESULTS_DIR=/ruta/real/del/acServer/results
HOST_MONITOR_DATA_DIR=/opt/ac-race-monitor/data
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

## Verification Commands

| Check | Command |
|---|---|
| Typecheck | `npm run typecheck` |
| Build | `npm run build` |
| Sample replay with console fallback | ``$env:RESULTS_DIR='./samples/results'; $env:DATABASE_PATH='./data/local.sqlite'; $env:DISCORD_WEBHOOK_URL=''; node dist/index.js`` |
| Duplicate replay | Run the previous command twice and confirm `Skipping already processed file`. |
| Non-RACE skip | Confirm the `QUALIFY` sample never persists and logs `Skipping file because json.Type is not RACE`. |

## Expected MVP Behavior

- Procesa solo sesiones `RACE` después del gate de estabilidad.
- No persiste pilotos sin GUID ni en `drivers` ni en `race_driver_results`.
- Envía exactamente un resumen por carrera persistida.
- Evita doble persistencia y doble notificación cuando el archivo ya existe en `processed_files`.

## Safety-v1 and Discord Event Basis

The current safety behavior is frozen as `safety-v1`. It calculates
`clamp(100 - 10*groupedCarContacts - 6*environmentHits - 2*cuts - impactThresholds - 15*destructiveDnf + 5*finished + 5*finishedWithoutEnvironmentHit, 0, 100)`, with impact deductions of 10, 20, and 35 above 60, 120, and 200 km/h. Historical ratings continue to use the existing `0.85` memory factor and are not recomputed.

The general Discord race report uses basis `normalized-json-events-v1`: its incident counts, grouped car contacts, environment hits, and awards come from the parser's normalized `ParsedRace.events` for active result cars. Live or heuristic incident records are not report inputs.

Safety derivation requires every declared `safety-v1` input. Missing, non-finite,
or unsupported input types fail visibly with an error; they never become a
silent zero or an implicitly changed score. Missing JSON `Events` is the one
documented normalization: it becomes an empty event list, while malformed
required session fields remain rejected.

## SQLite schema and migration contract

Fresh databases use schema version 2 and contain only `schema_migrations`,
`processed_files`, `drivers`, `races`, and `race_driver_results`. Existing
databases are backed up before migration (including SQLite `-wal`/`-shm`
sidecars), integrity-checked, then migrated transactionally. Migration 1 adds
legacy verdict columns when needed; migration 2 writes and verifies the
`acrra-incident-archive-v1` export before dropping legacy incident tables and
indexes. A failed archive or verification rolls back before deletion, and a
completed migration is idempotent.

## Incident archive and restore contract

During the first startup against an existing database, migration 2 writes a verified, timestamped `acrra-incident-archive-*.json` file to `DATABASE_ARCHIVE_DIR` (or beside `DATABASE_PATH` when unset). The export contains the complete `live_incidents` and `live_incident_snapshots` rows, including historical heuristic-verdict columns, plus a SHA-256 payload hash. The file is atomically written and verified before the legacy tables and indexes are removed. Empty fresh databases produce an empty archive as well.

The archive is an operator-owned export, not a live database. Preserve it with
the normal deployment backup process. To inspect or restore historical
incident data, validate the payload hash and import the two arrays into a
separate, stopped SQLite database using the pre-migration schema; never restore
those tables into the active runtime database. Race, result, driver, safety,
and processed-file data remain active.
