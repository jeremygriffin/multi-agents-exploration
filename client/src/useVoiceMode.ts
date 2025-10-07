import { useCallback, useMemo, useRef, useState } from 'react';

import { createVoiceSession } from './api';
import type { VoiceSessionGrant } from './types';

export type VoiceModeStatus = 'idle' | 'requesting' | 'connecting' | 'active' | 'error';

interface VoiceModeOptions {
  sessionId: string | null;
  conversationId: string | null;
  onTranscript?: (transcript: string) => Promise<void> | void;
}

interface VoiceModeState {
  status: VoiceModeStatus;
  error: string | null;
  grant: VoiceSessionGrant | null;
  remoteStream: MediaStream | null;
}

interface VoiceModeControls extends VoiceModeState {
  start: () => Promise<void>;
  stop: () => void;
  isBusy: boolean;
  speak: (text: string) => boolean;
  isReadyToListen: boolean;
}

const logTransition = (from: VoiceModeStatus, to: VoiceModeStatus) => {
  console.debug('[voiceMode] transition', { from, to, at: new Date().toISOString() });
};

export const useVoiceMode = ({ sessionId, conversationId, onTranscript }: VoiceModeOptions): VoiceModeControls => {
  const [status, setStatus] = useState<VoiceModeStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [grant, setGrant] = useState<VoiceSessionGrant | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isReadyToListen, setIsReadyToListen] = useState(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const transcriptBufferRef = useRef('');
  const textDecoderRef = useRef<TextDecoder | null>(null);
  const pendingTranscriptRef = useRef<string | null>(null);
  const pendingFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCancelRef = useRef<string[]>([]);
  const pendingSpeechQueueRef = useRef<Array<{ payload: string; expectsResponse: boolean }>>([]);
  const expectedResponseCountRef = useRef(0);

  const updateReadiness = useCallback(() => {
    const pcReady = peerConnectionRef.current?.connectionState === 'connected';
    const channelReady = dataChannelRef.current?.readyState === 'open';
    setIsReadyToListen(Boolean(pcReady && channelReady));
  }, []);

  const transition = useCallback(
    (next: VoiceModeStatus) => {
      setStatus((previous) => {
        if (previous !== next) {
          logTransition(previous, next);
        }
        return next;
      });
    },
    []
  );

  const teardown = useCallback(() => {
    if (pendingFlushTimeoutRef.current) {
      clearTimeout(pendingFlushTimeoutRef.current);
      pendingFlushTimeoutRef.current = null;
    }
    pendingCancelRef.current = [];
    pendingSpeechQueueRef.current = [];
    pendingTranscriptRef.current = null;
    dataChannelRef.current?.close();
    dataChannelRef.current = null;

    peerConnectionRef.current?.getSenders().forEach((sender) => {
      try {
        sender.track?.stop();
      } catch (err) {
      console.debug('[voiceMode] failed to stop sender track', err);
      }
    });
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (err) {
      console.debug('[voiceMode] failed to stop local track', err);
      }
    });
    localStreamRef.current = null;

    setRemoteStream(null);
    transcriptBufferRef.current = '';
    setIsReadyToListen(false);
  }, []);

  const emitTranscript = useCallback(
    (text: string) => {
      if (!onTranscript) {
        return;
      }

      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      void (async () => {
        try {
          await onTranscript(trimmed);
        } catch (err) {
          console.error('[voiceMode] failed to forward transcript', err);
          setError('Failed to forward voice transcript.');
        }
      })();
    },
    [onTranscript, setError]
  );

  const handleRealtimePayload = useCallback(
    (payload: Record<string, unknown>) => {
      const event = payload as {
        type?: unknown;
        delta?: unknown;
        transcription?: unknown;
        transcript?: unknown;
        text?: unknown;
        item?: unknown;
      };

      const type = typeof event.type === 'string' ? event.type : undefined;

      const isInputTranscriptionEvent =
        typeof type === 'string' &&
        (type.startsWith('input_transcription.') ||
          type.startsWith('input_audio_buffer.transcription.') ||
          type.includes('input_audio_transcription.'));

      if (type === 'response.created') {
        const responseId =
          typeof (event as { response?: { id?: unknown } }).response?.id === 'string'
            ? (event as { response: { id: string } }).response.id
            : undefined;

        if (responseId) {
          if (expectedResponseCountRef.current > 0) {
            expectedResponseCountRef.current = Math.max(expectedResponseCountRef.current - 1, 0);
          console.debug('[voiceMode] response.created (expected)', {
              responseId,
              remainingExpected: expectedResponseCountRef.current,
            });
          } else {
            const channel = dataChannelRef.current;
            if (channel && channel.readyState === 'open') {
              try {
                channel.send(JSON.stringify({ type: 'response.cancel', response_id: responseId }));
                console.debug('[voiceMode] cancelled unsolicited response', { responseId });
              } catch (err) {
                console.warn('[voiceMode] failed to cancel response', err);
              }
            } else {
              pendingCancelRef.current = [...pendingCancelRef.current, responseId];
              console.debug('[voiceMode] queued cancel for unsolicited response', {
                responseId,
                queued: pendingCancelRef.current.length,
              });
            }
          }
        }
        return;
      }

      if (type === 'error') {
        let serialized: string | undefined;
        try {
          serialized = JSON.stringify(payload);
        } catch (serializationError) {
          const reason = serializationError instanceof Error ? serializationError.message : serializationError;
          console.warn('[voiceMode] failed to serialize realtime error payload', reason);
        }
        console.error('[voiceMode] realtime error', serialized ?? payload);
        setError('Realtime voice session error. Check console logs for details.');
        return;
      }

      if (typeof type === 'string' && type.startsWith('response.')) {
        console.debug('[voiceMode] response event', type, payload);
      }

      if (isInputTranscriptionEvent) {
        const isDelta = type?.endsWith('.delta') ?? false;
        const isCompleted = type?.endsWith('.completed') ?? false;
        const isFailed = type?.endsWith('.failed') ?? false;

        if (isDelta) {
          let chunk = '';
          if (typeof event.delta === 'string') {
            chunk = event.delta;
          } else if (typeof event.text === 'string') {
            chunk = event.text;
          }

          if (!chunk && typeof event.item === 'object' && event.item !== null) {
            const maybeText = (event.item as { content?: Array<{ text?: string }> }).content?.[0]?.text;
            if (typeof maybeText === 'string') {
              chunk = maybeText;
            }
          }

          if (chunk) {
            transcriptBufferRef.current += chunk;
          }
          return;
        }

        if (isCompleted) {
          let finalText: string | undefined;

          if (typeof event.transcription === 'string' && event.transcription.trim().length > 0) {
            finalText = event.transcription;
          } else if (typeof event.transcript === 'string' && event.transcript.trim().length > 0) {
            finalText = event.transcript;
          } else if (typeof event.text === 'string' && event.text.trim().length > 0) {
            finalText = event.text;
          } else if (typeof event.item === 'object' && event.item !== null) {
            const maybeContent = (event.item as { content?: Array<{ text?: string; transcript?: string }> }).content;
            const fromContent = maybeContent?.map((part) => part.transcript ?? part.text).find((part) => part && part.trim().length > 0);
            if (typeof fromContent === 'string') {
              finalText = fromContent;
            }
          }

          if (!finalText || finalText.trim().length === 0) {
            finalText = transcriptBufferRef.current;
          }

          transcriptBufferRef.current = '';

          if (finalText && finalText.trim().length > 0) {
            pendingTranscriptRef.current = finalText.trim();

            if (pendingFlushTimeoutRef.current) {
              clearTimeout(pendingFlushTimeoutRef.current);
            }

            pendingFlushTimeoutRef.current = setTimeout(() => {
              const pending = pendingTranscriptRef.current;
              pendingTranscriptRef.current = null;
              pendingFlushTimeoutRef.current = null;
              if (pending) {
                emitTranscript(pending);
              }
            }, 750);
          }
          return;
        }

        if (isFailed) {
          transcriptBufferRef.current = '';
          setError('Realtime transcription failed.');
          return;
        }

        // Fall-through for other input transcription events we don't explicitly handle.
        console.debug('[voiceMode] event', type, payload);
        return;
      }

      console.debug('[voiceMode] event', type ?? 'unknown', payload);
    },
    [emitTranscript, setError]
  );

  const start = useCallback(async () => {
    if (!sessionId || !conversationId) {
      setError('Voice mode requires an active session and conversation.');
      transition('error');
      return;
    }

    try {
      setError(null);
      transition('requesting');
      transcriptBufferRef.current = '';
      setIsReadyToListen(false);

      const response = await createVoiceSession(sessionId, conversationId);
      setGrant(response.grant);

      transition('connecting');

      const pc = new RTCPeerConnection({
        iceServers: response.grant.iceServers,
      });
      peerConnectionRef.current = pc;

      pc.addEventListener('connectionstatechange', () => {
        const state = pc.connectionState;
        console.debug('[voiceMode] connection state change', state);
        updateReadiness();
        if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          teardown();
          setError(state === 'closed' ? null : 'Voice connection lost.');
          transition(state === 'closed' ? 'idle' : 'error');
        }
      });

      const remote = new MediaStream();
      setRemoteStream(remote);

      pc.addEventListener('track', (event) => {
        console.debug('[voiceMode] remote track', { kind: event.track.kind });
        remote.addTrack(event.track);
      });

      const dataChannel = pc.createDataChannel('oai-events');
      dataChannelRef.current = dataChannel;
      dataChannel.addEventListener('open', () => {
        console.debug('[voiceMode] data channel open');
        if (pendingCancelRef.current.length > 0) {
          const queue = [...pendingCancelRef.current];
          pendingCancelRef.current = [];
          for (const responseId of queue) {
            try {
              dataChannel.send(JSON.stringify({ type: 'response.cancel', response_id: responseId }));
            } catch (err) {
              console.debug('[voiceMode] failed to flush cancel command', err);
            }
          }
        }
        if (pendingSpeechQueueRef.current.length > 0) {
          const queue = [...pendingSpeechQueueRef.current];
          pendingSpeechQueueRef.current = [];
          for (const { payload, expectsResponse } of queue) {
            try {
              if (expectsResponse) {
                expectedResponseCountRef.current += 1;
              }
              dataChannel.send(payload);
              console.debug('[voiceMode] flushed queued speech payload', {
                expectsResponse,
                expectedResponses: expectedResponseCountRef.current,
              });
            } catch (err) {
              console.debug('[voiceMode] failed to flush speech command', err);
            }
          }
        }
        try {
          dataChannel.send(
            JSON.stringify({
              type: 'session.update',
              session: {
                turn_detection: {
                  type: 'server_vad',
                  create_response: false,
                },
              },
            })
          );
        } catch (err) {
          console.warn('[voiceMode] failed to disable auto responses', err);
        }
        updateReadiness();
      });
      dataChannel.addEventListener('close', () => {
        console.debug('[voiceMode] data channel closed');
        setIsReadyToListen(false);
      });
      dataChannel.addEventListener('message', (event) => {
        const raw = event.data;
        let text: string | null = null;

        if (typeof raw === 'string') {
          text = raw;
        } else if (raw instanceof ArrayBuffer) {
          const decoder = textDecoderRef.current ?? new TextDecoder();
          textDecoderRef.current = decoder;
          text = decoder.decode(raw);
        } else if (ArrayBuffer.isView(raw)) {
          const decoder = textDecoderRef.current ?? new TextDecoder();
          textDecoderRef.current = decoder;
          text = decoder.decode(raw.buffer);
        }

        if (!text) {
          console.debug('[voiceMode] unhandled event payload', raw);
          return;
        }

        const chunks = text
          .split('\n')
          .map((chunk) => chunk.trim())
          .filter((chunk) => chunk.length > 0);

        for (const chunk of chunks) {
          try {
            const parsed = JSON.parse(chunk) as Record<string, unknown>;
            handleRealtimePayload(parsed);
          } catch (err) {
            console.warn('[voiceMode] failed to parse realtime event', err, chunk);
          }
        }
      });

      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = localStream;
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const baseUrl = 'https://api.openai.com/v1/realtime';
      const model = response.grant.model ?? 'gpt-4o-realtime-preview';
      const targetUrl = `${baseUrl}?model=${encodeURIComponent(model)}`;

      const sdpResponse = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${response.grant.clientSecret}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp ?? '',
      });

      if (!sdpResponse.ok) {
        const problem = await sdpResponse.text();
        throw new Error(problem || 'Failed to negotiate realtime session');
      }

      const answer = await sdpResponse.text();
      const remoteDescription = new RTCSessionDescription({ type: 'answer', sdp: answer });
      await pc.setRemoteDescription(remoteDescription);

      transition('active');
    } catch (err) {
      console.error('[voiceMode] failed to start voice session', err);
      const message = err instanceof Error ? err.message : 'Failed to start voice session';
      setError(message);
      transition('error');
      teardown();
    }
  }, [conversationId, handleRealtimePayload, sessionId, teardown, transition, updateReadiness]);

  const stop = useCallback(() => {
    teardown();
    setGrant(null);
    setError(null);
    transition('idle');
  }, [teardown, transition]);

  const isBusy = useMemo(() => status === 'requesting' || status === 'connecting', [status]);

  const speak = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        console.debug('[voiceMode] speak skipped (empty)');
        return false;
      }

      const instructionPrefix = [
        'You are converting finalized assistant text to speech.',
        'Ignore prior conversation context.',
        'Say only the content between the markers verbatim with the same punctuation.',
        'Do not add greetings, confirmations, or summaries.',
      ].join(' ');

      const payloadObject = {
        type: 'response.create',
        response: {
          modalities: ['audio', 'text'],
          conversation: 'none' as const,
          instructions: `${instructionPrefix}\n<<<ASSISTANT_REPLY>>>\n${trimmed}\n<<<END_REPLY>>>`,
        },
      } as const;

      const payload = JSON.stringify(payloadObject);
      const channel = dataChannelRef.current;

      console.debug('[voiceMode] speech enqueue attempt', {
        snippet: trimmed.slice(0, 120),
        length: trimmed.length,
        channelState: channel?.readyState,
      });
      console.debug('[voiceMode] outbound instructions', payloadObject.response.instructions);

      if (channel && channel.readyState === 'open') {
        try {
          expectedResponseCountRef.current += 1;
          channel.send(payload);
          console.debug('[voiceMode] speech payload sent', {
            expectedResponses: expectedResponseCountRef.current,
          });
          return true;
        } catch (err) {
          console.warn('[voiceMode] failed to dispatch speech command', err);
          return false;
        }
      }

      pendingSpeechQueueRef.current = [
        ...pendingSpeechQueueRef.current,
        { payload, expectsResponse: true },
      ];
      console.debug('[voiceMode] speech payload queued', {
        queueSize: pendingSpeechQueueRef.current.length,
      });
      return true;
    },
    []
  );

  return {
    status,
    error,
    grant,
    remoteStream,
    start,
    stop,
    isBusy,
    speak,
    isReadyToListen,
  };
};
