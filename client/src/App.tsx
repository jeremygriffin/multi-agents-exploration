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
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const canSend = useMemo(
    () => Boolean(conversationId && input.trim().length > 0 && !isLoading),
    [conversationId, input, isLoading]
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
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!conversationId || input.trim().length === 0) {
      return;
    }

    const trimmed = input.trim();
    const userEntry: ChatEntry = {
      id: getEntryId(),
      role: 'user',
      content: trimmed,
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
      const response = await sendMessage(conversationId, trimmed, attachment ?? undefined);
      const replies: ChatEntry[] = response.responses.map((reply) => ({
        id: getEntryId(),
        role: 'agent',
        content: reply.content,
        agent: reply.agent,
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
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Multi-Agent Playground</h1>
        <p className="app-subtitle">Greeting · Summarizer · Time Helper · Input Coach</p>
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
              <div className="chat-bubble">{entry.content}</div>
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
                  setAttachment(file);
                }}
                accept=".pdf,.doc,.docx,.txt,.md"
                disabled={isLoading}
                hidden
              />
            </label>
            <button type="submit" disabled={!canSend}>
              Send
            </button>
          </div>
        </form>
        {error && <p className="error-message">{error}</p>}
      </footer>
    </div>
  );
};

export default App;
