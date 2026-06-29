import { buildIncidentFrameSequence } from './buildIncidentFrameSequence';
import { renderIncidentGif } from './renderIncidentGif';
import type { IncidentScene, IncidentVisualArtifacts } from './reconstructionTypes';

const DEFAULT_MAX_GIF_BYTES = 8 * 1024 * 1024;

export type CreateIncidentArtifactsInput = Readonly<{
  scene: IncidentScene;
  maxGifBytes?: number;
}>;

export function createIncidentArtifacts(input: CreateIncidentArtifactsInput): IncidentVisualArtifacts {
  const frames = buildIncidentFrameSequence(input.scene);
  const bytes = renderIncidentGif(input.scene, frames);
  const maxGifBytes = input.maxGifBytes ?? DEFAULT_MAX_GIF_BYTES;

  if (bytes.length > maxGifBytes) {
    return Object.freeze({
      delivery: 'omitted',
      frames,
      notes: Object.freeze([
        ...input.scene.notes,
        `incident.gif omitted because ${bytes.length} bytes exceeded local budget ${maxGifBytes}`,
      ]),
    });
  }

  return Object.freeze({
    delivery: frames.length > 1 ? 'sequence_ready' : 'static_only',
    animationGif: Object.freeze({
      filename: 'incident.gif',
      contentType: 'image/gif',
      bytes,
    }),
    frames,
    notes: Object.freeze([...input.scene.notes]),
  });
}
