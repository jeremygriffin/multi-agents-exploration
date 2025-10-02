import type { InteractionLogger } from './interactionLogger';
import type { UsageTracker, UsageCountContext, UsageRecordContext } from './usageTracker';
import type { UsageEvent, UsageLimitConfig } from '../types';

const isTestEnvironment = () =>
  process.env.NODE_ENV === 'test' || typeof process.env.VITEST_WORKER_ID !== 'undefined';

const DEFAULT_LIMITS = {
  messageSession: 200,
  messageIp: 400,
  fileSession: 20,
  fileIp: 40,
  audioSession: 50,
  audioIp: 80,
  ttsSession: 200,
  ttsIp: 400,
} as const;

const parseLimit = (envName: string, fallback: number): number | undefined => {
  const raw = process.env[envName];
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
};

export const buildUsageLimitConfigFromEnv = (): UsageLimitConfig => ({
  perSession: {
    message: parseLimit('USAGE_LIMIT_MESSAGES_PER_SESSION', DEFAULT_LIMITS.messageSession),
    file_upload: parseLimit('USAGE_LIMIT_FILE_UPLOADS_PER_SESSION', DEFAULT_LIMITS.fileSession),
    audio_transcription: parseLimit(
      'USAGE_LIMIT_AUDIO_TRANSCRIPTIONS_PER_SESSION',
      DEFAULT_LIMITS.audioSession
    ),
    tts_generation: parseLimit('USAGE_LIMIT_TTS_PER_SESSION', DEFAULT_LIMITS.ttsSession),
  },
  perIp: {
    message: parseLimit('USAGE_LIMIT_MESSAGES_PER_IP', DEFAULT_LIMITS.messageIp),
    file_upload: parseLimit('USAGE_LIMIT_FILE_UPLOADS_PER_IP', DEFAULT_LIMITS.fileIp),
    audio_transcription: parseLimit(
      'USAGE_LIMIT_AUDIO_TRANSCRIPTIONS_PER_IP',
      DEFAULT_LIMITS.audioIp
    ),
    tts_generation: parseLimit('USAGE_LIMIT_TTS_PER_IP', DEFAULT_LIMITS.ttsIp),
  },
});

const eventLabels: Record<UsageEvent, string> = {
  message: 'messages',
  file_upload: 'file uploads',
  audio_transcription: 'audio transcriptions',
  tts_generation: 'text-to-speech responses',
};

const logDebug = (...args: Parameters<typeof console.log>) => {
  if (!isTestEnvironment()) {
    console.log(...args);
  }
};

export interface UsageContext extends UsageCountContext {
  conversationId?: string;
  units?: number;
}

export interface UsageDecision {
  allowed: boolean;
  event: UsageEvent;
  limitType?: 'session' | 'ip';
  limit?: number;
  remaining?: number;
  message?: string;
}

const toUserMessage = (event: UsageEvent, limitType: 'session' | 'ip'): string => {
  const scope = limitType === 'session' ? 'this session' : 'your network connection';
  return `Daily ${eventLabels[event]} limit reached for ${scope}. Please try again tomorrow.`;
};

export class UsageLimitService {
  constructor(
    private readonly tracker: UsageTracker,
    private readonly logger: InteractionLogger,
    private readonly config: UsageLimitConfig
  ) {}

  describeLimits(): UsageLimitConfig {
    return this.config;
  }

  async consume(event: UsageEvent, context: UsageContext): Promise<UsageDecision> {
    const units = context.units ?? 1;
    const counts = await this.tracker.getCount(event, {
      sessionId: context.sessionId,
      ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
    });

    const sessionLimit = this.config.perSession[event];
    const ipLimit = this.config.perIp[event];

    const nextSessionCount = counts.session + units;
    if (typeof sessionLimit === 'number' && nextSessionCount > sessionLimit) {
      const decision = this.block(event, 'session', sessionLimit, counts.session, context);
      return decision;
    }

    const ipCount = counts.ip ?? 0;
    const nextIpCount = ipCount + units;
    if (typeof ipLimit === 'number' && nextIpCount > ipLimit) {
      const decision = this.block(event, 'ip', ipLimit, ipCount, context);
      return decision;
    }

    const recordContext: UsageRecordContext = {
      event,
      sessionId: context.sessionId,
      units,
      ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
    };

    await this.tracker.record(recordContext);

    const decision: UsageDecision = {
      allowed: true,
      event,
    };

    if (typeof sessionLimit === 'number') {
      decision.remaining = sessionLimit - nextSessionCount;
    }

    return decision;
  }

  private block(
    event: UsageEvent,
    limitType: 'session' | 'ip',
    limit: number,
    current: number,
    context: UsageContext
  ): UsageDecision {
    const conversationId = context.conversationId ?? context.sessionId;

    logDebug('[usage][blocked]', {
      event,
      limitType,
      limit,
      current,
      sessionId: context.sessionId,
      ipAddress: context.ipAddress,
    });

    void this.logger.append({
      timestamp: new Date().toISOString(),
      event: 'guardrail',
      conversationId,
      sessionId: context.sessionId,
      ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
      agent: 'guardrail',
      payload: {
        stage: 'usage',
        disposition: 'blocked',
        event,
        limitType,
        limit,
        current,
      },
    });

    return {
      allowed: false,
      event,
      limitType,
      limit,
      remaining: Math.max(limit - current, 0),
      message: toUserMessage(event, limitType),
    } satisfies UsageDecision;
  }
}
