import type { Conversation } from '../types';

export interface AgentContext {
  conversation: Conversation;
  userMessage: string;
}

export interface AgentResult {
  content: string;
}

export interface Agent {
  id: string;
  name: string;
  handle(context: AgentContext): Promise<AgentResult>;
}
