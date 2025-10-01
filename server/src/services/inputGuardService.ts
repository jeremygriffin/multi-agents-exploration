import OpenAI from 'openai';

import type { UploadedFile } from '../types';
import type { InteractionLogger } from './interactionLogger';

export type InputGuardSource = 'initial' | 'voice_transcription';

export interface InputGuardOptions {
  conversationId: string;
  message: string;
  attachments?: UploadedFile[];
  source: InputGuardSource;
}

interface ModerationCategoryScores {
  [category: string]: number;
}

interface ModerationResult {
  flagged: boolean;
  category_scores?: ModerationCategoryScores;
  categories?: Record<string, boolean>;
}

interface ModerationClient {
  create: (
    request: Parameters<OpenAI['moderations']['create']>[0]
  ) => Promise<{ results: ModerationResult[] }>;
}

export type InputGuardResultStatus = 'allow' | 'blocked' | 'needs_confirmation';

export interface InputGuardResult {
  status: InputGuardResultStatus;
  reason?: string;
  details?: Record<string, unknown>;
  userFeedback?: string;
}

const DEFAULT_ATTACHMENT_LIMIT_BYTES = 10 * 1024 * 1024; // 10MB default cap for uploads
const MIN_TRANSCRIPTION_LENGTH = 6; // characters; shorter transcripts are likely ambiguous

const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/mpeg',
  'audio/mp3',
]);

const defaultModerationThreshold = () => {
  const raw = process.env.INPUT_MODERATION_THRESHOLD;
  if (!raw) {
    return 0.5;
  }
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed)) {
    return 0.5;
  }
  return Math.min(Math.max(parsed, 0), 1);
};

const parseAttachmentLimit = () => {
  const raw = process.env.INPUT_ATTACHMENT_MAX_BYTES;
  if (!raw) {
    return DEFAULT_ATTACHMENT_LIMIT_BYTES;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_ATTACHMENT_LIMIT_BYTES;
  }
  return parsed;
};

const ensureOpenAIClient = (() => {
  let client: OpenAI | null = null;
  let moderation: ModerationClient | null = null;

  return () => {
    if (!client) {
      client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }

    if (!moderation) {
      moderation = client.moderations;
    }

    return moderation;
  };
})();

export class InputGuardService {
  private readonly moderationEnabled = process.env.ENABLE_INPUT_MODERATION === 'true';

  private readonly moderationThreshold = defaultModerationThreshold();

  private readonly transcriptionConfirmationEnabled =
    process.env.ENABLE_TRANSCRIPTION_CONFIRMATION === 'true';

  private readonly attachmentLimitBytes = parseAttachmentLimit();

  private moderationClient?: ModerationClient;

  constructor(private readonly logger: InteractionLogger, moderationClient?: ModerationClient) {
    this.moderationClient = moderationClient;
  }

  private async runModeration(text: string): Promise<ModerationResult | null> {
    if (!text.trim()) {
      return null;
    }

    try {
      const client = this.moderationClient ?? ensureOpenAIClient();
      const response = await client.create({
        model: 'omni-moderation-latest',
        input: text,
      });

      const [result] = response.results;
      return result ?? null;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[guardrails][input] moderation request failed', {
        error,
      });
      return null;
    }
  }

  private logGuardEvent(conversationId: string, payload: Record<string, unknown>): void {
    void this.logger.append({
      timestamp: new Date().toISOString(),
      event: 'guardrail',
      conversationId,
      agent: 'guardrail',
      payload,
    });
  }

  async evaluate(options: InputGuardOptions): Promise<InputGuardResult> {
    const { conversationId, message, attachments, source } = options;

    // eslint-disable-next-line no-console
    console.log('[guardrails][input] evaluating', {
      conversationId,
      source,
      messageLength: message.length,
      attachmentCount: attachments?.length ?? 0,
    });

    if (attachments && attachments.length > 0) {
      for (const attachment of attachments) {
        if (attachment.size > this.attachmentLimitBytes) {
          const feedback = `Attachment ${attachment.originalName} is too large. The current limit is ${this.attachmentLimitBytes} bytes.`;
          // eslint-disable-next-line no-console
          console.log('[guardrails][input] blocked attachment (size)', {
            conversationId,
            source,
            size: attachment.size,
            limit: this.attachmentLimitBytes,
          });

          this.logGuardEvent(conversationId, {
            stage: 'input',
            disposition: 'blocked',
            reason: 'attachment_size',
            source,
            attachment: {
              name: attachment.originalName,
              size: attachment.size,
              mimetype: attachment.mimetype,
            },
          });

          return {
            status: 'blocked',
            reason: 'attachment_size',
            details: {
              size: attachment.size,
              limit: this.attachmentLimitBytes,
            },
            userFeedback: feedback,
          };
        }

        const normalizedType = attachment.mimetype?.toLowerCase() ?? '';
        if (normalizedType && !ALLOWED_ATTACHMENT_TYPES.has(normalizedType)) {
          const feedback = `Attachment ${attachment.originalName} is not an allowed file type.`;
          // eslint-disable-next-line no-console
          console.log('[guardrails][input] blocked attachment (type)', {
            conversationId,
            source,
            mimetype: attachment.mimetype,
          });

          this.logGuardEvent(conversationId, {
            stage: 'input',
            disposition: 'blocked',
            reason: 'attachment_type',
            source,
            attachment: {
              name: attachment.originalName,
              mimetype: attachment.mimetype,
            },
          });

          return {
            status: 'blocked',
            reason: 'attachment_type',
            details: {
              mimetype: attachment.mimetype,
            },
            userFeedback: feedback,
          };
        }
      }
    }

    if (this.moderationEnabled) {
      const result = await this.runModeration(message);
      if (result) {
        const categoryScores = result.category_scores ?? {};
        const highestScore = Object.values(categoryScores).reduce((max, score) =>
          Math.max(max, score ?? 0), 0);

        if (result.flagged && highestScore >= this.moderationThreshold) {
          // eslint-disable-next-line no-console
          console.log('[guardrails][input] blocked by moderation', {
            conversationId,
            source,
            highestScore,
            threshold: this.moderationThreshold,
          });

          this.logGuardEvent(conversationId, {
            stage: 'input',
            disposition: 'blocked',
            reason: 'moderation',
            source,
            moderation: {
              highestScore,
              threshold: this.moderationThreshold,
              categories: result.categories,
              category_scores: result.category_scores,
            },
          });

          return {
            status: 'blocked',
            reason: 'moderation',
            details: {
              highestScore,
              threshold: this.moderationThreshold,
              categories: result.categories,
              category_scores: result.category_scores,
            },
            userFeedback: 'Sorry, I cannot help with that request.',
          };
        }
      }
    }

    if (
      source === 'voice_transcription' &&
      this.transcriptionConfirmationEnabled &&
      message.trim().length < MIN_TRANSCRIPTION_LENGTH
    ) {
      // eslint-disable-next-line no-console
      console.log('[guardrails][input] transcription flagged for confirmation', {
        conversationId,
        source,
        length: message.trim().length,
      });

      this.logGuardEvent(conversationId, {
        stage: 'input',
        disposition: 'needs_confirmation',
        reason: 'short_transcription',
        source,
        messageLength: message.trim().length,
      });

      return {
        status: 'needs_confirmation',
        reason: 'short_transcription',
        userFeedback: "I heard a very short transcription. Could you please confirm or repeat your request?",
      };
    }

    return { status: 'allow' };
  }
}
