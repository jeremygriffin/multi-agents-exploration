import { OpenAIAgent } from 'openai-agents';
import { z } from 'zod';

import type { AgentId } from '../types';
import type { InteractionLogger } from './interactionLogger';
import { buildOpenAIClientOptions } from '../config/openaiConfig';

const ResponseGuardSchema = z.object({
  status: z.enum(['ok', 'mismatch']).default('ok'),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
  follow_up: z.string().optional(),
});

const isTestEnvironment = () =>
  process.env.NODE_ENV === 'test' || typeof process.env.VITEST_WORKER_ID !== 'undefined';

const debugLog = (...args: Parameters<typeof console.log>) => {
  if (!isTestEnvironment()) {
    console.log(...args);
  }
};

const errorLog = (...args: Parameters<typeof console.error>) => {
  if (!isTestEnvironment()) {
    console.error(...args);
  }
};

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
  sessionId: string;
  agentId: Exclude<AgentId, 'manager'>;
  userMessage: string;
  agentResponse: string;
  attempt?: 'initial' | 'retry';
  ipAddress?: string;
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
        system_instruction: `You validate whether specialist agent responses resolve user requests.
Return ONLY JSON matching the schema {"status": "ok" | "mismatch", "confidence": number (0-1, optional), "reason": string, "follow_up": string}.
Treat a response as acceptable (status "ok") when the agent politely asks for missing information that is required to complete the task (for example, asking the user to specify a location before giving the time).`,
      }, buildOpenAIClientOptions());
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
    sessionId: string,
    payload: Record<string, unknown>,
    ipAddress?: string
  ): void {
    void this.logger.append({
      timestamp: new Date().toISOString(),
      event: 'guardrail',
      conversationId,
      sessionId,
      ...(ipAddress ? { ipAddress } : {}),
      agent: 'guardrail',
      payload,
    });
  }

  async evaluate(options: ResponseGuardEvaluateOptions): Promise<ResponseGuardEvaluation> {
    const { conversationId, sessionId, agentId, userMessage, agentResponse, attempt = 'initial', ipAddress } = options;

    debugLog('[guardrails][response] evaluating', {
      conversationId,
      sessionId,
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
        errorLog('[guardrails][response] parsing failure', { raw, error });
        this.logGuardEvent(conversationId, sessionId, {
          stage: 'response',
          agentId,
          attempt,
          disposition: 'error',
          reason: 'parse_failure',
          raw,
        }, ipAddress);
        return {
          status: 'error',
          rawOutput: raw,
        };
      }

      const evaluation: ResponseGuardEvaluation = {
        status: parsed.status,
        rawOutput: raw,
      };

      if (typeof parsed.confidence === 'number') {
        evaluation.confidence = parsed.confidence;
      }

      if (typeof parsed.reason === 'string' && parsed.reason.trim().length > 0) {
        evaluation.reason = parsed.reason.trim();
      }

      if (typeof parsed.follow_up === 'string' && parsed.follow_up.trim().length > 0) {
        evaluation.followUp = parsed.follow_up.trim();
      }

      this.logGuardEvent(conversationId, sessionId, {
        stage: 'response',
        agentId,
        attempt,
        disposition: parsed.status,
        ...(typeof parsed.confidence === 'number' ? { confidence: parsed.confidence } : {}),
        ...(parsed.reason ? { reason: parsed.reason } : {}),
        ...(parsed.follow_up ? { follow_up: parsed.follow_up } : {}),
      }, ipAddress);

      return evaluation;
    } catch (error) {
      errorLog('[guardrails][response] evaluation error', {
        conversationId,
        agentId,
        attempt,
        error,
      });

      this.logGuardEvent(conversationId, sessionId, {
        stage: 'response',
        agentId,
        attempt,
        disposition: 'error',
        reason: 'request_failed',
        error,
      }, ipAddress);

      return {
        status: 'error',
      };
    }
  }
}
