import type { IncidentScene, IncidentSceneCar, IncidentSceneFrame } from './reconstructionTypes';

const WIDTH = 480;
const HEIGHT = 320;
const PADDING_X = 28;
const PADDING_Y = 24;
const FOOTER_HEIGHT = 18;
const FRAME_DELAY_CS = 12;

const PALETTE = [
  [15, 23, 42],
  [30, 41, 59],
  [71, 85, 105],
  [100, 116, 139],
  [148, 163, 184],
  [226, 232, 240],
  [239, 68, 68],
  [249, 115, 22],
  [56, 189, 248],
  [251, 191, 36],
  [245, 158, 11],
  [17, 24, 39],
  [244, 114, 182],
  [34, 197, 94],
  [59, 130, 246],
  [250, 250, 250],
] as const;

const COLOR = {
  background: 0,
  asphalt: 1,
  edge: 2,
  centerline: 3,
  trackFill: 11,
  outline: 5,
  anchor: 10,
  degraded: 9,
  context: 8,
  anchorCar: 6,
  otherInvolved: 7,
  trailA: 12,
  trailB: 13,
  trailC: 14,
  white: 15,
} as const;

export function renderIncidentGif(scene: IncidentScene, frames: readonly IncidentSceneFrame[]): Buffer {
  const normalizedFrames = frames.length > 0 ? frames : [buildFallbackFrame(scene)];
  const encoder = new GifEncoder(WIDTH, HEIGHT, createGlobalColorTable());

  for (const frame of normalizedFrames) {
    const pixels = new Uint8Array(WIDTH * HEIGHT);
    pixels.fill(COLOR.background);
    drawFrame(pixels, scene, frame);
    encoder.addFrame(pixels, FRAME_DELAY_CS);
  }

  return encoder.finish();
}

function buildFallbackFrame(scene: IncidentScene): IncidentSceneFrame {
  const cars = scene.cars
    .map((car) => {
      const placement = car.placements.find((candidate) => candidate.forwardM != null && candidate.lateralM != null) ?? null;
      if (!placement) {
        return null;
      }

      return Object.freeze({
        carId: car.carId,
        forwardM: Number(placement.forwardM!.toFixed(2)),
        lateralM: Number(placement.lateralM!.toFixed(2)),
        evidence: placement.evidence.state,
      });
    })
    .filter((entry): entry is IncidentSceneFrame['cars'][number] => entry !== null);

  return Object.freeze({
    atRelativeMs: scene.anchorRelativeMs,
    source: 'observed',
    cars: Object.freeze(cars),
  });
}

function drawFrame(pixels: Uint8Array, scene: IncidentScene, frame: IncidentSceneFrame): void {
  const scaleX = (WIDTH - (PADDING_X * 2)) / Math.max(scene.corridor.forwardRangeM + scene.corridor.backwardRangeM, 1);
  const scaleY = (HEIGHT - FOOTER_HEIGHT - (PADDING_Y * 2)) / Math.max(scene.corridor.lateralHalfWidthM * 2.6, 1);
  const centerY = (HEIGHT - FOOTER_HEIGHT) / 2;
  const anchorX = projectX(0, scene, scaleX);

  drawTrack(pixels, scene, scaleX, scaleY, centerY);
  drawVerticalDashedLine(pixels, Math.round(anchorX), PADDING_Y, HEIGHT - FOOTER_HEIGHT - PADDING_Y, COLOR.anchor, 5, 4);
  fillCircle(pixels, Math.round(anchorX), Math.round(centerY), 5, COLOR.anchor);

  scene.cars.forEach((car, index) => {
    const trailPoints = car.placements
      .filter((placement) => placement.forwardM != null && placement.lateralM != null && placement.relativeMs <= frame.atRelativeMs)
      .sort((left, right) => left.relativeMs - right.relativeMs || (left.snapshotId ?? 0) - (right.snapshotId ?? 0))
      .map((placement) => ({ x: projectX(placement.forwardM!, scene, scaleX), y: projectY(placement.lateralM!, scaleY, centerY) }));

    if (trailPoints.length >= 2) {
      drawPolyline(pixels, trailPoints, [COLOR.trailA, COLOR.trailB, COLOR.trailC][index % 3]!);
    }
  });

  frame.cars.forEach((car) => {
    const sceneCar = scene.cars.find((candidate) => candidate.carId === car.carId);
    const x = Math.round(projectX(car.forwardM, scene, scaleX));
    const y = Math.round(projectY(car.lateralM, scaleY, centerY));
    const fill = sceneCar?.role === 'context'
      ? COLOR.context
      : (scene.anchorCarId === car.carId ? COLOR.anchorCar : COLOR.otherInvolved);
    const stroke = car.evidence === 'derived' ? COLOR.degraded : COLOR.outline;

    fillCircle(pixels, x, y, sceneCar?.role === 'context' ? 6 : 8, fill);
    strokeCircle(pixels, x, y, sceneCar?.role === 'context' ? 6 : 8, stroke);
  });
}

function drawTrack(pixels: Uint8Array, scene: IncidentScene, scaleX: number, scaleY: number, centerY: number): void {
  if (scene.corridor.trackPath.length < 2) {
    fillRect(pixels, PADDING_X, PADDING_Y, WIDTH - (PADDING_X * 2), HEIGHT - FOOTER_HEIGHT - (PADDING_Y * 2), COLOR.asphalt);
    drawVerticalBorder(pixels, PADDING_X, PADDING_Y, HEIGHT - FOOTER_HEIGHT - PADDING_Y, COLOR.edge);
    drawVerticalBorder(pixels, WIDTH - PADDING_X, PADDING_Y, HEIGHT - FOOTER_HEIGHT - PADDING_Y, COLOR.edge);
    drawHorizontalDashedLine(pixels, PADDING_X, WIDTH - PADDING_X, Math.round(centerY), COLOR.centerline, 8, 6);
    return;
  }

  const left = scene.corridor.trackPath.map((sample) => toCanvasPoint(sample.forwardM, sample.leftLateralM, scene, scaleX, scaleY, centerY));
  const right = scene.corridor.trackPath.slice().reverse().map((sample) => toCanvasPoint(sample.forwardM, sample.rightLateralM, scene, scaleX, scaleY, centerY));
  const center = scene.corridor.trackPath.map((sample) => toCanvasPoint(sample.forwardM, sample.centerLateralM, scene, scaleX, scaleY, centerY));

  fillPolygon(pixels, [...left, ...right], COLOR.asphalt);
  drawPolyline(pixels, left, COLOR.edge);
  drawPolyline(pixels, right.slice().reverse(), COLOR.edge);
  drawDashedPolyline(pixels, center, COLOR.centerline, 7, 5);
}

function projectX(forwardM: number, scene: IncidentScene, scaleX: number): number {
  return PADDING_X + ((forwardM + scene.corridor.backwardRangeM) * scaleX);
}

function projectY(lateralM: number, scaleY: number, centerY: number): number {
  return centerY - (lateralM * scaleY);
}

function toCanvasPoint(forwardM: number, lateralM: number, scene: IncidentScene, scaleX: number, scaleY: number, centerY: number) {
  return { x: projectX(forwardM, scene, scaleX), y: projectY(lateralM, scaleY, centerY) };
}

function fillRect(pixels: Uint8Array, x: number, y: number, width: number, height: number, color: number): void {
  for (let py = Math.max(0, y); py < Math.min(HEIGHT, y + height); py += 1) {
    for (let px = Math.max(0, x); px < Math.min(WIDTH, x + width); px += 1) {
      setPixel(pixels, px, py, color);
    }
  }
}

function drawVerticalBorder(pixels: Uint8Array, x: number, y1: number, y2: number, color: number): void {
  drawLine(pixels, x, y1, x, y2, color);
}

function drawHorizontalDashedLine(pixels: Uint8Array, x1: number, x2: number, y: number, color: number, dash: number, gap: number): void {
  let drawing = true;
  let remaining = dash;
  for (let x = x1; x <= x2; x += 1) {
    if (drawing) {
      setPixel(pixels, x, y, color);
    }
    remaining -= 1;
    if (remaining === 0) {
      drawing = !drawing;
      remaining = drawing ? dash : gap;
    }
  }
}

function drawVerticalDashedLine(pixels: Uint8Array, x: number, y1: number, y2: number, color: number, dash: number, gap: number): void {
  let drawing = true;
  let remaining = dash;
  for (let y = y1; y <= y2; y += 1) {
    if (drawing) {
      setPixel(pixels, x, y, color);
    }
    remaining -= 1;
    if (remaining === 0) {
      drawing = !drawing;
      remaining = drawing ? dash : gap;
    }
  }
}

function drawPolyline(pixels: Uint8Array, points: readonly { x: number; y: number }[], color: number): void {
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    drawLine(pixels, Math.round(start.x), Math.round(start.y), Math.round(end.x), Math.round(end.y), color);
  }
}

function drawDashedPolyline(pixels: Uint8Array, points: readonly { x: number; y: number }[], color: number, dash: number, gap: number): void {
  let counter = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    const segments = Math.max(Math.abs(Math.round(end.x - start.x)), Math.abs(Math.round(end.y - start.y)), 1);
    for (let step = 0; step <= segments; step += 1) {
      const ratio = step / segments;
      const x = Math.round(start.x + ((end.x - start.x) * ratio));
      const y = Math.round(start.y + ((end.y - start.y) * ratio));
      const cycle = dash + gap;
      if ((counter % cycle) < dash) {
        setPixel(pixels, x, y, color);
      }
      counter += 1;
    }
  }
}

function drawLine(pixels: Uint8Array, x1: number, y1: number, x2: number, y2: number, color: number): void {
  let currentX = x1;
  let currentY = y1;
  const deltaX = Math.abs(x2 - x1);
  const stepX = x1 < x2 ? 1 : -1;
  const deltaY = -Math.abs(y2 - y1);
  const stepY = y1 < y2 ? 1 : -1;
  let error = deltaX + deltaY;

  while (true) {
    setPixel(pixels, currentX, currentY, color);
    if (currentX === x2 && currentY === y2) {
      return;
    }
    const doubled = error * 2;
    if (doubled >= deltaY) {
      error += deltaY;
      currentX += stepX;
    }
    if (doubled <= deltaX) {
      error += deltaX;
      currentY += stepY;
    }
  }
}

function fillCircle(pixels: Uint8Array, cx: number, cy: number, radius: number, color: number): void {
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if ((x * x) + (y * y) <= (radius * radius)) {
        setPixel(pixels, cx + x, cy + y, color);
      }
    }
  }
}

function strokeCircle(pixels: Uint8Array, cx: number, cy: number, radius: number, color: number): void {
  for (let angle = 0; angle < 360; angle += 1) {
    const radians = (angle * Math.PI) / 180;
    const x = Math.round(cx + (Math.cos(radians) * radius));
    const y = Math.round(cy + (Math.sin(radians) * radius));
    setPixel(pixels, x, y, color);
  }
}

function fillPolygon(pixels: Uint8Array, points: readonly { x: number; y: number }[], color: number): void {
  if (points.length < 3) {
    return;
  }

  const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y))));
  const maxY = Math.min(HEIGHT - 1, Math.ceil(Math.max(...points.map((point) => point.y))));

  for (let y = minY; y <= maxY; y += 1) {
    const intersections: number[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index]!;
      const end = points[(index + 1) % points.length]!;
      const intersects = (start.y <= y && end.y > y) || (end.y <= y && start.y > y);
      if (!intersects) {
        continue;
      }

      const ratio = (y - start.y) / (end.y - start.y);
      intersections.push(start.x + ((end.x - start.x) * ratio));
    }

    intersections.sort((left, right) => left - right);
    for (let index = 0; index < intersections.length; index += 2) {
      const startX = Math.max(0, Math.floor(intersections[index] ?? 0));
      const endX = Math.min(WIDTH - 1, Math.ceil(intersections[index + 1] ?? startX));
      for (let x = startX; x <= endX; x += 1) {
        setPixel(pixels, x, y, color);
      }
    }
  }
}

function setPixel(pixels: Uint8Array, x: number, y: number, color: number): void {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) {
    return;
  }

  pixels[(y * WIDTH) + x] = color;
}

function createGlobalColorTable(): Uint8Array {
  const bytes = new Uint8Array(256 * 3);
  PALETTE.forEach((rgb, index) => {
    bytes[index * 3] = rgb[0];
    bytes[(index * 3) + 1] = rgb[1];
    bytes[(index * 3) + 2] = rgb[2];
  });
  return bytes;
}

class GifEncoder {
  private readonly chunks: number[] = [];

  constructor(width: number, height: number, globalColorTable: Uint8Array) {
    writeAscii(this.chunks, 'GIF89a');
    writeShort(this.chunks, width);
    writeShort(this.chunks, height);
    this.chunks.push(0xf7, 0x00, 0x00);
    this.chunks.push(...globalColorTable);
    this.chunks.push(0x21, 0xff, 0x0b);
    writeAscii(this.chunks, 'NETSCAPE2.0');
    this.chunks.push(0x03, 0x01, 0x00, 0x00, 0x00);
  }

  addFrame(indexedPixels: Uint8Array, delayCentiseconds: number): void {
    this.chunks.push(0x21, 0xf9, 0x04, 0x04);
    writeShort(this.chunks, delayCentiseconds);
    this.chunks.push(0x00, 0x00);
    this.chunks.push(0x2c);
    writeShort(this.chunks, 0);
    writeShort(this.chunks, 0);
    writeShort(this.chunks, WIDTH);
    writeShort(this.chunks, HEIGHT);
    this.chunks.push(0x00);

    const minCodeSize = 8;
    this.chunks.push(minCodeSize);
    const compressed = lzwEncode(indexedPixels, minCodeSize);
    for (let offset = 0; offset < compressed.length; offset += 255) {
      const block = compressed.subarray(offset, offset + 255);
      this.chunks.push(block.length, ...block);
    }
    this.chunks.push(0x00);
  }

  finish(): Buffer {
    return Buffer.from([...this.chunks, 0x3b]);
  }
}

function lzwEncode(pixels: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let dictionary = new Map<string, number>();
  for (let index = 0; index < clearCode; index += 1) {
    dictionary.set(String.fromCharCode(index), index);
  }

  const outputBits: number[] = [];
  const writeCode = (code: number) => {
    for (let bit = 0; bit < codeSize; bit += 1) {
      outputBits.push((code >> bit) & 1);
    }
  };

  writeCode(clearCode);
  let sequence = String.fromCharCode(pixels[0] ?? 0);

  for (let index = 1; index < pixels.length; index += 1) {
    const symbol = String.fromCharCode(pixels[index]!);
    const candidate = sequence + symbol;
    if (dictionary.has(candidate)) {
      sequence = candidate;
      continue;
    }

    writeCode(dictionary.get(sequence)!);
    if (nextCode < 4096) {
      dictionary.set(candidate, nextCode);
      nextCode += 1;
      if (nextCode === (1 << codeSize) && codeSize < 12) {
        codeSize += 1;
      }
    } else {
      writeCode(clearCode);
      dictionary = new Map<string, number>();
      for (let reset = 0; reset < clearCode; reset += 1) {
        dictionary.set(String.fromCharCode(reset), reset);
      }
      codeSize = minCodeSize + 1;
      nextCode = endCode + 1;
    }
    sequence = symbol;
  }

  writeCode(dictionary.get(sequence)!);
  writeCode(endCode);

  const bytes = new Uint8Array(Math.ceil(outputBits.length / 8));
  outputBits.forEach((bit, index) => {
    bytes[Math.floor(index / 8)]! |= bit << (index % 8);
  });
  return bytes;
}

function writeAscii(target: number[], value: string): void {
  for (const char of value) {
    target.push(char.charCodeAt(0));
  }
}

function writeShort(target: number[], value: number): void {
  target.push(value & 0xff, (value >> 8) & 0xff);
}
