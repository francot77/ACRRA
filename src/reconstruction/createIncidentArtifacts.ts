import { buildIncidentFrameSequence } from './buildIncidentFrameSequence';
import { renderIncidentSvg } from './renderIncidentSvg';
import type { IncidentScene, IncidentVisualArtifacts } from './reconstructionTypes';

const DEFAULT_MAX_SVG_BYTES = 128 * 1024;

export type CreateIncidentArtifactsInput = Readonly<{
  scene: IncidentScene;
  maxSvgBytes?: number;
}>;

export function createIncidentArtifacts(input: CreateIncidentArtifactsInput): IncidentVisualArtifacts {
  const frames = buildIncidentFrameSequence(input.scene);
  const rendered = renderIncidentSvg(input.scene);
  const bytes = Buffer.from(rendered.content, 'utf8');
  const maxSvgBytes = input.maxSvgBytes ?? DEFAULT_MAX_SVG_BYTES;

  if (bytes.length > maxSvgBytes) {
    return Object.freeze({
      delivery: 'omitted',
      frames,
      notes: Object.freeze([
        ...input.scene.notes,
        `incident.svg omitted because ${bytes.length} bytes exceeded local budget ${maxSvgBytes}`,
      ]),
    });
  }

  return Object.freeze({
    delivery: frames.length > 1 ? 'sequence_ready' : 'static_only',
    staticSvg: Object.freeze({
      filename: 'incident.svg',
      contentType: 'image/svg+xml',
      bytes,
    }),
    frames,
    notes: Object.freeze([...input.scene.notes]),
  });
}
