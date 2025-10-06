import type { SessionCreateParams, SessionCreateResponse } from 'openai/resources/beta/realtime/sessions';

import type { Orchestrator } from '../orchestrator';
import type { InteractionLogger } from './interactionLogger';
import { getOpenAIClient } from './speechService';
import type { VoiceSessionGrant } from '../types';

export class VoiceSessionError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'VoiceSessionError';
  }
}

interface CreateVoiceSessionOptions {
  conversationId: string;
  sessionId: string;
  ipAddress?: string;
  userAgent?: string;
}

export class VoiceSessionService {
  private readonly client = getOpenAIClient();

  constructor(
    private readonly orchestrator: Orchestrator,
    private readonly logger: InteractionLogger
  ) {}

  async createVoiceSession(options: CreateVoiceSessionOptions): Promise<VoiceSessionGrant> {
    const { conversationId, sessionId, ipAddress, userAgent } = options;

    const conversation = this.orchestrator.getConversation(conversationId);

    if (!conversation) {
      throw new VoiceSessionError('Conversation not found', 404);
    }

    if (conversation.sessionId !== sessionId) {
      throw new VoiceSessionError('Conversation does not belong to the active session', 403);
    }

    const defaultModel = 'gpt-4o-realtime-preview' satisfies NonNullable<SessionCreateParams['model']>;
    const defaultVoice = 'verse' satisfies NonNullable<SessionCreateParams['voice']>;

    const model = (process.env.OPENAI_REALTIME_MODEL as SessionCreateParams['model'] | undefined) ?? defaultModel;
    const voice = (process.env.OPENAI_REALTIME_VOICE as SessionCreateParams['voice'] | undefined) ?? defaultVoice;

    const rawModalities = (process.env.OPENAI_REALTIME_MODALITIES ?? 'audio,text')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0);
    const modalities = rawModalities.filter((value): value is 'audio' | 'text' => value === 'audio' || value === 'text');

    const instructions = process.env.OPENAI_REALTIME_INSTRUCTIONS;

    let realtimeSession: SessionCreateResponse;

    try {
      realtimeSession = await this.client.beta.realtime.sessions.create({
        model,
        modalities: modalities.length > 0 ? modalities : ['audio', 'text'],
        voice,
        ...(instructions ? { instructions } : {}),
      });
    } catch (error) {
      throw new VoiceSessionError(
        error instanceof Error ? error.message : 'Failed to create realtime session',
        502
      );
    }

    const sessionDetails = realtimeSession as SessionCreateResponse & {
      id?: string;
      model?: string;
      voice?: string;
      instructions?: string;
      ice_servers?: VoiceSessionGrant['iceServers'];
    };

    const iceServers = sessionDetails.ice_servers;
    const resolvedInstructions = sessionDetails.instructions ?? instructions;

    const grant: VoiceSessionGrant = {
      conversationId,
      userSessionId: sessionId,
      ...(sessionDetails.id ? { realtimeSessionId: sessionDetails.id } : {}),
      ...(sessionDetails.model ? { model: sessionDetails.model } : { model }),
      ...(sessionDetails.voice ? { voice: sessionDetails.voice } : { voice }),
      expiresAt: realtimeSession.client_secret.expires_at,
      clientSecret: realtimeSession.client_secret.value,
      ...(iceServers ? { iceServers } : {}),
    };

    if (typeof resolvedInstructions === 'string' && resolvedInstructions.length > 0) {
      grant.instructions = resolvedInstructions;
    }

    await this.logger.append({
      timestamp: new Date().toISOString(),
      event: 'voice_session',
      conversationId,
      sessionId,
      ...(ipAddress ? { ipAddress } : {}),
      payload: {
        action: 'created',
        realtimeSessionId: sessionDetails.id,
        expiresAt: realtimeSession.client_secret.expires_at,
        model: grant.model,
        voice: grant.voice,
        userAgent,
      },
    });

    return grant;
  }
}
