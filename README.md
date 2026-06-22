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
| `DISCORD_WEBHOOK_URL` | empty | Si está vacío, hace fallback a consola. |
| `PROCESSED_FILE_STRATEGY` | `sqlite` | Dedupe por `processed_files`. |
| `SCAN_ON_START` | `true` | Reprocesa la carpeta al arrancar con las mismas reglas de estabilidad. |
| `MIN_FILE_AGE_MS` | `3000` | Espera mínima antes de parsear. |
| `WATCH_GLOB` | `*RACE*.json` | Filtro de archivos observados. |
| `DEFAULT_SAFETY_RATING` | `75` | Safety inicial para GUIDs nuevos. |
| `SAFETY_MEMORY_FACTOR` | `0.85` | Memoria histórica de safety. |
| `NODE_ENV` | `production` | Modo runtime. |
| `HOST_ASSETTO_RESULTS_DIR` | `/opt/assetto/server/results` | Host path para Compose. |
| `HOST_MONITOR_DATA_DIR` | `/opt/ac-race-monitor/data` | Host path para SQLite persistente. |

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
