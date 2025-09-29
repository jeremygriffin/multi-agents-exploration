import type { AgentContext } from './baseAgent';
import { OpenAiTextAgent } from './openAiTextAgent';

export class SummarizerAgent extends OpenAiTextAgent {
  constructor() {
    super({
      id: 'summarizer',
      name: 'Summarizer Agent',
      systemInstruction:
        'You distill conversations into short bullet lists capturing key points, decisions, and follow-ups.',
      temperature: 0.4,
    });
  }

  protected buildPrompt(context: AgentContext): string {
    const transcript = context.conversation.messages
      .map((msg) => `${msg.role === 'user' ? 'User' : `Agent(${msg.agent ?? 'assistant'})`}: ${msg.content}`)
      .join('\n');

    return [
      'Summarize the conversation so far into 3 concise bullet points. Highlight action items when present.',
      'Conversation transcript:',
      transcript || 'No previous conversation.',
      `If the user has a specific summarization request, honor it:\n${context.userMessage}`,
    ].join('\n\n');
  }
}
