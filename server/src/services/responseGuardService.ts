import { OpenAIAgent } from 'openai-agents';
import { z } from 'zod';

import type { AgentId } from '../types';
import type { InteractionLogger } from './interactionLogger';

const ResponseGuardSchema = z.object({
  status: z.enum(['ok', 'mismatch']).default('ok'),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
  follow_up: z.string().optional(),
});

export type ResponseGuardEvaluationStatus = 'ok' | 'mismatch' | 'error';

export type ResponseGuardRecoveryStrategy = 'clarify' | 'retry' | 'log_only';

export interface ResponseGuardEvaluation {
  status: ResponseGuardEvaluationStatus;
  confidence?: number;
  reason?: string;
  followUp?: string;
  rawOutput?: string;
}

interface ResponseGuardEvaluateOptions {
  conversationId: string;
  agentId: Exclude<AgentId, 'manager'>;
  userMessage: string;
  agentResponse: string;
  attempt?: 'initial' | 'retry';
}

const parseConfiguredAgents = () => {
  const raw = process.env.RESPONSE_GUARD_AGENTS ?? 'time_helper';
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
};

const parseRecoveryStrategy = (): ResponseGuardRecoveryStrategy => {
  const raw = (process.env.RESPONSE_GUARD_RECOVERY ?? 'clarify').toLowerCase();
  if (raw === 'retry' || raw === 'log_only') {
    return raw;
  }
  return 'clarify';
};

export class ResponseGuardService {
  private readonly enabled = process.env.ENABLE_RESPONSE_GUARD === 'true';

  private readonly eligibleAgents = new Set(parseConfiguredAgents());

  private readonly recoveryStrategy: ResponseGuardRecoveryStrategy = parseRecoveryStrategy();

  private readonly agent: OpenAIAgent;

  constructor(private readonly logger: InteractionLogger, agent?: OpenAIAgent) {
    this.agent =
      agent ??
      new OpenAIAgent({
        model: process.env.RESPONSE_GUARD_MODEL ?? 'gpt-4o-mini',
        temperature: 0,
        system_instruction:
          'You validate whether specialist agent responses resolve user requests. Respond ONLY with JSON matching the schema {"status": "ok" | "mismatch", "confidence": number (0-1, optional), "reason": string, "follow_up": string}.',
      });
  }

  shouldEvaluate(agentId: AgentId): agentId is Exclude<AgentId, 'manager'> {
    if (!this.enabled) {
      return false;
    }
    return this.eligibleAgents.has(agentId);
  }

  getRecoveryStrategy(): ResponseGuardRecoveryStrategy {
    return this.recoveryStrategy;
  }

  private logGuardEvent(
    conversationId: string,
    payload: Record<string, unknown>
  ): void {
    void this.logger.append({
      timestamp: new Date().toISOString(),
      event: 'guardrail',
      conversationId,
      agent: 'guardrail',
      payload,
    });
  }

  async evaluate(options: ResponseGuardEvaluateOptions): Promise<ResponseGuardEvaluation> {
    const { conversationId, agentId, userMessage, agentResponse, attempt = 'initial' } = options;

    // eslint-disable-next-line no-console
    console.log('[guardrails][response] evaluating', {
      conversationId,
      agentId,
      attempt,
    });

    if (!this.enabled) {
      return { status: 'ok' };
    }

    const prompt = `User request:\n${userMessage}\n\nAgent (${agentId}) response:\n${agentResponse}\n\nTask: Does the response fully satisfy the user request? Return valid JSON with keys status, confidence, reason, follow_up.`;

    try {
      const result = await this.agent.createChatCompletion(prompt);
      const raw = result.choices[0] ?? '';

      let parsed: z.infer<typeof ResponseGuardSchema> | null = null;

      try {
        parsed = ResponseGuardSchema.parse(JSON.parse(raw));
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[guardrails][response] parsing failure', { raw, error });
        this.logGuardEvent(conversationId, {
          stage: 'response',
          agentId,
          attempt,
          disposition: 'error',
          reason: 'parse_failure',
          raw,
        });
        return {
          status: 'error',
          rawOutput: raw,
        };
      }

      const evaluation: ResponseGuardEvaluation = {
        status: parsed.status,
        confidence: parsed.confidence,
        reason: parsed.reason,
        followUp: parsed.follow_up,
        rawOutput: raw,
      };

      this.logGuardEvent(conversationId, {
        stage: 'response',
        agentId,
        attempt,
        disposition: parsed.status,
        confidence: parsed.confidence,
        reason: parsed.reason,
        follow_up: parsed.follow_up,
      });

      return evaluation;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[guardrails][response] evaluation error', {
        conversationId,
        agentId,
        attempt,
        error,
      });

      this.logGuardEvent(conversationId, {
        stage: 'response',
        agentId,
        attempt,
        disposition: 'error',
        reason: 'request_failed',
        error,
      });

      return {
        status: 'error',
      };
    }
  }
}
