import type {
  AgentReply,
  CreateConversationResponse,
  SendMessageResponse,
} from './types';

const BASE_URL = import.meta.env.VITE_SERVER_BASE_URL ?? 'http://localhost:3001';

const jsonHeaders = {
  'Content-Type': 'application/json',
};

const handleResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
};

export const createConversation = async (): Promise<CreateConversationResponse> => {
  const response = await fetch(`${BASE_URL}/api/conversations`, {
    method: 'POST',
    headers: jsonHeaders,
  });

  return handleResponse<CreateConversationResponse>(response);
};

export const sendMessage = async (
  conversationId: string,
  content: string,
  attachment?: File
): Promise<SendMessageResponse> => {
  const url = `${BASE_URL}/api/conversations/${conversationId}/messages`;

  if (attachment) {
    const formData = new FormData();
    formData.append('content', content);
    formData.append('attachment', attachment);

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    return handleResponse<SendMessageResponse>(response);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ content }),
  });

  return handleResponse<SendMessageResponse>(response);
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
    case 'manager':
      return 'Manager Notes';
    default:
      return 'Assistant';
  }
};
