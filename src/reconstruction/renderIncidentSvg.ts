import type {
  IncidentScene,
  IncidentSceneCar,
  IncidentScenePlacement,
  RenderedIncidentSvg,
} from './reconstructionTypes';

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 520;
const CANVAS_PADDING_X = 52;
const CANVAS_PADDING_Y = 48;
const FOOTER_HEIGHT = 84;

export function renderIncidentSvg(scene: IncidentScene): RenderedIncidentSvg {
  const width = CANVAS_WIDTH;
  const height = CANVAS_HEIGHT;
  const trackTop = CANVAS_PADDING_Y;
  const trackBottom = height - FOOTER_HEIGHT;
  const trackHeight = trackBottom - trackTop;
  const usableWidth = width - (CANVAS_PADDING_X * 2);
  const usableHeight = trackHeight - (CANVAS_PADDING_Y * 2);
  const scaleX = usableWidth / Math.max(scene.corridor.forwardRangeM + scene.corridor.backwardRangeM, 1);
  const scaleY = usableHeight / Math.max(scene.corridor.lateralHalfWidthM * 2.6, 1);
  const centerY = trackTop + (trackHeight / 2);
  const anchorX = projectX(0, scene, scaleX);

  const placedCars = scene.cars
    .map((car) => ({ car, placement: resolveRenderedPlacement(car, scene.anchorRelativeMs) }))
    .sort(compareRenderedCars);
  const missingCars = placedCars.filter((entry): entry is { car: IncidentSceneCar; placement: null } => entry.placement === null).map((entry) => entry.car);
  const visibleCars = placedCars.filter((entry): entry is { car: IncidentSceneCar; placement: IncidentScenePlacement } => entry.placement !== null);

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Incident reconstruction ${escapeXml(scene.incidentUid)}">`,
    '  <defs>',
    '    <style>',
    '      .label { font: 600 13px sans-serif; fill: #f5f7fa; }',
    '      .small { font: 12px sans-serif; fill: #d5d9e0; }',
    '      .muted { fill: #9ba3b4; }',
    '    </style>',
    '  </defs>',
    '  <rect width="100%" height="100%" fill="#0f172a" rx="18" ry="18"/>',
    ...renderTrack(scene, scaleX, scaleY, centerY),
    `  <line x1="${round(anchorX)}" y1="${round(trackTop + CANVAS_PADDING_Y - 16)}" x2="${round(anchorX)}" y2="${round(trackBottom - CANVAS_PADDING_Y + 16)}" stroke="#fbbf24" stroke-width="3" stroke-dasharray="6 4"/>`,
    `  <circle cx="${round(anchorX)}" cy="${round(centerY)}" r="9" fill="#f59e0b" stroke="#fde68a" stroke-width="2"/>`,
    `  <text x="${round(CANVAS_PADDING_X)}" y="${round(28)}" class="label">Incident tactical reconstruction</text>`,
    `  <text x="${round(CANVAS_PADDING_X)}" y="${round(46)}" class="small">Anchor ${scene.anchorCarId == null ? 'unknown' : `car ${scene.anchorCarId}`} · ${escapeXml(scene.corridor.turnSide)} corridor · ${scene.degraded ? 'degraded evidence present' : 'observed evidence only'}</text>`,
    ...scene.cars.flatMap((car) => renderTrail(car, scene, scaleX, scaleY, centerY)),
    ...visibleCars.flatMap(({ car, placement }) => renderCar(car, placement, scene, scaleX, scaleY, centerY)),
    ...renderMissingCars(missingCars, trackBottom),
    `  <text x="${round(CANVAS_PADDING_X)}" y="${round(height - 26)}" class="small">Scene notes: ${escapeXml(scene.notes.length === 0 ? 'none' : scene.notes.join(' | '))}</text>`,
    '</svg>',
  ].join('\n');

  return Object.freeze({ width, height, content: svg });
}

function renderTrack(scene: IncidentScene, scaleX: number, scaleY: number, centerY: number): string[] {
  if (scene.corridor.trackPath.length < 2) {
    const usableWidth = CANVAS_WIDTH - (CANVAS_PADDING_X * 2);
    const usableHeight = (CANVAS_HEIGHT - FOOTER_HEIGHT) - (CANVAS_PADDING_Y * 2);
    return [
      `  <rect x="${round(CANVAS_PADDING_X)}" y="${round(CANVAS_PADDING_Y * 2)}" width="${round(usableWidth)}" height="${round(usableHeight)}" fill="#1e293b" stroke="#475569" stroke-width="2" rx="22" ry="22"/>`,
      `  <line x1="${round(CANVAS_PADDING_X)}" y1="${round(centerY)}" x2="${round(CANVAS_WIDTH - CANVAS_PADDING_X)}" y2="${round(centerY)}" stroke="#64748b" stroke-width="2" stroke-dasharray="10 8"/>`,
    ];
  }

  const leftPath = buildPath(scene.corridor.trackPath, (sample) => toCanvasPoint(sample.forwardM, sample.leftLateralM, scene, scaleX, scaleY, centerY));
  const rightPath = buildPath(
    scene.corridor.trackPath.slice().reverse(),
    (sample) => toCanvasPoint(sample.forwardM, sample.rightLateralM, scene, scaleX, scaleY, centerY),
  );
  const centerPath = buildPath(scene.corridor.trackPath, (sample) => toCanvasPoint(sample.forwardM, sample.centerLateralM, scene, scaleX, scaleY, centerY));

  return [
    `  <path d="${leftPath} ${rightPath} Z" fill="#1e293b" stroke="#475569" stroke-width="2"/>`,
    `  <path d="${centerPath}" fill="none" stroke="#64748b" stroke-width="2" stroke-dasharray="10 8"/>`,
  ];
}

function renderTrail(
  car: IncidentSceneCar,
  scene: IncidentScene,
  scaleX: number,
  scaleY: number,
  centerY: number,
): string[] {
  const finitePlacements = car.placements
    .filter((placement) => placement.forwardM != null && placement.lateralM != null)
    .sort((left, right) => left.relativeMs - right.relativeMs || (left.snapshotId ?? 0) - (right.snapshotId ?? 0));

  if (finitePlacements.length < 2) {
    return [];
  }

  const path = buildPath(finitePlacements, (placement) => toCanvasPoint(placement.forwardM!, placement.lateralM!, scene, scaleX, scaleY, centerY));
  const color = car.role === 'involved' ? '#fb7185' : '#38bdf8';
  return [`  <path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>`];
}

function renderCar(
  car: IncidentSceneCar,
  placement: IncidentScenePlacement,
  scene: IncidentScene,
  scaleX: number,
  scaleY: number,
  centerY: number,
): string[] {
  const x = projectX(placement.forwardM ?? 0, scene, scaleX);
  const y = projectY(placement.lateralM ?? 0, scaleY, centerY);
  const fill = car.role === 'involved' ? resolveInvolvedColor(car.carId, scene.anchorCarId) : '#38bdf8';
  const stroke = placement.evidence.degraded ? '#fbbf24' : '#e2e8f0';
  const radius = car.role === 'involved' ? 14 : 11;
  const dash = placement.evidence.degraded ? '6 4' : 'none';
  const opacity = placement.evidence.degraded ? '0.9' : '1';

  return [
    `  <g data-car-id="${car.carId}" data-role="${car.role}" data-evidence="${placement.evidence.degraded ? 'degraded' : placement.evidence.state}">`,
    `    <circle cx="${round(x)}" cy="${round(y)}" r="${round(radius)}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="3" stroke-dasharray="${dash}"/>`,
    `    <text x="${round(x)}" y="${round(y + 4)}" text-anchor="middle" class="label">${car.carId}</text>`,
    `    <text x="${round(x)}" y="${round(y - radius - 10)}" text-anchor="middle" class="small">${escapeXml(car.role)} · ${escapeXml(placement.evidence.projectionSource)}</text>`,
    '  </g>',
  ];
}

function renderMissingCars(cars: readonly IncidentSceneCar[], trackBottom: number): string[] {
  if (cars.length === 0) {
    return [];
  }

  const lines = cars
    .slice()
    .sort((left, right) => left.carId - right.carId)
    .map((car, index) => `  <text x="${round(CANVAS_PADDING_X)}" y="${round(trackBottom + 22 + (index * 18))}" class="small muted">car ${car.carId}: missing local placement</text>`);

  return [
    `  <text x="${round(CANVAS_PADDING_X)}" y="${round(trackBottom + 2)}" class="label">Degraded markers</text>`,
    ...lines,
  ];
}

function resolveRenderedPlacement(car: IncidentSceneCar, anchorRelativeMs: number): IncidentScenePlacement | null {
  const finitePlacements = car.placements.filter((placement) => placement.forwardM != null && placement.lateralM != null);
  if (finitePlacements.length === 0) {
    return null;
  }

  return finitePlacements.slice().sort((left, right) => {
    const timeDelta = Math.abs(left.relativeMs - anchorRelativeMs) - Math.abs(right.relativeMs - anchorRelativeMs);
    if (timeDelta !== 0) {
      return timeDelta;
    }

    const evidenceDelta = evidenceRank(left.evidence.degraded) - evidenceRank(right.evidence.degraded);
    if (evidenceDelta !== 0) {
      return evidenceDelta;
    }

    return (left.snapshotId ?? Number.MAX_SAFE_INTEGER) - (right.snapshotId ?? Number.MAX_SAFE_INTEGER);
  })[0] ?? null;
}

function compareRenderedCars(
  left: { car: IncidentSceneCar; placement: IncidentScenePlacement | null },
  right: { car: IncidentSceneCar; placement: IncidentScenePlacement | null },
): number {
  const roleDelta = roleRank(left.car.role) - roleRank(right.car.role);
  if (roleDelta !== 0) {
    return roleDelta;
  }

  if (left.placement && right.placement) {
    const positionDelta = left.placement.forwardM! - right.placement.forwardM!;
    if (positionDelta !== 0) {
      return positionDelta;
    }
  }

  return left.car.carId - right.car.carId;
}

function buildPath<T>(items: readonly T[], toPoint: (item: T) => { x: number; y: number }): string {
  return items
    .map((item, index) => {
      const point = toPoint(item);
      return `${index === 0 ? 'M' : 'L'} ${round(point.x)} ${round(point.y)}`;
    })
    .join(' ');
}

function toCanvasPoint(
  forwardM: number,
  lateralM: number,
  scene: IncidentScene,
  scaleX: number,
  scaleY: number,
  centerY: number,
): { x: number; y: number } {
  return {
    x: projectX(forwardM, scene, scaleX),
    y: projectY(lateralM, scaleY, centerY),
  };
}

function resolveInvolvedColor(carId: number, anchorCarId: number | null): string {
  if (anchorCarId === carId) {
    return '#ef4444';
  }

  return '#f97316';
}

function projectX(forwardM: number, scene: IncidentScene, scaleX: number): number {
  return CANVAS_PADDING_X + ((forwardM + scene.corridor.backwardRangeM) * scaleX);
}

function projectY(lateralM: number, scaleY: number, centerY: number): number {
  return centerY - (lateralM * scaleY);
}

function roleRank(role: IncidentSceneCar['role']): number {
  return role === 'context' ? 0 : 1;
}

function evidenceRank(degraded: boolean): number {
  return degraded ? 1 : 0;
}

function round(value: number): string {
  return value.toFixed(2).replace(/\.00$/, '');
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
