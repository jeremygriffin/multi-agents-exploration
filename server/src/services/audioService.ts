import { join } from 'path';

import { writeFile } from 'fs/promises';

import { buildStoredFilename, ensureStorageDir } from '../utils/fileUtils';

const AUDIO_MIME_EXTENSION_MAP = new Map<string, string>([
  ['audio/mpeg', 'mp3'],
  ['audio/mp3', 'mp3'],
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/webm', 'webm'],
  ['audio/ogg', 'ogg'],
  ['audio/ogg; codecs=opus', 'ogg'],
  ['audio/mp4', 'mp4'],
  ['audio/aac', 'aac'],
  ['audio/flac', 'flac'],
]);

export const SUPPORTED_AUDIO_MIME_TYPES = Array.from(AUDIO_MIME_EXTENSION_MAP.keys());

export interface AudioValidationResult {
  ok: boolean;
  mimeType: string;
  extension?: string;
  reason?: string;
}

export interface TranscodeResult {
  buffer: Buffer;
  mimeType: string;
  format: string;
  note?: string;
}

export const validateAudioMimeType = (mimeType: string): AudioValidationResult => {
  const normalized = mimeType.toLowerCase().trim();
  const [baseCandidate] = normalized.split(';');
  const base = (baseCandidate ?? '').trim();

  const matchExtension =
    AUDIO_MIME_EXTENSION_MAP.get(normalized) ?? (base ? AUDIO_MIME_EXTENSION_MAP.get(base) : undefined);

  if (!matchExtension) {
    return {
      ok: false,
      mimeType,
      reason: `Unsupported audio MIME type: ${mimeType}`,
    };
  }

  return {
    ok: true,
    mimeType: base || normalized,
    extension: matchExtension,
  };
};

export const transcodeAudio = async (buffer: Buffer, mimeType: string): Promise<TranscodeResult> => {
  // TODO: integrate FFmpeg-based transcoding.
  return {
    buffer,
    mimeType,
    format: mimeType.split('/')[1] ?? 'unknown',
    note: 'Audio returned without transcoding (stub implementation).',
  };
};

export interface PersistedAudio {
  storedName: string;
  storedPath: string;
}

export const persistAudioBuffer = async (
  buffer: Buffer,
  originalName: string,
  timestamp = Date.now()
): Promise<PersistedAudio> => {
  const storageDir = await ensureStorageDir();
  const storedName = buildStoredFilename(originalName, timestamp);
  const storedPath = join(storageDir, storedName);

  await writeFile(storedPath, buffer);

  return { storedName, storedPath };
};

export const createTranscriptFilename = (storedName: string): string => `${storedName}.transcript.md`;
