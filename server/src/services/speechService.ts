import OpenAI from 'openai';
import { toFile } from 'openai/uploads';

export interface TranscriptionResult {
  text: string;
  raw?: unknown;
}

export interface TranscriptionError extends Error {
  status?: number;
  details?: unknown;
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

  let response: Awaited<ReturnType<typeof apiClient.audio.transcriptions.create>>;

  try {
    response = await apiClient.audio.transcriptions.create({
      file,
      model: DEFAULT_TRANSCRIPTION_MODEL,
      response_format: 'verbose_json',
    });
  } catch (error) {
    const transcriptionError: TranscriptionError = new Error(
      error instanceof Error ? error.message : 'Unknown transcription error'
    );

    if (error instanceof OpenAI.APIError) {
      transcriptionError.status = error.status;
      transcriptionError.details = error.error ?? error;
    } else if (typeof error === 'object' && error !== null) {
      transcriptionError.details = error;
    }

    throw transcriptionError;
  }

  const primaryText = typeof response.text === 'string' ? response.text.trim() : '';

  let segmentText = '';
  if ('segments' in response && Array.isArray((response as { segments?: Array<{ text?: string }> }).segments)) {
    const segments = (response as { segments?: Array<{ text?: string }> }).segments ?? [];
    segmentText = segments
      .map((segment) => segment.text)
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ')
      .trim();
  }

  const text = primaryText || segmentText;

  if (!text) {
    const noTextError: TranscriptionError = new Error('Transcription response did not include any text.');
    noTextError.details = response;
    throw noTextError;
  }

  return {
    text,
    raw: response,
  };
};
