export type AgentId =
  | 'greeting'
  | 'summarizer'
  | 'time_helper'
  | 'input_coach'
  | 'document_store'
  | 'voice';

export interface AgentAudioPayload {
  mimeType: string;
  base64Data: string;
  description?: string;
}

export interface CreateConversationResponse {
  id: string;
  createdAt: number;
  sessionId: string;
}

export interface AgentReply {
  agent: AgentId;
  content: string;
  audio?: AgentAudioPayload;
}

export interface SendMessageResponse {
  conversation: {
    id: string;
    createdAt: number;
    sessionId: string;
  };
  responses: AgentReply[];
  managerNotes?: string;
  sessionId: string;
}

export interface ChatEntry {
  id: string;
  role: 'user' | 'agent' | 'note';
  content: string;
  agent?: AgentId | 'manager';
  audio?: AgentAudioPayload;
}

export interface ResetSessionResponse {
  sessionId: string;
  createdAt: number;
  lastSeen: number;
}

export interface LiveVoiceSessionDetails {
  id: string;
  conversationId: string;
  model: string;
  iceServers: RTCIceServer[];
  clientSecret: string;
  clientSecretExpiresAt?: number;
  expiresAt?: number;
}

export interface LiveVoiceSessionResponse {
  status: 'ready';
  message: string;
  session: LiveVoiceSessionDetails;
}
