import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { UsageTracker } from '../usageTracker';
import { UsageLimitService } from '../usageLimitService';
import type { UsageLimitConfig } from '../../types';
import type { InteractionLogger } from '../interactionLogger';

class StubLogger implements InteractionLogger {
  public entries: unknown[] = [];

  async append(entry: unknown): Promise<void> {
    this.entries.push(entry);
  }

  async read(): Promise<never[]> {
    throw new Error('Not implemented');
  }
}

describe('UsageLimitService', () => {
  let tracker: UsageTracker;
  let logger: StubLogger;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'usage-limit-'));
    tracker = new UsageTracker(join(tempDir, 'usage.json'));
    await tracker.init();
    logger = new StubLogger();
  });

  afterEach(async () => {
    delete process.env.ENABLE_USAGE_LOGS;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('blocks session usage when the configured limit is exceeded', async () => {
    const config: UsageLimitConfig = {
      perSession: { message: 2 },
      perIp: {},
    };

    const service = new UsageLimitService(tracker, logger, config);

    const first = await service.consume('message', {
      sessionId: 'session-1',
    });
    expect(first.allowed).toBe(true);

    const second = await service.consume('message', {
      sessionId: 'session-1',
    });
    expect(second.allowed).toBe(true);

    const third = await service.consume('message', {
      sessionId: 'session-1',
    });
    expect(third.allowed).toBe(false);
    expect(third.limitType).toBe('session');
    expect(third.message).toContain('limit');
    const lastEntry = logger.entries[logger.entries.length - 1];
    expect(lastEntry).toMatchObject({
      payload: expect.objectContaining({
        stage: 'usage',
        event: 'message',
        disposition: 'blocked',
      }),
    });
  });

  it('enforces IP limits independently of session limits', async () => {
    const config: UsageLimitConfig = {
      perSession: {},
      perIp: { message: 1 },
    };

    const service = new UsageLimitService(tracker, logger, config);

    const allowed = await service.consume('message', {
      sessionId: 'session-a',
      ipAddress: '127.0.0.1',
    });
    expect(allowed.allowed).toBe(true);

    const blocked = await service.consume('message', {
      sessionId: 'session-b',
      ipAddress: '127.0.0.1',
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.limitType).toBe('ip');
  });

  it('records token usage and emits usage entries when enabled', async () => {
    process.env.ENABLE_USAGE_LOGS = 'true';

    const config: UsageLimitConfig = {
      perSession: {},
      perIp: {},
    };

    const service = new UsageLimitService(tracker, logger, config);

    await service.recordTokens('agent:greeting', {
      sessionId: 'session-token',
      conversationId: 'conversation-token',
    }, {
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
      model: 'gpt-4o-mini',
    });

    const usageSummary = await tracker.getTokenUsage({ sessionId: 'session-token' });
    expect(usageSummary.session.totalTokens).toBe(20);

    const usageEntries = logger.entries.filter((entry) =>
      typeof entry === 'object' && entry !== null && (entry as { event?: string }).event === 'usage'
    );
    expect(usageEntries.length).toBe(1);
    expect(usageEntries[0]).toMatchObject({
      payload: expect.objectContaining({
        category: 'tokens',
        origin: 'agent:greeting',
      }),
    });
  });
});
