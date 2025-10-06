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
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

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
        try {
          const payload = JSON.parse(event.data as string);
          console.info('[voiceMode] event', payload.type ?? 'unknown', payload);
        } catch {
          console.info('[voiceMode] raw event', event.data);
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
      const targetUrl = response.grant.realtimeSessionId
        ? `${baseUrl}/sessions/${response.grant.realtimeSessionId}/sdp`
        : `${baseUrl}?model=${encodeURIComponent(model)}`;

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
