import { randomUUID } from 'crypto';

import type { Orchestrator } from '../orchestrator';
import type { ConversationLogEntry } from '../types';
import type { UsageLimitService } from './usageLimitService';
import type { InteractionLogger } from './interactionLogger';
import {
  OpenAiRealtimeClient,
  type RealtimeEvent,
  type RealtimeSession,
  type SessionDescription,
} from './openAiRealtimeClient';

export interface LiveVoiceSessionRequest {
  conversationId: string;
  sessionId: string;
  ipAddress?: string;
}

export interface LiveVoiceOfferRequest {
  conversationId: string;
  sessionId: string;
  sdp?: string;
  type?: SessionDescription['type'];
  ipAddress?: string;
}

export type LiveVoiceSessionOutcome =
  | {
      status: 'disabled';
      message: string;
    }
  | {
      status: 'blocked';
      message: string;
    }
  | {
      status: 'ready';
      message: string;
      session: LiveVoiceSessionDetails;
    };

export interface LiveVoiceSessionDetails {
  id: string;
  conversationId: string;
  model: string;
  iceServers: RealtimeSession['iceServers'];
  clientSecret: string;
  clientSecretExpiresAt?: number;
  expiresAt?: number;
}

interface StoredLiveSession extends LiveVoiceSessionDetails {
  sessionId: string;
  ipAddress?: string;
  createdAt: number;
  lastActivityAt: number;
  openAiSessionId: string;
  transcriptBuffer: string;
  abortController?: AbortController;
}

type TranscriptHandler = (text: string) => Promise<void>;

export class LiveVoiceService {
  private readonly enabled: boolean;

  private readonly realtimeClient: OpenAiRealtimeClient | null;

  private readonly sessions = new Map<string, StoredLiveSession>();

  constructor(
    private readonly orchestrator: Orchestrator,
    private readonly usageLimits: UsageLimitService,
    private readonly logger: InteractionLogger
  ) {
    this.enabled = process.env.ENABLE_VOICE_LIVE_MODE === 'true';
    const model = process.env.OPENAI_REALTIME_MODEL ?? 'gpt-4o-realtime-preview';
    const voice = process.env.OPENAI_REALTIME_VOICE;
    const instructions = process.env.OPENAI_REALTIME_INSTRUCTIONS;
    const modalitiesEnv = process.env.OPENAI_REALTIME_MODALITIES;
    const modalities = modalitiesEnv?.split(',').map((value) => value.trim()).filter(Boolean);

    const apiKey = process.env.OPENAI_API_KEY;
    if (this.enabled && !apiKey) {
      throw new Error('OPENAI_API_KEY is required when ENABLE_VOICE_LIVE_MODE=true');
    }

    this.realtimeClient = apiKey
      ? new OpenAiRealtimeClient(apiKey, {
          model,
          ...(voice ? { voice } : {}),
          ...(instructions ? { instructions } : {}),
          ...(modalities && modalities.length > 0 ? { modalities } : {}),
        })
      : null;
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

    const usageDecision = await this.usageLimits.consume('audio_transcription', {
      sessionId: request.sessionId,
      conversationId: request.conversationId,
      ...(request.ipAddress ? { ipAddress: request.ipAddress } : {}),
      units: 1,
    });

    if (!usageDecision.allowed) {
      const message = usageDecision.message ??
        'Live voice mode is temporarily unavailable due to usage limits. Please try again later.';

      await this.appendLifecycleLog(request, {
        stage: 'limit_blocked',
        allowed: false,
        limitType: usageDecision.limitType,
      });

      return {
        status: 'blocked',
        message,
      };
    }

    if (!this.realtimeClient) {
      throw new Error('Realtime client unavailable. Check server configuration.');
    }

    const session = await this.realtimeClient.createSession();

    const stored: StoredLiveSession = {
      id: randomUUID(),
      conversationId: request.conversationId,
      sessionId: request.sessionId,
      model: session.model,
      iceServers: session.iceServers,
      clientSecret: session.clientSecret.value,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      openAiSessionId: session.id,
      transcriptBuffer: '',
      ...(request.ipAddress ? { ipAddress: request.ipAddress } : {}),
      ...(typeof session.clientSecret.expiresAt === 'number'
        ? { clientSecretExpiresAt: session.clientSecret.expiresAt }
        : {}),
      ...(typeof session.expiresAt === 'number' ? { expiresAt: session.expiresAt } : {}),
    };

    this.sessions.set(request.conversationId, stored);

    await this.appendLifecycleLog(request, {
      stage: 'session_created',
      allowed: true,
      model: session.model,
      ...(typeof session.expiresAt === 'number' ? { expiresAt: session.expiresAt } : {}),
      ...(typeof session.clientSecret.expiresAt === 'number'
        ? { clientSecretExpiresAt: session.clientSecret.expiresAt }
        : {}),
      iceServers: session.iceServers.length,
    });

    return {
      status: 'ready',
      message: 'Live voice session ready. Complete the WebRTC handshake to begin streaming.',
      session: {
        id: stored.id,
        conversationId: stored.conversationId,
        model: stored.model,
        iceServers: stored.iceServers,
        clientSecret: stored.clientSecret,
        ...(typeof stored.clientSecretExpiresAt === 'number'
          ? { clientSecretExpiresAt: stored.clientSecretExpiresAt }
          : {}),
        ...(typeof stored.expiresAt === 'number' ? { expiresAt: stored.expiresAt } : {}),
      },
    };
  }

  async handleOffer(request: LiveVoiceOfferRequest): Promise<void> {
    if (!this.isEnabled()) {
      throw new Error('Live voice mode is disabled.');
    }

    const stored = this.sessions.get(request.conversationId);
    if (!stored) {
      throw new Error('No live session found for conversation');
    }

    if (stored.sessionId !== request.sessionId) {
      throw new Error('Live session does not belong to the active session.');
    }

    if (!this.realtimeClient) {
      throw new Error('Realtime client unavailable. Check server configuration.');
    }

    stored.lastActivityAt = Date.now();

    const logContext: LiveVoiceSessionRequest = {
      conversationId: stored.conversationId,
      sessionId: stored.sessionId,
      ...(stored.ipAddress ? { ipAddress: stored.ipAddress } : {}),
    };

    await this.appendLifecycleLog(
      logContext,
      {
        stage: 'client_offer_received',
        allowed: true,
        ...(request.sdp ? { offerBytes: request.sdp.length } : {}),
      }
    );

    if (!stored.abortController) {
      stored.abortController = new AbortController();
      void this.beginTranscriptStream(stored, stored.abortController.signal);
    }
  }

  closeSession(conversationId: string): void {
    const stored = this.sessions.get(conversationId);
    if (!stored) {
      return;
    }

    stored.abortController?.abort();
    this.sessions.delete(conversationId);
  }

  private async beginTranscriptStream(stored: StoredLiveSession, signal: AbortSignal): Promise<void> {
    const handler: TranscriptHandler = async (text) => {
      if (!text || text.trim().length === 0) {
        return;
      }

      try {
        const options = {
          source: 'voice_transcription' as const,
          ...(stored.ipAddress ? { ipAddress: stored.ipAddress } : {}),
        };

        await this.orchestrator.handleUserMessage(
          stored.conversationId,
          stored.sessionId,
          text,
          options
        );

        const context: LiveVoiceSessionRequest = {
          conversationId: stored.conversationId,
          sessionId: stored.sessionId,
          ...(stored.ipAddress ? { ipAddress: stored.ipAddress } : {}),
        };

        await this.appendLifecycleLog(
          context,
          {
            stage: 'transcript_forwarded',
            allowed: true,
            characters: text.length,
          }
        );
      } catch (err) {
        const context: LiveVoiceSessionRequest = {
          conversationId: stored.conversationId,
          sessionId: stored.sessionId,
          ...(stored.ipAddress ? { ipAddress: stored.ipAddress } : {}),
        };

        await this.appendLifecycleLog(
          context,
          {
            stage: 'transcript_forward_error',
            allowed: false,
            characters: text.length,
            error: err instanceof Error ? err.message : String(err),
          }
        );
      }
    };

    try {
      if (!this.realtimeClient) {
        throw new Error('Realtime client unavailable. Check server configuration.');
      }

      for await (const event of this.realtimeClient.streamEvents(
        stored.openAiSessionId,
        stored.clientSecret,
        signal
      )) {
        stored.lastActivityAt = Date.now();
        this.handleRealtimeEvent(stored, event, handler).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('Failed to process realtime event', err);
        });
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        // eslint-disable-next-line no-console
        console.error('Live voice transcript stream terminated', err);
        const context: LiveVoiceSessionRequest = {
          conversationId: stored.conversationId,
          sessionId: stored.sessionId,
          ...(stored.ipAddress ? { ipAddress: stored.ipAddress } : {}),
        };

        await this.appendLifecycleLog(
          context,
          {
            stage: 'transcript_stream_error',
            allowed: false,
            error: err instanceof Error ? err.message : String(err),
          }
        );
      }
    }
  }

  private async handleRealtimeEvent(
    stored: StoredLiveSession,
    event: RealtimeEvent,
    onTranscript: TranscriptHandler
  ): Promise<void> {
    const type = event.type ?? 'unknown';

    if (typeof event.data === 'string') {
      // Unstructured payload; nothing we can do yet.
      return;
    }

    if (type === 'response.output_text.delta') {
      const delta = this.extractDeltaText(event.data);
      if (delta) {
        stored.transcriptBuffer += delta;
      }
      return;
    }

    if (type === 'response.output_text.done' || type === 'response.completed') {
      const completeText = this.extractCompleteText(event.data) ?? stored.transcriptBuffer;
      stored.transcriptBuffer = '';
      if (completeText && completeText.trim().length > 0) {
        await onTranscript(completeText.trim());
      }
      return;
    }

    if (type === 'conversation.item.completed') {
      const text = this.extractConversationText(event.data);
      if (text) {
        await onTranscript(text);
      }
      return;
    }
  }

  private extractDeltaText(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') {
      return undefined;
    }

    if ('delta' in data && typeof (data as { delta: unknown }).delta === 'string') {
      return (data as { delta: string }).delta;
    }

    if ('text' in data && typeof (data as { text: unknown }).text === 'string') {
      return (data as { text: string }).text;
    }

    return undefined;
  }

  private extractCompleteText(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') {
      return undefined;
    }

    if ('output' in data && Array.isArray((data as { output: unknown[] }).output)) {
      const [first] = (data as { output: unknown[] }).output;
      if (first && typeof first === 'object' && 'content' in first) {
        const content = (first as { content: unknown }).content;
        if (Array.isArray(content) && content.length > 0) {
          const [firstContent] = content;
          if (firstContent && typeof firstContent === 'object' && 'text' in firstContent) {
            const text = (firstContent as { text?: string }).text;
            if (typeof text === 'string') {
              return text;
            }
          }
        }
      }
    }

    if ('text' in data && typeof (data as { text: unknown }).text === 'string') {
      return (data as { text: string }).text;
    }

    return undefined;
  }

  private extractConversationText(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') {
      return undefined;
    }

    if ('item' in data && data.item && typeof (data as { item: unknown }).item === 'object') {
      const item = (data as { item: { content?: unknown } }).item;
      if (Array.isArray(item.content)) {
        for (const block of item.content) {
          if (block && typeof block === 'object' && 'text' in block) {
            const text = (block as { text?: string }).text;
            if (typeof text === 'string' && text.trim().length > 0) {
              return text;
            }
          }
        }
      }
    }

    return undefined;
  }

  private async appendLifecycleLog(
    request: LiveVoiceSessionRequest,
    payload: Record<string, unknown>
  ): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event: 'agent_response' as const,
      conversationId: request.conversationId,
      sessionId: request.sessionId,
      agent: 'voice' as const,
      ...(request.ipAddress ? { ipAddress: request.ipAddress } : {}),
      payload: {
        source: 'voice_live',
        ...payload,
      },
    } satisfies ConversationLogEntry;

    const debugEnabled = process.env.DEBUG_VOICE_LIVE_LOGS === 'true';

    if (debugEnabled) {
      // eslint-disable-next-line no-console
      console.debug('[voice-live]', JSON.stringify(logEntry));
    }

    await this.logger.append({
      timestamp: logEntry.timestamp,
      event: logEntry.event,
      conversationId: logEntry.conversationId,
      sessionId: logEntry.sessionId,
      agent: logEntry.agent,
      ...(logEntry.ipAddress ? { ipAddress: logEntry.ipAddress } : {}),
      payload: logEntry.payload,
    });
  }
}
