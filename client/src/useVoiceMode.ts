import { useCallback, useMemo, useRef, useState } from 'react';

import { createVoiceSession } from './api';
import type { VoiceSessionGrant } from './types';

export type VoiceModeStatus = 'idle' | 'requesting' | 'connecting' | 'active' | 'error';

interface VoiceModeOptions {
  sessionId: string | null;
  conversationId: string | null;
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

export const useVoiceMode = ({ sessionId, conversationId }: VoiceModeOptions): VoiceModeControls => {
  const [status, setStatus] = useState<VoiceModeStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [grant, setGrant] = useState<VoiceSessionGrant | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

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
  }, []);

  const start = useCallback(async () => {
    if (!sessionId || !conversationId) {
      setError('Voice mode requires an active session and conversation.');
      transition('error');
      return;
    }

    try {
      setError(null);
      transition('requesting');

      const response = await createVoiceSession(sessionId, conversationId);
      setGrant(response.grant);

      transition('connecting');

      // Placeholder: handshake wiring with OpenAI Realtime to be implemented in the next iteration.
      // eslint-disable-next-line no-console
      console.info('[voiceMode] received grant', {
        expiresAt: new Date(response.grant.expiresAt * 1000).toISOString(),
        realtimeSessionId: response.grant.realtimeSessionId,
        model: response.grant.model,
        voice: response.grant.voice,
      });

      transition('active');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start voice session';
      setError(message);
      transition('error');
      teardown();
    }
  }, [conversationId, sessionId, teardown, transition]);

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
