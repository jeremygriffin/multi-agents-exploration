import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { createConversation, formatAgentLabel, resetSession, sendMessage } from './api';
import type { AgentReply, ChatEntry } from './types';
import { useVoiceMode } from './useVoiceMode';
import './App.css';

const getEntryId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const SESSION_STORAGE_KEY = 'multi_agent_session_id';

const ensureSessionId = (): string => {
  if (typeof window === 'undefined') {
    return getEntryId();
  }

  const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing && existing.length > 0) {
    return existing;
  }

  const generated = getEntryId();
  window.localStorage.setItem(SESSION_STORAGE_KEY, generated);
  return generated;
};

const buildInitialMessages = (): ChatEntry[] => [
  {
    id: getEntryId(),
    role: 'note',
    content: 'Conversation ready. Say hi or ask for a recap, time check, or writing feedback.',
    agent: 'manager',
  },
];

const agentColor = (agent?: AgentReply['agent'] | 'manager'): string => {
  switch (agent) {
    case 'greeting':
      return 'agent-chip greeting';
    case 'summarizer':
      return 'agent-chip summarizer';
    case 'time_helper':
      return 'agent-chip time';
    case 'input_coach':
      return 'agent-chip coach';
    case 'document_store':
      return 'agent-chip storage';
    case 'voice':
      return 'agent-chip voice';
    case 'manager':
      return 'agent-chip manager';
    default:
      return 'agent-chip';
  }
};

const App = () => {
  const [sessionId, setSessionId] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  });
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingSupported, setRecordingSupported] = useState(false);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isSessionResetting, setIsSessionResetting] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const sendConversationMessageRef = useRef<
    ((payload: { content: string; attachment?: File; source?: 'initial' | 'voice_transcription' }) => Promise<void>)
  >(null);
  const voiceModeRef = useRef<ReturnType<typeof useVoiceMode> | null>(null);

  const sendConversationMessage = useCallback(
    async (payload: { content: string; attachment?: File; source?: 'initial' | 'voice_transcription' }) => {
      if (!sessionId || !conversationId) {
        return;
      }

      const normalizedContent = payload.content.trim();

      if (normalizedContent.length === 0) {
        return;
      }

      const userEntry: ChatEntry = {
        id: getEntryId(),
        role: 'user',
        content: normalizedContent,
      };

      const attachmentNote = payload.attachment
        ? [{
            id: getEntryId(),
            role: 'note' as const,
            content: `Attached file: ${payload.attachment.name}`,
            agent: 'manager' as const,
          }]
        : [];

      const voiceNote =
        payload.source === 'voice_transcription'
          ? [
              {
                id: getEntryId(),
                role: 'note' as const,
                content: 'Voice transcript captured.',
                agent: 'voice' as const,
              } satisfies ChatEntry,
            ]
          : [];

      setMessages((prev) => [...prev, userEntry, ...attachmentNote, ...voiceNote]);
      setIsLoading(true);
      setError(null);

      try {
        const response = await sendMessage(sessionId, conversationId, {
          content: normalizedContent,
          ...(payload.attachment ? { attachment: payload.attachment } : {}),
          ...(payload.source ? { source: payload.source } : {}),
        });
        if (response.sessionId && response.sessionId !== sessionId) {
          setSessionId(response.sessionId);
        }
        const replies: ChatEntry[] = response.responses.map((reply) => ({
          id: getEntryId(),
          role: 'agent',
          content: reply.content,
          agent: reply.agent,
          audio: reply.audio,
        }));

        const managerNote = response.managerNotes
          ? [{
              id: getEntryId(),
              role: 'note' as const,
              content: response.managerNotes,
              agent: 'manager' as const,
            }]
          : [];

        setMessages((prev) => [...prev, ...replies, ...managerNote]);

        const combinedTextParts = replies.map((reply) => reply.content).filter((part) => part.trim().length > 0);
        if (response.managerNotes && response.managerNotes.trim().length > 0) {
          combinedTextParts.push(response.managerNotes.trim());
        }

        let spoken = false;
        if (combinedTextParts.length > 0) {
          const speakFn = voiceModeRef.current?.speak;
          if (speakFn) {
            try {
              spoken = speakFn(combinedTextParts.join('\n\n'));
            } catch (err) {
              console.warn('[voiceMode] failed to queue speech', err);
            }
          }
        }

        if (!spoken) {
          const audioReply = response.responses.find((reply) => reply.audio);
          if (audioReply?.audio) {
            const audioUrl = `data:${audioReply.audio.mimeType};base64,${audioReply.audio.base64Data}`;
            const playback = new Audio(audioUrl);
            playback.play().catch((err) => {
              console.warn('[voiceMode] failed to autoplay agent audio', err);
            });
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to send message');
        setMessages((prev) => [
          ...prev,
          {
            id: getEntryId(),
            role: 'note',
            content: 'Message failed. Try again.',
          },
        ]);
      } finally {
        setIsLoading(false);
        setRecordingError(null);
      }
    },
    [conversationId, sessionId]
  );

  const handleVoiceTranscript = useCallback(async (transcript: string) => {
    const handler = sendConversationMessageRef.current;
    if (handler) {
      await handler({ content: transcript, source: 'voice_transcription' });
    }
  }, []);

  const voiceMode = useVoiceMode({ sessionId, conversationId, onTranscript: handleVoiceTranscript });

  useEffect(() => {
    sendConversationMessageRef.current = sendConversationMessage;
  }, [sendConversationMessage]);

  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  const canSend = useMemo(
    () =>
      Boolean(
        sessionId &&
          conversationId &&
          (input.trim().length > 0 || attachment) &&
          !isLoading &&
          !isRecording &&
          !isSessionResetting &&
          !voiceMode.isBusy
      ),
    [
      sessionId,
      conversationId,
      input,
      attachment,
      isLoading,
      isRecording,
      isSessionResetting,
      voiceMode.isBusy,
    ]
  );

  useEffect(() => {
    if (!sessionId) {
      const generated = ensureSessionId();
      setSessionId(generated);
    }
  }, [sessionId]);

  useEffect(() => {
    if (sessionId && typeof window !== 'undefined') {
      window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || conversationId) {
      return;
    }

    let cancelled = false;

    const boot = async () => {
      try {
        setError(null);
        const conversation = await createConversation(sessionId);
        if (cancelled) {
          return;
        }
        if (conversation.sessionId && conversation.sessionId !== sessionId) {
          setSessionId(conversation.sessionId);
        }
        setConversationId(conversation.id);
        setMessages(buildInitialMessages());
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to start conversation');
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
    };
  }, [sessionId, conversationId]);

  useEffect(() => {
    const supported =
      typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      'mediaDevices' in navigator &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      'MediaRecorder' in window;

    setRecordingSupported(supported);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!voiceAudioRef.current) {
      return;
    }
    if (voiceMode.remoteStream) {
      voiceAudioRef.current.srcObject = voiceMode.remoteStream;
      void voiceAudioRef.current.play().catch((err) => {
        console.warn('[voiceMode] failed to auto-play remote stream', err);
      });
    } else {
      voiceAudioRef.current.srcObject = null;
    }
  }, [voiceMode.remoteStream]);

  useEffect(() => {
    if (voiceMode.status === 'active') {
      console.debug('[voiceMode] active');
    }
  }, [voiceMode.status]);

  const handleToggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }

    if (!recordingSupported) {
      setRecordingError('Audio recording is not supported in this browser.');
      return;
    }

    try {
      setRecordingError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener('stop', () => {
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
        setIsRecording(false);

        if (blob.size === 0) {
          return;
        }

        const extension = blob.type.split('/')[1] ?? 'webm';
        const fileName = `voice-message-${Date.now()}.${extension}`;
        const file = new File([blob], fileName, { type: blob.type || 'audio/webm' });
        setAttachment(file);
      });

      recorder.addEventListener('error', (event) => {
        const maybeError = (event as unknown as { error?: { message?: string } }).error;
        const message = maybeError?.message ?? 'unknown error';
        setRecordingError(`Recorder error: ${message}`);
        stream.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
        setIsRecording(false);
      });

      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];
      setAttachment(null);
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      setRecordingError(err instanceof Error ? err.message : 'Failed to start recording');
      setIsRecording(false);
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;
    }
  };

  const handleAttachmentSelection = (file: File | null) => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
    }

    setRecordingError(null);
    setAttachment(file);
  };

  const handleNewSession = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
    }

    if (voiceMode.status !== 'idle') {
      voiceMode.stop();
    }

    setIsSessionResetting(true);
    setError(null);
    setRecordingError(null);

    try {
      const activeSessionId = sessionId ?? ensureSessionId();
      const response = await resetSession(activeSessionId);
      const nextId = response.sessionId ?? ensureSessionId();

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SESSION_STORAGE_KEY, nextId);
      }

      setSessionId(nextId);
      setConversationId(null);
      setMessages(buildInitialMessages());
      setAttachment(null);
      setInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset session');
    } finally {
      setIsSessionResetting(false);
    }
  };

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!sessionId || !conversationId || (!attachment && input.trim().length === 0)) {
      return;
    }

    const trimmed = input.trim();
    const messageContent = trimmed.length > 0 ? trimmed : '[Voice message]';
    setInput('');

    await sendConversationMessage({
      content: messageContent,
      ...(attachment ? { attachment } : {}),
    });

    setAttachment(null);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-row">
          <h1>Multi-Agent Playground</h1>
          <button
            type="button"
            className="session-button"
            onClick={handleNewSession}
            disabled={isSessionResetting || isLoading}
          >
            {isSessionResetting ? 'Resetting…' : 'New Session'}
          </button>
          <button
            type="button"
            className={`session-button voice${voiceMode.status === 'active' ? ' active' : ''}`}
            onClick={() => {
              if (voiceMode.status === 'active') {
                voiceMode.stop();
              } else {
                void voiceMode.start();
              }
            }}
            disabled={!conversationId || !sessionId || voiceMode.isBusy || isLoading || isSessionResetting}
          >
            {voiceMode.status === 'active'
              ? 'Stop Voice Mode'
              : voiceMode.isBusy
              ? 'Starting Voice…'
              : 'Start Voice Mode'}
          </button>
        </div>
        <p className="app-subtitle">Greeting · Summarizer · Time Helper · Input Coach · Voice</p>
        <div className="voice-status">
          <span>{`Voice: ${voiceMode.status}`}</span>
          {voiceMode.status === 'active' && (
            <span className={`voice-ready ${voiceMode.isReadyToListen ? 'ready' : 'pending'}`}>
              {voiceMode.isReadyToListen ? 'Listening now' : 'Preparing microphone…'}
            </span>
          )}
          {voiceMode.grant && (
            <span className="voice-meta">{`Model: ${voiceMode.grant.model ?? 'default'} · Voice: ${
              voiceMode.grant.voice ?? 'default'
            }`}</span>
          )}
        </div>
      </header>

      <main className="chat-container">
        <div className="chat-log" ref={scrollRef}>
          {messages.map((entry) => (
            <div key={entry.id} className={`chat-entry ${entry.role}`}>
              <div className="chat-meta">
                <span className={agentColor(entry.agent)}>
                  {entry.role === 'user' ? 'You' : formatAgentLabel(entry.agent ?? 'manager')}
                </span>
              </div>
              <div className="chat-bubble">
                <div className="chat-text">{entry.content}</div>
                {entry.audio && (
                  <div className="chat-audio">
                    <audio
                      controls
                      src={`data:${entry.audio.mimeType};base64,${entry.audio.base64Data}`}
                    >
                      <track kind="captions" />
                    </audio>
                    {entry.audio.description && (
                      <span className="audio-note">{entry.audio.description}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="chat-entry note">
              <div className="chat-meta">
                <span className="agent-chip">Agents</span>
              </div>
              <div className="chat-bubble">Thinking...</div>
            </div>
          )}
        </div>
      </main>

      <footer className="input-panel">
        <form onSubmit={handleSend} className="input-form">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask for a greeting, summary, time check, writing tips, or store a file..."
            rows={3}
            disabled={!conversationId || isLoading}
          />
          <div className="input-actions">
            <label className="file-button">
              <span>{attachment ? `Attached: ${attachment.name}` : 'Attach file'}</span>
              <input
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  handleAttachmentSelection(file);
                  event.target.value = '';
                }}
                accept=".pdf,.doc,.docx,.txt,.md,audio/*"
                disabled={isLoading || isRecording}
                hidden
              />
            </label>
            {recordingSupported && (
              <button
                type="button"
                className={`record-button${isRecording ? ' active' : ''}`}
                onClick={handleToggleRecording}
                disabled={isLoading}
              >
                {isRecording ? 'Stop recording' : 'Record audio'}
              </button>
            )}
            <button type="submit" disabled={!canSend}>
              Send
            </button>
          </div>
        </form>
        {recordingError && <p className="error-message">{recordingError}</p>}
        {error && <p className="error-message">{error}</p>}
        {voiceMode.error && <p className="error-message">{voiceMode.error}</p>}
        <audio ref={voiceAudioRef} className="voice-audio" autoPlay hidden />
      </footer>
    </div>
  );
};

export default App;
