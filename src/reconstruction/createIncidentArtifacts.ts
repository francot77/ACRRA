import { buildIncidentFrameSequence } from './buildIncidentFrameSequence';
import { renderIncidentGif } from './renderIncidentGif';
import { renderIncidentSvg } from './renderIncidentSvg';
import type { IncidentScene, IncidentVisualArtifacts } from './reconstructionTypes';

const DEFAULT_MAX_GIF_BYTES = 8 * 1024 * 1024;

export type CreateIncidentArtifactsInput = Readonly<{
  scene: IncidentScene;
  maxGifBytes?: number;
}>;

export function createIncidentArtifacts(input: CreateIncidentArtifactsInput): IncidentVisualArtifacts {
  const staticSvg = renderIncidentSvg(input.scene);
  const staticSvgBytes = Buffer.from(staticSvg.content, 'utf8');
  const frames = buildIncidentFrameSequence(input.scene);
  const bytes = renderIncidentGif(input.scene, frames);
  const maxGifBytes = input.maxGifBytes ?? DEFAULT_MAX_GIF_BYTES;

  if (bytes.length > maxGifBytes) {
    return Object.freeze({
      delivery: 'omitted',
      staticSvg: Object.freeze({
        filename: 'incident.svg',
        contentType: 'image/svg+xml',
        bytes: staticSvgBytes,
        width: staticSvg.width,
        height: staticSvg.height,
      }),
      frames,
      notes: Object.freeze([
        ...input.scene.notes,
        `incident.gif omitted because ${bytes.length} bytes exceeded local budget ${maxGifBytes}`,
      ]),
    });
  }

  return Object.freeze({
    delivery: frames.length > 1 ? 'sequence_ready' : 'static_only',
    staticSvg: Object.freeze({
      filename: 'incident.svg',
      contentType: 'image/svg+xml',
      bytes: staticSvgBytes,
      width: staticSvg.width,
      height: staticSvg.height,
    }),
    animationGif: Object.freeze({
      filename: 'incident.gif',
      contentType: 'image/gif',
      bytes,
    }),
    frames,
    notes: Object.freeze([...input.scene.notes]),
  });
}
