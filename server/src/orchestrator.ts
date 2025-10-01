import { randomUUID } from 'crypto';

import { DocumentStoreAgent } from './agents/documentStoreAgent';
import { GreetingAgent } from './agents/greetingAgent';
import { InputCoachAgent } from './agents/inputCoachAgent';
import { ManagerAgent } from './agents/managerAgent';
import { SummarizerAgent } from './agents/summarizerAgent';
import { TimeHelperAgent } from './agents/timeHelperAgent';
import { VoiceAgent } from './agents/voiceAgent';
import type { AgentId, AgentResponse, ChatMessage, Conversation, HandleMessageResult, UploadedFile } from './types';
import type { Agent, AgentResult } from './agents/baseAgent';
import { synthesizeSpeech, SpeechSynthesisError } from './services/speechSynthesisService';
import { persistAudioBuffer } from './services/audioService';
import type { ConversationStore } from './services/conversationStore';
import type { InteractionLogger } from './services/interactionLogger';

export class Orchestrator {
  private readonly manager: ManagerAgent;

  private readonly agentRegistry: Record<string, Agent>;

  private readonly ttsEnabled: boolean;

  private readonly ttsAgents: Set<string>;

  constructor(
    private readonly store: ConversationStore,
    private readonly logger: InteractionLogger
  ) {
    this.manager = new ManagerAgent();

    this.agentRegistry = {
      greeting: new GreetingAgent(),
      summarizer: new SummarizerAgent(),
      time_helper: new TimeHelperAgent(this.logger),
      input_coach: new InputCoachAgent(),
      document_store: new DocumentStoreAgent(),
      voice: new VoiceAgent(),
    };

    this.ttsEnabled = process.env.ENABLE_TTS_RESPONSES === 'true';
    const configuredAgents = (process.env.TTS_RESPONSE_AGENTS ?? 'time_helper')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    this.ttsAgents = new Set(configuredAgents);
  }

  createConversation(): Conversation {
    const conversation = this.store.createConversation();
    return conversation;
  }

  getConversation(conversationId: string): Conversation | undefined {
    return this.store.getConversation(conversationId);
  }

  async handleUserMessage(
    conversationId: string,
    message: string,
    options?: { attachments?: UploadedFile[] }
  ): Promise<HandleMessageResult> {
    const conversation = this.store.getConversation(conversationId);

    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: 'user' as const,
      content: message,
      timestamp: Date.now(),
    };

    conversation.messages = [...conversation.messages, userMessage];
    this.store.upsertConversation(conversation);

    await this.logger.append({
      timestamp: new Date(userMessage.timestamp).toISOString(),
      event: 'user_message',
      conversationId,
      payload: {
        content: message,
        attachments: options?.attachments?.map((file) => ({
          originalName: file.originalName,
          mimetype: file.mimetype,
          size: file.size,
        })),
      },
    });

    const responses: AgentResponse[] = [];
    let managerNotes: string | undefined;

    type QueueItem = {
      messageContent: string;
      attachments?: UploadedFile[];
      source: 'initial' | 'voice_transcription';
    };

    const queue: QueueItem[] = [
      {
        messageContent: message,
        ...(options?.attachments ? { attachments: options.attachments } : {}),
        source: 'initial',
      },
    ];

    while (queue.length > 0) {
      const { messageContent, attachments: currentAttachments, source } = queue.shift()!;

      const baseInput = currentAttachments?.length
        ? `${messageContent}\n\nAttachment metadata: ${currentAttachments
            .map((file) => `${file.originalName} (${file.mimetype}, ${file.size} bytes)`)
            .join(', ')}`
        : messageContent;

      const managerInput = source === 'voice_transcription'
        ? `Transcribed audio request (treat as typed text). Do not re-route to the voice agent unless new audio is provided.\n\n${baseInput}`
        : baseInput;

      const plan = await this.manager.plan(conversation, managerInput);

      await this.logger.append({
        timestamp: new Date().toISOString(),
        event: 'manager_plan',
        conversationId,
        agent: 'manager',
        payload: {
          source,
          ...plan,
        },
      });

      if (typeof plan.notes === 'string' && plan.notes.trim().length > 0) {
        managerNotes = plan.notes.trim();
      }

      const hasAudioAttachment = currentAttachments?.some((file) => file.mimetype?.toLowerCase().startsWith('audio/')) ?? false;

      const actions = plan.actions.length > 0
        ? plan.actions
        : ([{
            agent: currentAttachments?.length
              ? (hasAudioAttachment ? ('voice' as const) : ('document_store' as const))
              : ('greeting' as const),
          }] satisfies typeof plan.actions);

      for (const action of actions) {
        const agent = this.agentRegistry[action.agent];
        if (!agent) {
          continue;
        }

        const delegatedMessage = action.instructions
          ? `${messageContent}\n\nManager instructions: ${action.instructions}`
          : messageContent;

        const conversationSummary = conversation.messages
          .slice(-5)
          .map((msg) => ({
            role: msg.role,
            agent: msg.agent,
            content: msg.content,
          }));

        const agentResult = await agent.handle({
          conversation,
          userMessage: delegatedMessage,
          ...(currentAttachments ? { attachments: currentAttachments } : {}),
        });

        const assistantMessage: ChatMessage = {
          id: randomUUID(),
          role: 'assistant' as const,
          content: agentResult.content,
          agent: action.agent,
          timestamp: Date.now(),
        };

        conversation.messages = [...conversation.messages, assistantMessage];
        this.store.upsertConversation(conversation);

        const responsePayload: AgentResponse = {
          agent: action.agent,
          content: agentResult.content,
        };

        if (agentResult.audio) {
          responsePayload.audio = agentResult.audio;
        }

        const shouldSynthesize =
          this.ttsEnabled &&
          !responsePayload.audio &&
          this.ttsAgents.has(action.agent);

        let ttsMetadata: Record<string, unknown> | undefined;
        let ttsError: string | undefined;

        if (shouldSynthesize) {
          try {
            const speech = await synthesizeSpeech(agentResult.content);
            const stored = await persistAudioBuffer(
              speech.buffer,
              `tts-response-${action.agent}.${speech.extension}`
            );

            responsePayload.audio = {
              mimeType: speech.mimeType,
              base64Data: speech.buffer.toString('base64'),
              description: `Synthesized response (${speech.extension})`,
            };

            ttsMetadata = {
              storedPath: stored.storedPath,
              extension: speech.extension,
              mimeType: speech.mimeType,
              model: (speech.raw as { request?: { model?: string } })?.request?.model,
              voice: (speech.raw as { request?: { voice?: string } })?.request?.voice,
            };
          } catch (error) {
            ttsError = error instanceof SpeechSynthesisError ? error.message : 'Speech synthesis failed';
            ttsMetadata = {
              error: error instanceof SpeechSynthesisError ? error.cause : error,
            };
          }
        }

        responses.push(responsePayload);

        const logPayload: Record<string, unknown> = {
          delegatedMessage,
          managerInstructions: action.instructions,
          conversationSummary,
          content: agentResult.content,
          debug: agentResult.debug,
        };

        if (currentAttachments) {
          logPayload.attachments = currentAttachments.map((file) => ({
            originalName: file.originalName,
            mimetype: file.mimetype,
            size: file.size,
          }));
        }

        if (responsePayload.audio) {
          logPayload.audio = {
            mimeType: responsePayload.audio.mimeType,
            hasAudio: true,
          };
        }

        if (ttsMetadata) {
          logPayload.tts = {
            ...ttsMetadata,
            error: ttsError,
          };
        }

        await this.logger.append({
          timestamp: new Date(assistantMessage.timestamp).toISOString(),
          event: 'agent_response',
          conversationId,
          agent: action.agent,
          payload: logPayload,
        });

        await this.enqueueTranscriptionFollowUp(
          agentResult,
          action.agent,
          conversation,
          conversationId,
          queue
        );
      }
    }

    const result: HandleMessageResult = {
      conversation,
      responses,
    };

    if (managerNotes) {
      result.managerNotes = managerNotes;
    }

    return result;
  }

  private async enqueueTranscriptionFollowUp(
    agentResult: AgentResult,
    agentId: Exclude<AgentId, 'manager'>,
    conversation: Conversation,
    conversationId: string,
    queue: Array<{ messageContent: string; attachments?: UploadedFile[]; source: 'initial' | 'voice_transcription' }>
  ): Promise<void> {
    const followUp = agentResult.handoffUserMessage?.trim();

    if (!followUp) {
      return;
    }

    const timestamp = Date.now();
    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: 'user' as const,
      content: followUp,
      timestamp,
    };

    conversation.messages = [...conversation.messages, userMessage];
    this.store.upsertConversation(conversation);

    await this.logger.append({
      timestamp: new Date(timestamp).toISOString(),
      event: 'user_message',
      conversationId,
      payload: {
        content: followUp,
        source: 'voice_transcription',
        triggeredBy: agentId,
      },
    });

    queue.push({
      messageContent: followUp,
      source: 'voice_transcription',
    });
  }
}
