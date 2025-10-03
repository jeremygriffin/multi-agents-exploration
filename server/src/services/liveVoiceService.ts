import type { InteractionLogger } from './interactionLogger';
import type { UsageLimitService } from './usageLimitService';

export interface LiveVoiceSessionRequest {
  conversationId: string;
  sessionId: string;
  ipAddress?: string;
}

export type LiveVoiceSessionOutcome =
  | {
      status: 'disabled';
      message: string;
    }
  | {
      status: 'pending';
      message: string;
      notes?: string;
    };

export class LiveVoiceService {
  private readonly enabled: boolean;

  constructor(private readonly usageLimits: UsageLimitService, private readonly logger: InteractionLogger) {
    this.enabled = process.env.ENABLE_VOICE_LIVE_MODE === 'true';
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async createSession(request: LiveVoiceSessionRequest): Promise<LiveVoiceSessionOutcome> {
    if (!this.isEnabled()) {
      return {
        status: 'disabled',
        message: 'Live voice mode is not enabled on this server.',
      };
    }

    // TODO: Usage limit integration, ephemeral token minting, and transcript piping
    await this.logger.append({
      timestamp: new Date().toISOString(),
      event: 'agent_response',
      conversationId: request.conversationId,
      sessionId: request.sessionId,
      agent: 'voice',
      ipAddress: request.ipAddress,
      payload: {
        source: 'voice_live',
        status: 'stub',
        message: 'Live voice session requested; awaiting WebRTC signaling implementation.',
      },
    });

    return {
      status: 'pending',
      message:
        'Live voice mode scaffolding active. WebRTC signaling will connect to OpenAI Realtime in a future update.',
      notes: 'Session tracking recorded. Awaiting offer/answer handshake implementation.',
    };
  }
}
