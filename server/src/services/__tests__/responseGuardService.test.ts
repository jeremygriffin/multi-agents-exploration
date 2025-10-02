import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { InteractionLogger } from '../interactionLogger';
import { ResponseGuardService } from '../responseGuardService';

class StubLogger implements InteractionLogger {
  public entries: unknown[] = [];

  async append(entry: unknown): Promise<void> {
    this.entries.push(entry);
  }

  async read(): Promise<never[]> {
    throw new Error('Not implemented');
  }
}

class StubAgent {
  constructor(private readonly payloads: string[]) {}

  async createChatCompletion(): Promise<{ choices: string[] }> {
    const payload = this.payloads.shift() ?? '{}';
    return { choices: [payload] };
  }
}

describe('ResponseGuardService', () => {
  const originalEnv = { ...process.env };
  let logger: StubLogger;

  beforeEach(() => {
    logger = new StubLogger();
    process.env.ENABLE_RESPONSE_GUARD = 'true';
    process.env.RESPONSE_GUARD_AGENTS = 'time_helper,document_store';
    process.env.RESPONSE_GUARD_RECOVERY = 'clarify';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('identifies eligible agents', () => {
    const service = new ResponseGuardService(logger, new StubAgent([]) as unknown as any);
    expect(service.shouldEvaluate('time_helper')).toBe(true);
    expect(service.shouldEvaluate('greeting')).toBe(false);
  });

  it('parses successful guard evaluations', async () => {
    const agent = new StubAgent([
      JSON.stringify({ status: 'mismatch', confidence: 0.2, reason: 'Wrong city', follow_up: 'Ask for clarification.' }),
    ]);
    const service = new ResponseGuardService(logger, agent as unknown as any);

    const result = await service.evaluate({
      conversationId: 'c1',
      agentId: 'time_helper',
      userMessage: 'What time is it in Seattle?',
      agentResponse: 'The time in Portland is...'
    });

    expect(result.status).toBe('mismatch');
    expect(result.reason).toContain('Wrong city');
    const lastEntry = logger.entries[logger.entries.length - 1];
    expect(lastEntry).toMatchObject({
      event: 'guardrail',
      payload: expect.objectContaining({
        stage: 'response',
        disposition: 'mismatch',
      }),
    });
  });

  it('returns error status when JSON parsing fails', async () => {
    const agent = new StubAgent(['not-json']);
    const service = new ResponseGuardService(logger, agent as unknown as any);

    const result = await service.evaluate({
      conversationId: 'c2',
      agentId: 'time_helper',
      userMessage: 'question',
      agentResponse: 'answer',
    });

    expect(result.status).toBe('error');
    const lastEntry = logger.entries[logger.entries.length - 1];
    expect(lastEntry).toMatchObject({
      payload: expect.objectContaining({ reason: 'parse_failure' }),
    });
  });
});
