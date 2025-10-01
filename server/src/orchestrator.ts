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
import { InputGuardService } from './services/inputGuardService';
import { ResponseGuardService } from './services/responseGuardService';

export class Orchestrator {
  private readonly manager: ManagerAgent;

  private readonly agentRegistry: Record<string, Agent>;

  private readonly ttsEnabled: boolean;

  private readonly ttsAgents: Set<string>;

  private readonly inputGuard: InputGuardService;

  private readonly responseGuard: ResponseGuardService;

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

    this.inputGuard = new InputGuardService(this.logger);
    this.responseGuard = new ResponseGuardService(this.logger);
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

      const guardResult = await this.inputGuard.evaluate({
        conversationId,
        message: messageContent,
        attachments: currentAttachments,
        source,
      });

      if (guardResult.status !== 'allow') {
        const guardMessageContent =
          guardResult.userFeedback ??
          (guardResult.status === 'blocked'
            ? 'Your message could not be processed right now.'
            : 'Could you please confirm or restate your request?');

        const guardMessage: ChatMessage = {
          id: randomUUID(),
          role: 'assistant',
          agent: 'guardrail',
          content: guardMessageContent,
          timestamp: Date.now(),
        };

        conversation.messages = [...conversation.messages, guardMessage];
        this.store.upsertConversation(conversation);

        const guardResponse: AgentResponse = {
          agent: 'guardrail',
          content: guardMessageContent,
        };

        responses.push(guardResponse);

        await this.logger.append({
          timestamp: new Date(guardMessage.timestamp).toISOString(),
          event: 'agent_response',
          conversationId,
          agent: 'guardrail',
          payload: {
            stage: 'input',
            disposition: guardResult.status,
            reason: guardResult.reason,
            details: guardResult.details,
            content: guardMessageContent,
          },
        });

        continue;
      }

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

        let finalAgentResult: AgentResult = agentResult;
        let deliverResponse = true;
        let guardInterventionContent: string | undefined;
        const guardLogDetails: Record<string, unknown> = {
          evaluated: false,
        };

        if (this.responseGuard.shouldEvaluate(action.agent)) {
          const evaluation = await this.responseGuard.evaluate({
            conversationId,
            agentId: action.agent,
            userMessage: messageContent,
            agentResponse: agentResult.content,
          });

          guardLogDetails.evaluated = true;
          guardLogDetails.strategy = this.responseGuard.getRecoveryStrategy();
          guardLogDetails.initial = evaluation;

          if (evaluation.status === 'mismatch') {
            const strategy = this.responseGuard.getRecoveryStrategy();

            // eslint-disable-next-line no-console
            console.log('[guardrails][response] mismatch detected', {
              conversationId,
              agent: action.agent,
              strategy,
              reason: evaluation.reason,
            });

            if (strategy === 'retry') {
              const retryMessage = `${delegatedMessage}\n\nGuardrail feedback: ${
                evaluation.reason ?? 'The previous response did not satisfy the user request.'
              }\nPlease correct any issues and answer the user request directly.`;

              const retryResult = await agent.handle({
                conversation,
                userMessage: retryMessage,
                ...(currentAttachments ? { attachments: currentAttachments } : {}),
              });

              const retryEvaluation = await this.responseGuard.evaluate({
                conversationId,
                agentId: action.agent,
                userMessage: messageContent,
                agentResponse: retryResult.content,
                attempt: 'retry',
              });

              guardLogDetails.retry = retryEvaluation;

              if (retryEvaluation.status === 'ok') {
                finalAgentResult = {
                  ...retryResult,
                  debug: {
                    ...retryResult.debug,
                    guardrailRetryReason: evaluation.reason,
                  },
                };
                guardLogDetails.outcome = 'retry_success';
              } else {
                deliverResponse = false;
                guardInterventionContent =
                  retryEvaluation.followUp ??
                  evaluation.followUp ??
                  'I want to be sure I understood correctly—could you clarify your request?';
                guardLogDetails.outcome = 'retry_escalated';
                guardLogDetails.suppressed = {
                  initial: agentResult.content,
                  retry: retryResult.content,
                };
              }
            } else if (strategy === 'clarify') {
              deliverResponse = false;
              guardInterventionContent =
                evaluation.followUp ??
                evaluation.reason ??
                'I want to double-check I understood correctly—could you clarify your request?';
              guardLogDetails.outcome = 'clarify';
              guardLogDetails.suppressed = {
                initial: agentResult.content,
              };
            } else {
              guardLogDetails.outcome = 'logged_only';
            }
          } else if (evaluation.status === 'error') {
            guardLogDetails.outcome = 'evaluation_error';
          } else {
            guardLogDetails.outcome = 'pass';
          }
        }

        if (!deliverResponse) {
          const guardContent =
            guardInterventionContent ??
            'I need a bit more detail before I can complete that request. Could you clarify?';

          const guardMessage: ChatMessage = {
            id: randomUUID(),
            role: 'assistant',
            agent: 'guardrail',
            content: guardContent,
            timestamp: Date.now(),
          };

          conversation.messages = [...conversation.messages, guardMessage];
          this.store.upsertConversation(conversation);

          const guardResponse: AgentResponse = {
            agent: 'guardrail',
            content: guardContent,
          };
          responses.push(guardResponse);

          await this.logger.append({
            timestamp: new Date(guardMessage.timestamp).toISOString(),
            event: 'agent_response',
            conversationId,
            agent: 'guardrail',
            payload: {
              stage: 'response',
              content: guardContent,
              details: guardLogDetails,
            },
          });

          continue;
        }

        const assistantMessage: ChatMessage = {
          id: randomUUID(),
          role: 'assistant' as const,
          content: finalAgentResult.content,
          agent: action.agent,
          timestamp: Date.now(),
        };

        conversation.messages = [...conversation.messages, assistantMessage];
        this.store.upsertConversation(conversation);

        const responsePayload: AgentResponse = {
          agent: action.agent,
          content: finalAgentResult.content,
        };

        if (finalAgentResult.audio) {
          responsePayload.audio = finalAgentResult.audio;
        }

        const shouldSynthesize =
          this.ttsEnabled &&
          !responsePayload.audio &&
          this.ttsAgents.has(action.agent);

        let ttsMetadata: Record<string, unknown> | undefined;
        let ttsError: string | undefined;

        if (shouldSynthesize) {
          try {
            const speech = await synthesizeSpeech(finalAgentResult.content);
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
          content: finalAgentResult.content,
          debug: finalAgentResult.debug,
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

        if (guardLogDetails.evaluated) {
          logPayload.guardrail = {
            ...guardLogDetails,
            initialContent:
              guardLogDetails.outcome === 'retry_success'
                ? agentResult.content
                : undefined,
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
          finalAgentResult,
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
