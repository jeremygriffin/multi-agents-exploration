export type AgentId = 'greeting' | 'summarizer' | 'time_helper' | 'input_coach';

export interface CreateConversationResponse {
  id: string;
  createdAt: number;
}

export interface AgentReply {
  agent: AgentId;
  content: string;
}

export interface SendMessageResponse {
  conversation: {
    id: string;
    createdAt: number;
  };
  responses: AgentReply[];
  managerNotes?: string;
}

export interface ChatEntry {
  id: string;
  role: 'user' | 'agent' | 'note';
  content: string;
  agent?: AgentId | 'manager';
}
