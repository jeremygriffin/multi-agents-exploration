import type {
  AgentReply,
  CreateConversationResponse,
  MessageSource,
  ResetSessionResponse,
  SendMessageResponse,
  VoiceSessionResponse,
} from './types';

const BASE_URL = import.meta.env.VITE_SERVER_BASE_URL ?? 'http://localhost:3001';

const buildJsonHeaders = (sessionId: string): HeadersInit => ({
  'Content-Type': 'application/json',
  'x-session-id': sessionId,
});

const buildSessionHeaders = (sessionId: string): HeadersInit => ({
  'x-session-id': sessionId,
});

const handleResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const text = await response.text();

    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed && typeof parsed.error === 'string') {
        message = parsed.error;
      }
    } catch {
      // Not JSON, fall back to text message.
    }

    throw new Error(message || `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
};

export const createConversation = async (sessionId: string): Promise<CreateConversationResponse> => {
  const response = await fetch(`${BASE_URL}/api/conversations`, {
    method: 'POST',
    headers: buildJsonHeaders(sessionId),
  });

  return handleResponse<CreateConversationResponse>(response);
};

interface SendMessagePayload {
  content: string;
  attachment?: File;
  source?: MessageSource;
}

export const sendMessage = async (
  sessionId: string,
  conversationId: string,
  payload: SendMessagePayload
): Promise<SendMessageResponse> => {
  const url = `${BASE_URL}/api/conversations/${conversationId}/messages`;

  if (payload.attachment) {
    const formData = new FormData();
    formData.append('content', payload.content);
    formData.append('attachment', payload.attachment);
    if (payload.source) {
      formData.append('source', payload.source);
    }

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      headers: buildSessionHeaders(sessionId),
    });

    return handleResponse<SendMessageResponse>(response);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: buildJsonHeaders(sessionId),
    body: JSON.stringify({ content: payload.content, ...(payload.source ? { source: payload.source } : {}) }),
  });

  return handleResponse<SendMessageResponse>(response);
};

export const resetSession = async (sessionId: string): Promise<ResetSessionResponse> => {
  const response = await fetch(`${BASE_URL}/api/sessions/reset`, {
    method: 'POST',
    headers: buildJsonHeaders(sessionId),
  });

  return handleResponse<ResetSessionResponse>(response);
};

export const createVoiceSession = async (
  sessionId: string,
  conversationId: string
): Promise<VoiceSessionResponse> => {
  const response = await fetch(`${BASE_URL}/api/voice/sessions`, {
    method: 'POST',
    headers: buildJsonHeaders(sessionId),
    body: JSON.stringify({ conversationId }),
  });

  return handleResponse<VoiceSessionResponse>(response);
};

export const formatAgentLabel = (agent: AgentReply['agent'] | 'manager'): string => {
  switch (agent) {
    case 'greeting':
      return 'Greeting Agent';
    case 'summarizer':
      return 'Summarizer Agent';
    case 'time_helper':
      return 'Time Helper Agent';
    case 'input_coach':
      return 'Input Coach Agent';
    case 'document_store':
      return 'Document Store Agent';
    case 'voice':
      return 'Voice Agent';
    case 'manager':
      return 'Manager Notes';
    default:
      return 'Assistant';
  }
};
