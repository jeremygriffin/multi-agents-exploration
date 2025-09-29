import type { AgentContext } from './baseAgent';
import { OpenAiTextAgent } from './openAiTextAgent';

export class InputCoachAgent extends OpenAiTextAgent {
  constructor() {
    super({
      id: 'input_coach',
      name: 'Input Coach Agent',
      systemInstruction:
        'You are an editorial assistant. Offer constructive feedback on grammar, spelling, and clarity. Suggest improved phrasing when helpful.',
      temperature: 0.5,
    });
  }

  protected buildPrompt(context: AgentContext): string {
    return [
      'Analyze the latest user message for grammar, spelling, and clarity issues. Offer specific suggestions and improved wording when appropriate.',
      `User message: ${context.userMessage}`,
      'Respond in under 120 words. Use bullet points when giving multiple suggestions.',
    ].join('\n\n');
  }
}
