export type AgentId =
  | 'manager'
  | 'greeting'
  | 'summarizer'
  | 'time_helper'
  | 'input_coach'
  | 'document_store';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agent?: AgentId;
  timestamp: number;
}

export interface Conversation {
  id: string;
  createdAt: number;
  messages: ChatMessage[];
}

export interface AgentAction {
  agent: Exclude<AgentId, 'manager'>;
  instructions?: string;
}

export interface ManagerPlan {
  actions: AgentAction[];
  notes?: string;
}

export interface AgentResponse {
  agent: Exclude<AgentId, 'manager'>;
  content: string;
}

export interface HandleMessageResult {
  conversation: Conversation;
  responses: AgentResponse[];
  managerNotes?: string;
}

export interface UploadedFile {
  originalName: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

export interface ConversationLogEntry {
  timestamp: string;
  event: 'user_message' | 'manager_plan' | 'agent_response' | 'mcp_tool';
  conversationId: string;
  agent?: AgentId;
  payload: unknown;
}
