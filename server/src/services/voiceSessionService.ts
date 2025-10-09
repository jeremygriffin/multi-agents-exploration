import OpenAI from 'openai';
import type { SessionCreateParams, SessionCreateResponse } from 'openai/resources/beta/realtime/sessions';

import type { Orchestrator } from '../orchestrator';
import type { InteractionLogger } from './interactionLogger';
import { VoiceRealtimeBridge } from './voiceRealtimeBridge';
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
    private readonly logger: InteractionLogger,
    private readonly bridge: VoiceRealtimeBridge
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

    const parseNumber = (value: string | undefined, fallback: number): number => {
      if (!value) {
        return fallback;
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

    const vadThreshold = clamp(parseNumber(process.env.OPENAI_REALTIME_VAD_THRESHOLD, 0.7), 0, 1);
    const vadSilenceMs = Math.max(parseNumber(process.env.OPENAI_REALTIME_VAD_SILENCE_MS, 900), 250);
    const vadPrefixMs = Math.max(parseNumber(process.env.OPENAI_REALTIME_VAD_PREFIX_MS, 150), 0);

    const noiseReduction = (() => {
      const setting = process.env.OPENAI_REALTIME_NOISE_REDUCTION?.toLowerCase();
      return setting === 'near_field' || setting === 'far_field' ? setting : 'far_field';
    })();

    const rawModalities = (process.env.OPENAI_REALTIME_MODALITIES ?? 'audio,text')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0);
    const modalities = rawModalities.filter((value): value is 'audio' | 'text' => value === 'audio' || value === 'text');

    const instructions = process.env.OPENAI_REALTIME_INSTRUCTIONS;
    const transcriptionModel =
      process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL ?? 'gpt-4o-mini-transcribe';
    const transcriptionLanguage = process.env.OPENAI_REALTIME_TRANSCRIPTION_LANGUAGE ?? 'en';

    let realtimeSession: SessionCreateResponse;

    try {
      realtimeSession = await this.client.beta.realtime.sessions.create({
        model,
        modalities: modalities.length > 0 ? modalities : ['audio', 'text'],
        voice,
        turn_detection: {
          type: 'server_vad',
          create_response: false,
          threshold: vadThreshold,
          silence_duration_ms: vadSilenceMs,
          prefix_padding_ms: vadPrefixMs,
        },
        input_audio_noise_reduction: { type: noiseReduction as 'near_field' | 'far_field' },
        input_audio_transcription: {
          model: transcriptionModel,
          ...(transcriptionLanguage ? { language: transcriptionLanguage } : {}),
        },
        ...(instructions ? { instructions } : {}),
      });
    } catch (error) {
      const fallbackMessage = 'Failed to create realtime session';
      const message = error instanceof Error ? error.message : fallbackMessage;

      const apiError = error instanceof OpenAI.APIError ? error : null;
      const errorPayload = apiError
        ? {
            status: apiError.status,
            code: apiError.code,
            type: apiError.type,
            param: apiError.param,
          }
        : { kind: typeof error, value: error };

      console.error('[voiceSession] realtime session creation failed', {
        conversationId,
        sessionId,
        message,
        ...errorPayload,
      });

      try {
        await this.logger.append({
          timestamp: new Date().toISOString(),
          event: 'voice_session_error',
          conversationId,
          sessionId,
          ...(ipAddress ? { ipAddress } : {}),
          payload: {
            action: 'create_failed',
            message,
            ...errorPayload,
          },
        });
      } catch (logError) {
        console.warn('[voiceSession] failed to log voice session error', logError);
      }

      throw new VoiceSessionError(message, 502);
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

    this.bridge.start({
      conversationId,
      sessionId,
      grant,
    });

    return grant;
  }
}
