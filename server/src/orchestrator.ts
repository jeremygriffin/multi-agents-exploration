import { randomUUID } from 'crypto';

import { DocumentStoreAgent } from './agents/documentStoreAgent';
import { GreetingAgent } from './agents/greetingAgent';
import { InputCoachAgent } from './agents/inputCoachAgent';
import { ManagerAgent } from './agents/managerAgent';
import { SummarizerAgent } from './agents/summarizerAgent';
import { TimeHelperAgent } from './agents/timeHelperAgent';
import type { AgentResponse, Conversation, HandleMessageResult, UploadedFile } from './types';
import type { Agent } from './agents/baseAgent';
import type { ConversationStore } from './services/conversationStore';
import type { InteractionLogger } from './services/interactionLogger';

export class Orchestrator {
  private readonly manager: ManagerAgent;

  private readonly agentRegistry: Record<string, Agent>;

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
    };
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

    const userMessage = {
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

    const managerInput = options?.attachments?.length
      ? `${message}\n\nAttachment metadata: ${options.attachments
          .map((file) => `${file.originalName} (${file.mimetype}, ${file.size} bytes)`)
          .join(', ')}`
      : message;

    const plan = await this.manager.plan(conversation, managerInput);

    await this.logger.append({
      timestamp: new Date().toISOString(),
      event: 'manager_plan',
      conversationId,
      agent: 'manager',
      payload: plan,
    });

    const actions = plan.actions.length > 0
      ? plan.actions
      : [{ agent: options?.attachments?.length ? ('document_store' as const) : ('greeting' as const) }];
    const responses: AgentResponse[] = [];

    for (const action of actions) {
      const agent = this.agentRegistry[action.agent];
      if (!agent) {
        continue;
      }

      const delegatedMessage = action.instructions
        ? `${message}\n\nManager instructions: ${action.instructions}`
        : message;

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
        ...(options?.attachments ? { attachments: options.attachments } : {}),
      });

      const assistantMessage = {
        id: randomUUID(),
        role: 'assistant' as const,
        content: agentResult.content,
        agent: action.agent,
        timestamp: Date.now(),
      };

      conversation.messages = [...conversation.messages, assistantMessage];
      this.store.upsertConversation(conversation);

      responses.push({ agent: action.agent, content: agentResult.content });

      await this.logger.append({
        timestamp: new Date(assistantMessage.timestamp).toISOString(),
        event: 'agent_response',
        conversationId,
        agent: action.agent,
        payload: {
          delegatedMessage,
          managerInstructions: action.instructions,
          conversationSummary,
          attachments: options?.attachments?.map((file) => ({
            originalName: file.originalName,
            mimetype: file.mimetype,
            size: file.size,
          })),
          content: agentResult.content,
          debug: agentResult.debug,
        },
      });
    }

    const result: HandleMessageResult = {
      conversation,
      responses,
    };

    if (typeof plan.notes === 'string' && plan.notes.length > 0) {
      result.managerNotes = plan.notes;
    }

    return result;
  }
}
