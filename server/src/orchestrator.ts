import { randomUUID } from 'crypto';

import { GreetingAgent } from './agents/greetingAgent';
import { InputCoachAgent } from './agents/inputCoachAgent';
import { ManagerAgent } from './agents/managerAgent';
import { SummarizerAgent } from './agents/summarizerAgent';
import { TimeHelperAgent } from './agents/timeHelperAgent';
import type { AgentResponse, Conversation, HandleMessageResult } from './types';
import type { Agent } from './agents/baseAgent';
import type { ConversationStore } from './services/conversationStore';
import type { InteractionLogger } from './services/interactionLogger';

const manager = new ManagerAgent();
const greetingAgent = new GreetingAgent();
const summarizerAgent = new SummarizerAgent();
const timeHelperAgent = new TimeHelperAgent();
const inputCoachAgent = new InputCoachAgent();

const agentRegistry: Record<string, Agent> = {
  greeting: greetingAgent,
  summarizer: summarizerAgent,
  time_helper: timeHelperAgent,
  input_coach: inputCoachAgent,
};

export class Orchestrator {
  constructor(
    private readonly store: ConversationStore,
    private readonly logger: InteractionLogger
  ) {}

  createConversation(): Conversation {
    const conversation = this.store.createConversation();
    return conversation;
  }

  getConversation(conversationId: string): Conversation | undefined {
    return this.store.getConversation(conversationId);
  }

  async handleUserMessage(conversationId: string, message: string): Promise<HandleMessageResult> {
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
      payload: { content: message },
    });

    const plan = await manager.plan(conversation, message);

    await this.logger.append({
      timestamp: new Date().toISOString(),
      event: 'manager_plan',
      conversationId,
      agent: 'manager',
      payload: plan,
    });

    const actions = plan.actions.length > 0 ? plan.actions : [{ agent: 'greeting' as const }];
    const responses: AgentResponse[] = [];

    for (const action of actions) {
      const agent = agentRegistry[action.agent];
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

      const agentResult = await agent.handle({ conversation, userMessage: delegatedMessage });

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
