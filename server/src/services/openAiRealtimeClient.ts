import { setTimeout as delay } from 'timers/promises';

export interface RtcIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface CreateRealtimeSessionOptions {
  model: string;
  voice?: string;
  instructions?: string;
  modalities?: string[];
}

export interface RealtimeSession {
  id: string;
  model: string;
  clientSecret: {
    value: string;
    expiresAt?: number;
  };
  expiresAt?: number;
  iceServers: RtcIceServer[];
}

export interface SessionDescription {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface RealtimeEvent<T = unknown> {
  type: string;
  data: T;
}

interface OpenAiRealtimeSessionResponse {
  id: string;
  object: string;
  model: string;
  expires_at?: number;
  client_secret?: {
    value: string;
    expires_at?: number;
  };
  ice_servers?: RtcIceServer[];
}

const REALTIME_BETA_HEADER = 'realtime=v1';

export class OpenAiRealtimeClient {
  constructor(
    private readonly apiKey: string,
    private readonly defaults: {
      model: string;
      voice?: string;
      instructions?: string;
      modalities?: string[];
    } = { model: 'gpt-4o-realtime-preview' },
    private readonly baseUrl = 'https://api.openai.com/v1'
  ) {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required to initialize OpenAiRealtimeClient');
    }
  }

  private defaultHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': REALTIME_BETA_HEADER,
    };
  }

  async createSession(overrides?: Partial<CreateRealtimeSessionOptions>): Promise<RealtimeSession> {
    const payload: CreateRealtimeSessionOptions = {
      model: overrides?.model ?? this.defaults.model,
      ...(overrides?.voice ?? this.defaults.voice ? { voice: overrides?.voice ?? this.defaults.voice } : {}),
      ...(overrides?.instructions ?? this.defaults.instructions
        ? { instructions: overrides?.instructions ?? this.defaults.instructions }
        : {}),
      modalities: overrides?.modalities ?? this.defaults.modalities ?? ['text', 'audio'],
    };

    const response = await fetch(`${this.baseUrl}/realtime/sessions`, {
      method: 'POST',
      headers: this.defaultHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      await this.raiseError(response, 'Failed to create OpenAI Realtime session');
    }

    const body = (await response.json()) as OpenAiRealtimeSessionResponse;

    if (!body.client_secret?.value) {
      throw new Error('OpenAI realtime session response missing client secret');
    }

    return {
      id: body.id,
      model: body.model,
      clientSecret: {
        value: body.client_secret.value,
        ...(typeof body.client_secret.expires_at === 'number'
          ? { expiresAt: body.client_secret.expires_at }
          : {}),
      },
      ...(typeof body.expires_at === 'number' ? { expiresAt: body.expires_at } : {}),
      iceServers: body.ice_servers ?? [],
    };
  }

  async exchangeOffer(clientSecret: string, offer: SessionDescription): Promise<SessionDescription> {
    const response = await fetch(`${this.baseUrl}/realtime/sdp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        'Content-Type': 'application/sdp',
        'OpenAI-Beta': REALTIME_BETA_HEADER,
      },
      body: offer.sdp,
    });

    if (!response.ok) {
      await this.raiseError(response, 'Failed to exchange WebRTC offer with OpenAI');
    }

    const answerSdp = await response.text();
    return {
      type: 'answer',
      sdp: answerSdp,
    };
  }

  async *streamEvents(
    sessionId: string,
    clientSecret: string,
    abortSignal?: AbortSignal
  ): AsyncGenerator<RealtimeEvent> {
    const response = await fetch(`${this.baseUrl}/realtime/sessions/${sessionId}/events`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        Accept: 'text/event-stream',
        'OpenAI-Beta': REALTIME_BETA_HEADER,
      },
      signal: abortSignal ?? null,
    });

    if (!response.ok) {
      await this.raiseError(response, 'Failed to subscribe to realtime events');
    }

    if (!response.body) {
      throw new Error('Realtime events response had no body to read');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = this.parseSseEvent(rawEvent);
          if (event) {
            yield event;
          }
        }
      }

      if (buffer.trim().length > 0) {
        const event = this.parseSseEvent(buffer.trim());
        if (event) {
          yield event;
        }
      }
    } finally {
      reader.releaseLock();
      if (!abortSignal?.aborted) {
        // Give the API a moment before the connection is fully torn down.
        await delay(25);
      }
    }
  }

  private parseSseEvent(blob: string): RealtimeEvent | null {
    const lines = blob.split(/\r?\n/);
    let eventType = 'message';
    let data = '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data += `${line.slice(5).trim()}\n`;
      }
    }

    if (data.length === 0) {
      return null;
    }

    const trimmed = data.trim();
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return { type: eventType, data: parsed };
    } catch {
      return { type: eventType, data: trimmed };
    }
  }

  private async raiseError(response: Response, message: string): Promise<never> {
    let detail: string | undefined;
    try {
      const text = await response.text();
      detail = text;
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed?.error?.message) {
        detail = parsed.error.message;
      }
    } catch {
      // ignore
    }

    const error = new Error(
      detail ? `${message}: ${detail} (status ${response.status})` : `${message} (status ${response.status})`
    );
    throw error;
  }
}
