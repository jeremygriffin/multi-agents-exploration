import { describe, expect, it } from 'vitest';

import {
  createTranscriptFilename,
  persistAudioBuffer,
  transcodeAudio,
  validateAudioMimeType,
} from '../audioService';

import { existsSync } from 'fs';
import { readFile, unlink } from 'fs/promises';
import { join } from 'path';

describe('audioService', () => {
  it('validates supported mime types', () => {
    const result = validateAudioMimeType('audio/mpeg');
    expect(result.ok).toBe(true);
    expect(result.extension).toBe('mp3');
  });

  it('rejects unsupported mime types', () => {
    const result = validateAudioMimeType('audio/unknown');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Unsupported/);
  });

  it('passes audio through the stub transcoder', async () => {
    const buffer = Buffer.from('sample');
    const result = await transcodeAudio(buffer, 'audio/mpeg');
    expect(result.buffer).toBe(buffer);
    expect(result.format).toBe('mpeg');
  });

  it('persists audio buffers with timestamped names', async () => {
    const buffer = Buffer.from('sample-audio');
    const timestamp = 1700000000000;
    const { storedName, storedPath } = await persistAudioBuffer(buffer, 'clip.webm', timestamp);

    expect(storedName.startsWith(`${timestamp}_`)).toBe(true);
    expect(storedPath.endsWith(storedName)).toBe(true);
    expect(existsSync(storedPath)).toBe(true);

    const diskData = await readFile(storedPath);
    expect(diskData.equals(buffer)).toBe(true);

    await unlink(storedPath);
  });

  it('creates transcript filenames with predictable suffix', () => {
    const result = createTranscriptFilename('file.ogg');
    expect(result).toBe('file.ogg.transcript.md');
  });
});
