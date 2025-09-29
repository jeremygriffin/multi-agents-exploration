import type { Conversation, UploadedFile } from '../types';

export interface AgentContext {
  conversation: Conversation;
  userMessage: string;
  attachments?: UploadedFile[];
}

export interface AgentResult {
  content: string;
  debug?: Record<string, unknown>;
}

export interface Agent {
  id: string;
  name: string;
  handle(context: AgentContext): Promise<AgentResult>;
}
