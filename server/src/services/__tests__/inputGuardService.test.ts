import { describe, expect, beforeEach, afterEach, it, vi } from 'vitest';

import { InputGuardService } from '../inputGuardService';
import type { InteractionLogger } from '../interactionLogger';
import type { InputGuardOptions } from '../inputGuardService';

class StubLogger implements InteractionLogger {
  public entries: unknown[] = [];

  async append(entry: unknown): Promise<void> {
    this.entries.push(entry);
  }

  async read(): Promise<never[]> {
    throw new Error('Not implemented');
  }
}

describe('InputGuardService', () => {
  const originalEnv = { ...process.env };
  let logger: StubLogger;

  beforeEach(() => {
    logger = new StubLogger();
    process.env.ENABLE_INPUT_MODERATION = undefined;
    process.env.INPUT_MODERATION_THRESHOLD = undefined;
    process.env.ENABLE_TRANSCRIPTION_CONFIRMATION = undefined;
    process.env.INPUT_ATTACHMENT_MAX_BYTES = undefined;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const buildOptions = (overrides?: Partial<InputGuardOptions>): InputGuardOptions => ({
    conversationId: 'conversation-123',
    sessionId: overrides?.sessionId ?? 'session-123',
    message: overrides?.message ?? 'Hello world',
    source: overrides?.source ?? 'initial',
    ...(overrides?.ipAddress ? { ipAddress: overrides.ipAddress } : {}),
    ...(overrides?.attachments ? { attachments: overrides.attachments } : {}),
  });

  it('blocks attachments that exceed the configured size limit', async () => {
    process.env.INPUT_ATTACHMENT_MAX_BYTES = '100';

    const service = new InputGuardService(logger);

    const result = await service.evaluate(
      buildOptions({
        attachments: [
          {
            originalName: 'example.pdf',
            mimetype: 'application/pdf',
            buffer: Buffer.from('123'),
            size: 256,
          },
        ],
      })
    );

    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('attachment_size');
    const lastEntry = logger.entries[logger.entries.length - 1];
    expect(lastEntry).toMatchObject({
      event: 'guardrail',
      payload: expect.objectContaining({ reason: 'attachment_size' }),
    });
  });

  it('blocks attachments with unapproved mime types', async () => {
    const service = new InputGuardService(logger);

    const result = await service.evaluate(
      buildOptions({
        attachments: [
          {
            originalName: 'payload.exe',
            mimetype: 'application/octet-stream',
            buffer: Buffer.from('binary'),
            size: 10,
          },
        ],
      })
    );

    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('attachment_type');
  });

  it('blocks messages flagged by moderation over the threshold', async () => {
    process.env.ENABLE_INPUT_MODERATION = 'true';
    process.env.INPUT_MODERATION_THRESHOLD = '0.2';

    const moderationClient = {
      create: vi.fn().mockResolvedValue({
        results: [
          {
            flagged: true,
            category_scores: {
              hate: 0.25,
            },
            categories: {
              hate: true,
            },
          },
        ],
      }),
    };

    const service = new InputGuardService(logger, moderationClient as never);

    const result = await service.evaluate(buildOptions({ message: 'Bad content' }));

    expect(moderationClient.create).toHaveBeenCalledOnce();
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('moderation');
  });

  it('requests confirmation for short transcriptions when enabled', async () => {
    process.env.ENABLE_TRANSCRIPTION_CONFIRMATION = 'true';

    const service = new InputGuardService(logger);

    const result = await service.evaluate(
      buildOptions({
        message: 'yo',
        source: 'voice_transcription',
      })
    );

    expect(result.status).toBe('needs_confirmation');
    expect(result.reason).toBe('short_transcription');
  });

  it('allows messages that pass all checks', async () => {
    const service = new InputGuardService(logger);
    const result = await service.evaluate(buildOptions());
    expect(result.status).toBe('allow');
  });
});
