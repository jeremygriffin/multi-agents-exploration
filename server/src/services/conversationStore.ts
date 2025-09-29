import { randomUUID } from 'crypto';

import type { ChatMessage, Conversation } from '../types';

export class ConversationStore {
  private readonly conversations = new Map<string, Conversation>();

  createConversation(): Conversation {
    const id = randomUUID();
    const conversation: Conversation = {
      id,
      createdAt: Date.now(),
      messages: [],
    };

    this.conversations.set(id, conversation);
    return conversation;
  }

  getConversation(id: string): Conversation | undefined {
    return this.conversations.get(id);
  }

  upsertConversation(conversation: Conversation): void {
    this.conversations.set(conversation.id, conversation);
  }

  appendMessage(conversationId: string, message: ChatMessage): Conversation {
    const conversation = this.getConversation(conversationId);

    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    conversation.messages = [...conversation.messages, message];

    this.conversations.set(conversationId, conversation);

    return conversation;
  }
}
