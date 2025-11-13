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

export type MessageSource = 'initial' | 'voice_transcription';

export interface VoiceIceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface VoiceSessionGrant {
  id: string;
  websocketUrl: string;
  clientSecret: string;
  expiresAt: string;
  iceServers: VoiceIceServer[];
  model?: string;
}

export interface VoiceSessionResponse {
  grant: VoiceSessionGrant;
}
