import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { createConversation, formatAgentLabel, sendMessage } from './api';
import type { AgentReply, ChatEntry } from './types';
import './App.css';

const getEntryId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

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
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingSupported, setRecordingSupported] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const canSend = useMemo(
    () => Boolean(conversationId && (input.trim().length > 0 || attachment) && !isLoading && !isRecording),
    [conversationId, input, attachment, isLoading, isRecording]
  );

  useEffect(() => {
    const boot = async () => {
      try {
        const conversation = await createConversation();
        setConversationId(conversation.id);
        setMessages([
          {
            id: getEntryId(),
            role: 'note',
            content: 'Conversation ready. Say hi or ask for a recap, time check, or writing feedback.',
            agent: 'manager',
          },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start conversation');
      }
    };

    void boot();
  }, []);

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

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!conversationId || (!attachment && input.trim().length === 0)) {
      return;
    }

    const trimmed = input.trim();
    const messageContent = trimmed.length > 0 ? trimmed : '[Voice message]';
    const userEntry: ChatEntry = {
      id: getEntryId(),
      role: 'user',
      content: messageContent,
    };

    const attachmentNote = attachment
      ? [{
          id: getEntryId(),
          role: 'note' as const,
          content: `Attached file: ${attachment.name}`,
          agent: 'manager' as const,
        }]
      : [];

    setMessages((prev) => [...prev, userEntry, ...attachmentNote]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const response = await sendMessage(conversationId, messageContent, attachment ?? undefined);
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
      setAttachment(null);
      setRecordingError(null);
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Multi-Agent Playground</h1>
        <p className="app-subtitle">Greeting · Summarizer · Time Helper · Input Coach · Voice</p>
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
      </footer>
    </div>
  );
};

export default App;
