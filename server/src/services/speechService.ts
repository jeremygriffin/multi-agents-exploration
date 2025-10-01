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
const MAX_ATTEMPTS = 3;
const RETRYABLE_NODE_ERRORS = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED']);

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

  type TranscriptionResponse = Awaited<ReturnType<typeof apiClient.audio.transcriptions.create>>;

  let response: TranscriptionResponse | undefined;
  let lastError: TranscriptionError | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    console.error('[speechService] transcription attempt', { attempt: attempt + 1 });
    try {
      response = await apiClient.audio.transcriptions.create({
        file,
        model: DEFAULT_TRANSCRIPTION_MODEL,
        response_format: 'json',
      });
      break;
    } catch (error) {
      const transcriptionError: TranscriptionError = new Error(
        error instanceof Error ? error.message : 'Unknown transcription error'
      );

        console.error('[speechService] error during transcription attempt', {
            status: transcriptionError.status,
            message: transcriptionError.message,
            details: transcriptionError.details,
        });

      if (error instanceof OpenAI.APIError) {
        transcriptionError.status = error.status;
        transcriptionError.details = error.error ?? error;

        if (error.status < 500) {
          // eslint-disable-next-line no-console
          console.error('[speechService] transcription aborted (client error)', {
            status: error.status,
            message: transcriptionError.message,
            details: transcriptionError.details,
          });
          throw transcriptionError;
        }
      } else if (typeof error === 'object' && error !== null) {
        transcriptionError.details = error;

        const nodeError = (error as { cause?: { code?: string } }).cause?.code;
        if (!nodeError || !RETRYABLE_NODE_ERRORS.has(nodeError)) {
          // eslint-disable-next-line no-console
          console.error('[speechService] transcription aborted (non-retryable error)', {
            message: transcriptionError.message,
            details: transcriptionError.details,
          });
          throw transcriptionError;
        }
      } else {
        // eslint-disable-next-line no-console
        console.error('[speechService] transcription aborted (unexpected error)', {
          message: transcriptionError.message,
        });
        throw transcriptionError;
      }

      lastError = transcriptionError;

      if (attempt < MAX_ATTEMPTS - 1) {
        const backoffMs = 250 * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  if (!response) {
    // eslint-disable-next-line no-console
    console.error('[speechService] transcription failed after retries', {
      message: lastError?.message,
      details: lastError?.details,
    });
    throw lastError ?? new Error('Transcription request failed without a response.');
  }

  const normalizeResponse = (): { text?: string; segments?: Array<{ text?: string }> } => {
    if (typeof response === 'string') {
      try {
        return JSON.parse(response) as { text?: string; segments?: Array<{ text?: string }> };
      } catch {
        return {};
      }
    }

    return response as { text?: string; segments?: Array<{ text?: string }> };
  };

  const normalized = normalizeResponse();

  const primaryText = typeof normalized.text === 'string' ? normalized.text.trim() : '';

  let segmentText = '';
  if (Array.isArray(normalized.segments)) {
    segmentText = normalized.segments
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
