import { writeFile } from 'fs/promises';
import { join } from 'path';

import type { Agent, AgentContext, AgentResult } from './baseAgent';
import {
  createTranscriptFilename,
  persistAudioBuffer,
  transcodeAudio,
  validateAudioMimeType,
} from '../services/audioService';
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

    const transcriptContent = buildTranscriptPlaceholder(attachment.originalName);
    const storageDir = await ensureStorageDir();
    const transcriptName = createTranscriptFilename(persisted.storedName);
    const transcriptPath = join(storageDir, transcriptName);
    await writeFile(transcriptPath, transcriptContent, 'utf8');

    const base64Audio = transcoded.buffer.toString('base64');
    const audioPayload: NonNullable<AgentResult['audio']> = {
      mimeType: transcoded.mimeType,
      base64Data: base64Audio,
    };

    if (transcoded.note) {
      audioPayload.description = transcoded.note;
    }

    return {
      content: `Received your audio clip (${attachment.originalName}). A placeholder transcript has been stored while speech-to-text integration is pending.`,
      audio: audioPayload,
      debug: {
        storedAudio: persisted.storedPath,
        transcriptPath,
        validation,
        transcoding: {
          format: transcoded.format,
          note: transcoded.note,
        },
      },
    };
  }
}
