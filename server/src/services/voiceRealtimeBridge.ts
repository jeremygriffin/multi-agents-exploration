import type { RealtimeClientEvent } from 'openai/resources/beta/realtime/realtime';
import type { VoiceSessionGrant } from '../types';
import type { Orchestrator } from '../orchestrator';
import type { InteractionLogger } from './interactionLogger';
import type { UsageLimitService } from './usageLimitService';

interface VoiceRealtimeBridgeOptions {
  orchestrator: Orchestrator;
  logger: InteractionLogger;
  usageLimits: UsageLimitService;
}

interface StartBridgeOptions {
  conversationId: string;
  sessionId: string;
  grant: VoiceSessionGrant;
}

export class VoiceRealtimeBridge {
  private activeSessions = new Map<string, { grant: VoiceSessionGrant; startedAt: number }>();

  constructor(private readonly options: VoiceRealtimeBridgeOptions) {}

  start(options: StartBridgeOptions): void {
    this.activeSessions.set(options.conversationId, {
      grant: options.grant,
      startedAt: Date.now(),
    });
    // Placeholder for WebRTC event piping once implemented.
  }

  stop(conversationId: string): void {
    this.activeSessions.delete(conversationId);
  }

  handleClientEvent(conversationId: string, event: RealtimeClientEvent): void {
    console.info('[voiceBridge] client event', conversationId, event.type);
  }
}
