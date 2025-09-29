import type { AgentContext } from './baseAgent';
import { OpenAiTextAgent } from './openAiTextAgent';

export class GreetingAgent extends OpenAiTextAgent {
  constructor() {
    super({
      id: 'greeting',
      name: 'Greeting Agent',
      systemInstruction:
        'You are a warm concierge for a team of helper agents. Keep replies short (max 3 sentences) and encourage the user to share what they need.',
      temperature: 0.6,
    });
  }

  protected buildPrompt(context: AgentContext): string {
    const recentMessages = context.conversation.messages
      .slice(-3)
      .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');

    return [
      recentMessages ? `Recent exchange:\n${recentMessages}` : null,
      `New user message: ${context.userMessage}`,
      'Offer a concise greeting and mention that the summarizer, time helper, and input coach are ready to assist.',
    ]
      .filter(Boolean)
      .join('\n\n');
  }
}
