import { writeFile } from 'fs/promises';
import { join } from 'path';

import type { Agent, AgentContext, AgentResult } from './baseAgent';
import {
  createTranscriptFilename,
  persistAudioBuffer,
  transcodeAudio,
  validateAudioMimeType,
} from '../services/audioService';
import { transcribeAudio, type TranscriptionError } from '../services/speechService';
import { ensureStorageDir } from '../utils/fileUtils';

const isAudioAttachment = (mimetype: string | undefined): boolean =>
  typeof mimetype === 'string' && mimetype.toLowerCase().startsWith('audio/');

const buildTranscriptPlaceholder = (originalName: string): string =>
  `# Transcript Placeholder\n\n- Source file: ${originalName}\n- Status: Pending transcription integration.\n\n_No automated speech-to-text has been run yet._`;

export class VoiceAgent implements Agent {
  readonly id = 'voice';

  readonly name = 'Voice Agent';

  async handle(context: AgentContext): Promise<AgentResult> {
    const attachment = context.attachments?.find((file) => isAudioAttachment(file.mimetype));

    if (!attachment) {
      return {
        content: 'I did not receive an audio attachment to process.',
        debug: { attachments: context.attachments?.map((file) => file.mimetype) ?? [] },
      };
    }

    const validation = validateAudioMimeType(attachment.mimetype);

    if (!validation.ok) {
      return {
        content: `I cannot process this audio type yet (${attachment.mimetype}). Please upload one of the supported formats.`,
        debug: { reason: validation.reason },
      };
    }

    const transcoded = await transcodeAudio(attachment.buffer, validation.mimeType);
    const persisted = await persistAudioBuffer(transcoded.buffer, attachment.originalName);
    const storageDir = await ensureStorageDir();
    const transcriptName = createTranscriptFilename(persisted.storedName);
    const transcriptPath = join(storageDir, transcriptName);

    let transcriptText = '';
    let transcriptionError: string | undefined;
    let transcriptionMetadata: Record<string, unknown> | undefined;

    let rateLimitHit = false;

    try {
      const transcription = await transcribeAudio(transcoded.buffer, attachment.originalName, transcoded.mimeType);
      transcriptText = transcription.text;

      const transcriptContent = `# Transcript\n\n${transcriptText}`;
      await writeFile(transcriptPath, transcriptContent, 'utf8');
    } catch (error) {
      const typedError = error as TranscriptionError;
      transcriptionError = typedError instanceof Error ? typedError.message : 'Unknown transcription error';
      transcriptionMetadata = {
        status: typedError.status,
        details: typedError.details,
      };

      if (typedError.status === 429) {
        rateLimitHit = true;
      }

      const detailsNote = JSON.stringify(transcriptionMetadata, null, 2);
      const transcriptContent = `${buildTranscriptPlaceholder(attachment.originalName)}\n\n_Error: ${transcriptionError}_\n\n${detailsNote ? `Details: ${detailsNote}` : ''}`.trim();
      await writeFile(transcriptPath, transcriptContent, 'utf8');
    }

    const base64Audio = transcoded.buffer.toString('base64');
    const audioPayload: NonNullable<AgentResult['audio']> = {
      mimeType: transcoded.mimeType,
      base64Data: base64Audio,
    };

    if (transcoded.note) {
      audioPayload.description = transcoded.note;
    }

    if (!transcriptText) {
      const fallbackMessage = rateLimitHit
        ? `I received your audio clip (${attachment.originalName}), but the transcription service reported an API quota limit (HTTP 429). Please update your OpenAI key or try again later.`
        : `Received your audio clip (${attachment.originalName}), but transcription is not available yet. Please try again later.`;

      return {
        content: fallbackMessage,
        audio: audioPayload,
        debug: {
          storedAudio: persisted.storedPath,
          transcriptPath,
          validation,
          transcoding: {
            format: transcoded.format,
            note: transcoded.note,
          },
          transcriptionError,
          transcriptionMetadata,
          rateLimitHit,
        },
      };
    }

    return {
      content: `Transcribed your audio clip (${attachment.originalName}): ${transcriptText}`,
      audio: audioPayload,
      debug: {
        storedAudio: persisted.storedPath,
        transcriptPath,
        validation,
        transcoding: {
          format: transcoded.format,
          note: transcoded.note,
        },
        transcriptionLength: transcriptText.length,
        transcriptionMetadata,
      },
      handoffUserMessage: transcriptText,
    };
  }
}
