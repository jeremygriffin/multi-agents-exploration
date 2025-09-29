import { mkdir, appendFile, readFile } from 'fs/promises';
import { join } from 'path';

import type { ConversationLogEntry } from '../types';

const LOG_DIR = join(process.cwd(), 'logs');

const ensureLogDir = async () => {
  await mkdir(LOG_DIR, { recursive: true });
};

export class InteractionLogger {
  async append(entry: ConversationLogEntry): Promise<void> {
    await ensureLogDir();

    const filepath = join(LOG_DIR, `${entry.conversationId}.log`);
    const line = `${JSON.stringify(entry)}\n`;

    await appendFile(filepath, line, { encoding: 'utf8' });
  }

  async read(conversationId: string, limit = 100): Promise<ConversationLogEntry[]> {
    await ensureLogDir();
    const filepath = join(LOG_DIR, `${conversationId}.log`);

    try {
      const contents = await readFile(filepath, 'utf8');
      const lines = contents
        .trim()
        .split('\n')
        .filter((line) => line.trim().length > 0);

      const sliced = lines.slice(-limit);

      return sliced
        .map((line) => {
          try {
            return JSON.parse(line) as ConversationLogEntry;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is ConversationLogEntry => entry !== null);
    } catch (error) {
      return [];
    }
  }
}
