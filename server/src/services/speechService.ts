import OpenAI from 'openai';
import { toFile } from 'openai/uploads';

export interface TranscriptionResult {
  text: string;
  raw?: unknown;
}

const DEFAULT_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL ?? 'gpt-4o-mini-transcribe';

let client: OpenAI | null = null;

const getClient = (): OpenAI => {
  if (client) {
    return client;
  }

  client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
};

export const transcribeAudio = async (
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<TranscriptionResult> => {
  const apiClient = getClient();

  const file = await toFile(buffer, filename, { type: mimeType });

  const response = await apiClient.audio.transcriptions.create({
    file,
    model: DEFAULT_TRANSCRIPTION_MODEL,
    response_format: 'verbose_json',
  });

  const primaryText = typeof response.text === 'string' ? response.text.trim() : '';
  const segmentText = Array.isArray(response.segments)
    ? response.segments
        .map((segment) => segment.text)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' ')
        .trim()
    : '';

  const text = primaryText || segmentText;

  if (!text) {
    throw new Error('Transcription response did not include any text.');
  }

  return {
    text,
    raw: response,
  };
};
