import type { SpeechCreateParams } from 'openai/resources/audio/speech';

import { getOpenAIClient } from './speechService';

type SpeechFormat = NonNullable<SpeechCreateParams['response_format']>;

export interface SpeechSynthesisOptions {
  voice?: SpeechCreateParams['voice'];
  format?: SpeechFormat;
  model?: SpeechCreateParams['model'];
}

export interface SpeechSynthesisResult {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  raw?: unknown;
}

const DEFAULT_SPEECH_MODEL = process.env.OPENAI_SPEECH_MODEL ?? 'gpt-4o-mini-tts';
const DEFAULT_VOICE = process.env.OPENAI_SPEECH_VOICE ?? 'alloy';
const DEFAULT_FORMAT = (process.env.OPENAI_SPEECH_FORMAT ?? 'mp3') as SpeechFormat;

const MIME_TYPE_BY_FORMAT: Record<SpeechFormat, { mime: string; extension: string }> = {
  mp3: { mime: 'audio/mpeg', extension: 'mp3' },
  wav: { mime: 'audio/wav', extension: 'wav' },
  flac: { mime: 'audio/flac', extension: 'flac' },
  opus: { mime: 'audio/ogg', extension: 'opus' },
  pcm: { mime: 'audio/pcm', extension: 'pcm' },
  aac: { mime: 'audio/aac', extension: 'aac' },
};

export class SpeechSynthesisError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
  }
}

export const synthesizeSpeech = async (
  text: string,
  options?: SpeechSynthesisOptions
): Promise<SpeechSynthesisResult> => {
  const client = getOpenAIClient();
  const format = options?.format ?? DEFAULT_FORMAT;
  const voice = options?.voice ?? DEFAULT_VOICE;
  const model = options?.model ?? DEFAULT_SPEECH_MODEL;

  const mapping = MIME_TYPE_BY_FORMAT[format ?? 'mp3'];
  if (!mapping) {
    throw new SpeechSynthesisError(`Unsupported speech format: ${format as string}`);
  }

  try {
    const response = await client.audio.speech.create({
      model,
      voice,
      input: text,
      response_format: format,
    });

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return {
      buffer,
      mimeType: mapping.mime,
      extension: mapping.extension,
      raw: {
        request: { model, voice, format },
      },
    };
  } catch (error) {
    throw new SpeechSynthesisError(
      error instanceof Error ? error.message : 'Failed to synthesize speech.',
      error
    );
  }
};
