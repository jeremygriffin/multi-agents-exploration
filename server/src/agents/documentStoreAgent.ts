import { writeFile } from 'fs/promises';
import { join } from 'path';
import pdfParse from 'pdf-parse';
import { convertToHtml } from 'mammoth';
import { OpenAIAgent } from 'openai-agents';

import type { Agent, AgentContext, AgentResult } from './baseAgent';
import { ensureStorageDir, buildStoredFilename } from '../utils/fileUtils';

const MAX_SUMMARY_INPUT = 6000; // characters

const extractText = async (buffer: Buffer, mimetype: string, originalName: string): Promise<string | null> => {
  if (mimetype === 'application/pdf') {
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }

  if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const { value } = await convertToHtml({ buffer });
    return value.replace(/<[^>]+>/g, ' ');
  }

  if (mimetype === 'text/plain' || mimetype === 'text/markdown' || mimetype.startsWith('text/')) {
    return buffer.toString('utf8');
  }

  if (originalName.toLowerCase().endsWith('.md') || originalName.toLowerCase().endsWith('.txt')) {
    return buffer.toString('utf8');
  }

  return null;
};

const summarizeText = async (text: string): Promise<string> => {
  const agent = new OpenAIAgent({
    model: 'gpt-4o-mini',
    temperature: 0.4,
    system_instruction: 'You summarize documents for storage metadata. Keep it under 120 words.',
  });

  const trimmed = text.length > MAX_SUMMARY_INPUT ? `${text.slice(0, MAX_SUMMARY_INPUT)}...` : text;
  const prompt = `Summarize the following document:

${trimmed}`;
  const result = await agent.createChatCompletion(prompt);
  return result.choices[0] ?? 'Summary unavailable.';
};

const readableSize = (size: number): string => {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export class DocumentStoreAgent implements Agent {
  readonly id = 'document_store';

  readonly name = 'Document Store Agent';

  async handle(context: AgentContext): Promise<AgentResult> {
    const attachment = context.attachments?.[0];

    if (!attachment) {
      return {
        content: 'No document was provided to store.',
        debug: { attachments: [] },
      };
    }

    const timestamp = Date.now();
    const storageDir = await ensureStorageDir();
    const storedName = buildStoredFilename(attachment.originalName, timestamp);
    const storedPath = join(storageDir, storedName);

    await writeFile(storedPath, attachment.buffer);

    const text = await extractText(attachment.buffer, attachment.mimetype, attachment.originalName);

    let summary = 'Summary unavailable for this file type.';
    if (text && text.trim().length > 0) {
      summary = await summarizeText(text);
    }

    const analysisContent = `# Document Analysis\n\n- Original filename: ${attachment.originalName}\n- Stored as: ${storedName}\n- MIME type: ${attachment.mimetype}\n- File size: ${readableSize(attachment.size)}\n- Session ID: ${context.sessionId}\n- Conversation ID: ${context.conversation.id}\n\n## Summary\n${summary}`;

    const analysisName = `${storedName}.analyse.md`;
    const analysisPath = join(storageDir, analysisName);
    await writeFile(analysisPath, analysisContent, 'utf8');

    return {
      content: `Stored the file as ${storedName} and generated ${analysisName}.\n\nSummary:\n${summary}`,
      debug: {
        storedPath,
        analysisPath,
        mimetype: attachment.mimetype,
        size: attachment.size,
        summary,
        sessionId: context.sessionId,
        conversationId: context.conversation.id,
      },
    };
  }
}
