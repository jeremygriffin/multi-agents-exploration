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
}

const logTransition = (from: VoiceModeStatus, to: VoiceModeStatus) => {
  console.info('[voiceMode] transition', { from, to, at: new Date().toISOString() });
};

export const useVoiceMode = ({ sessionId, conversationId, onTranscript }: VoiceModeOptions): VoiceModeControls => {
  const [status, setStatus] = useState<VoiceModeStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [grant, setGrant] = useState<VoiceSessionGrant | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const transcriptBufferRef = useRef('');
  const textDecoderRef = useRef<TextDecoder | null>(null);

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
    dataChannelRef.current?.close();
    dataChannelRef.current = null;

    peerConnectionRef.current?.getSenders().forEach((sender) => {
      try {
        sender.track?.stop();
      } catch (err) {
        console.warn('[voiceMode] failed to stop sender track', err);
      }
    });
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (err) {
        console.warn('[voiceMode] failed to stop local track', err);
      }
    });
    localStreamRef.current = null;

    setRemoteStream(null);
    transcriptBufferRef.current = '';
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

      const isInputTranscriptionEvent = typeof type === 'string' &&
        (type.startsWith('input_transcription.') ||
          type.startsWith('input_audio_buffer.transcription.') ||
          type.includes('input_audio_transcription.'));

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
            emitTranscript(finalText);
          }
          return;
        }

        if (isFailed) {
          transcriptBufferRef.current = '';
          setError('Realtime transcription failed.');
          return;
        }

        // Fall-through for other input transcription events we don't explicitly handle.
        console.info('[voiceMode] event', type, payload);
        return;
      }

      console.info('[voiceMode] event', type ?? 'unknown', payload);
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

      const response = await createVoiceSession(sessionId, conversationId);
      setGrant(response.grant);

      transition('connecting');

      const pc = new RTCPeerConnection({
        iceServers: response.grant.iceServers,
      });
      peerConnectionRef.current = pc;

      pc.addEventListener('connectionstatechange', () => {
        const state = pc.connectionState;
        console.info('[voiceMode] connection state change', state);
        if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          teardown();
          setError(state === 'closed' ? null : 'Voice connection lost.');
          transition(state === 'closed' ? 'idle' : 'error');
        }
      });

      const remote = new MediaStream();
      setRemoteStream(remote);

      pc.addEventListener('track', (event) => {
        console.info('[voiceMode] remote track', { kind: event.track.kind });
        remote.addTrack(event.track);
      });

      const dataChannel = pc.createDataChannel('oai-events');
      dataChannelRef.current = dataChannel;
      dataChannel.addEventListener('open', () => {
        console.info('[voiceMode] data channel open');
      });
      dataChannel.addEventListener('close', () => {
        console.info('[voiceMode] data channel closed');
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
          console.info('[voiceMode] unhandled event payload', raw);
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
      const message = err instanceof Error ? err.message : 'Failed to start voice session';
      setError(message);
      transition('error');
      teardown();
    }
  }, [conversationId, handleRealtimePayload, sessionId, teardown, transition]);

  const stop = useCallback(() => {
    teardown();
    setGrant(null);
    setError(null);
    transition('idle');
  }, [teardown, transition]);

  const isBusy = useMemo(() => status === 'requesting' || status === 'connecting', [status]);

  return {
    status,
    error,
    grant,
    remoteStream,
    start,
    stop,
    isBusy,
  };
};
