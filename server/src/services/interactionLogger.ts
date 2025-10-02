import { mkdir, appendFile, readFile, readdir } from 'fs/promises';
import { join } from 'path';

import type { ConversationLogEntry } from '../types';

const LOG_DIR = join(process.cwd(), 'logs');

const ensureLogDir = async () => {
  await mkdir(LOG_DIR, { recursive: true });
};

export class InteractionLogger {
  async append(entry: ConversationLogEntry): Promise<void> {
    await ensureLogDir();

    const filename = entry.sessionId
      ? `${entry.sessionId}_${entry.conversationId}.log`
      : `${entry.conversationId}.log`;
    const filepath = join(LOG_DIR, filename);
    const line = `${JSON.stringify(entry)}\n`;

    await appendFile(filepath, line, { encoding: 'utf8' });
  }

  async read(conversationId: string, limit = 100): Promise<ConversationLogEntry[]> {
    await ensureLogDir();
    let filepath = join(LOG_DIR, `${conversationId}.log`);

    try {
      const files = await readdir(LOG_DIR);
      const matches = files
        .filter((name) => name.endsWith(`${conversationId}.log`))
        .sort((a, b) => {
          const aHasSession = a.includes('_') ? 1 : 0;
          const bHasSession = b.includes('_') ? 1 : 0;
          return bHasSession - aHasSession;
        });

      const latestMatch = matches[0];
      if (latestMatch) {
        filepath = join(LOG_DIR, latestMatch);
      }
    } catch {
      // ignore directory read errors; fallback to default path
    }

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
