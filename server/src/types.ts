export type AgentId =
  | 'manager'
  | 'greeting'
  | 'summarizer'
  | 'time_helper'
  | 'input_coach'
  | 'document_store'
  | 'voice'
  | 'guardrail';

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
  sessionId: string;
  ipAddress?: string;
}

export interface AgentAction {
  agent: Exclude<AgentId, 'manager'>;
  instructions?: string;
}

export interface ManagerPlan {
  actions: AgentAction[];
  notes?: string;
  managerSummary?: string;
  usage?: TokenUsageSnapshot;
}

export interface TokenUsageSnapshot {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model?: string;
}

export interface AgentAudioResponse {
  mimeType: string;
  base64Data: string;
  description?: string;
}

export interface AgentResponse {
  agent: Exclude<AgentId, 'manager'>;
  content: string;
  audio?: AgentAudioResponse;
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
  event:
    | 'user_message'
    | 'manager_plan'
    | 'agent_response'
    | 'mcp_tool'
    | 'guardrail'
    | 'usage'
    | 'voice_session'
    | 'voice_session_error';
  conversationId: string;
  agent?: AgentId;
  sessionId: string;
  ipAddress?: string;
  payload: unknown;
}

export interface SessionMetadata {
  id: string;
  createdAt: number;
  lastSeen: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface SessionSummary {
  id: string;
  createdAt: number;
  lastSeen: number;
  expiredAt?: number;
  ipAddress?: string;
}

export type UsageEvent =
  | 'message'
  | 'file_upload'
  | 'audio_transcription'
  | 'tts_generation'
  | 'voice_session';

export interface UsageLimitConfig {
  perSession: Partial<Record<UsageEvent, number | undefined>>;
  perIp: Partial<Record<UsageEvent, number | undefined>>;
}

export interface VoiceSessionGrant {
  conversationId: string;
  userSessionId: string;
  expiresAt: number;
  realtimeSessionId?: string;
  model?: string;
  voice?: string;
  clientSecret: string;
  iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
  instructions?: string;
}
