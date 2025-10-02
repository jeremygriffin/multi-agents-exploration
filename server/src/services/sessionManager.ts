import { randomUUID } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

import type { SessionMetadata, SessionSummary } from '../types';
import { ensureStorageDir } from '../utils/fileUtils';

const SESSION_FILENAME = 'sessions.json';

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

interface StoredSessionRecord extends SessionMetadata {
  expiredAt?: number;
}

interface EnsureSessionArgs {
  requestedId?: string | null;
  ipAddress?: string;
  userAgent?: string;
}

interface EnsureSessionResult {
  session: SessionMetadata;
  wasCreated: boolean;
  wasRotated: boolean;
}

export class SessionManager {
  private readonly sessions = new Map<string, StoredSessionRecord>();

  private storagePath: string | null = null;

  private initialized = false;

  constructor(private readonly fileOverride?: string) {}

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.fileOverride) {
      this.storagePath = this.fileOverride;
    } else {
      const storageDir = await ensureStorageDir();
      this.storagePath = join(storageDir, SESSION_FILENAME);
    }

    try {
      const contents = await readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(contents) as StoredSessionRecord[];

      for (const record of parsed) {
        if (record.id && isUuid(record.id)) {
          this.sessions.set(record.id, record);
        }
      }
    } catch {
      // No existing session file, nothing to load yet.
    }

    this.initialized = true;
  }

  private async persist(): Promise<void> {
    if (!this.storagePath) {
      await this.init();
    }

    if (!this.storagePath) {
      return;
    }

    const serializable = Array.from(this.sessions.values());
    await writeFile(this.storagePath, JSON.stringify(serializable, null, 2), 'utf8');
  }

  private createSession(ipAddress?: string, userAgent?: string): StoredSessionRecord {
    const now = Date.now();
    const record: StoredSessionRecord = {
      id: randomUUID(),
      createdAt: now,
      lastSeen: now,
    };

    if (ipAddress) {
      record.ipAddress = ipAddress;
    }

    if (userAgent) {
      record.userAgent = userAgent;
    }

    return record;
  }

  async ensureSession(args: EnsureSessionArgs = {}): Promise<EnsureSessionResult> {
    await this.init();

    const { requestedId, ipAddress, userAgent } = args;

    let session: StoredSessionRecord | undefined;
    let wasCreated = false;
    let wasRotated = false;

    if (requestedId && isUuid(requestedId)) {
      session = this.sessions.get(requestedId);
    }

    if (!session) {
      session = this.createSession(ipAddress, userAgent);
      this.sessions.set(session.id, session);
      wasCreated = true;

      if (requestedId && isUuid(requestedId)) {
        wasRotated = true;
      }
    }

    const now = Date.now();
    session.lastSeen = now;
    if (ipAddress) {
      session.ipAddress = ipAddress;
    }
    if (userAgent) {
      session.userAgent = userAgent;
    }

    await this.persist();

    return {
      session,
      wasCreated,
      wasRotated,
    };
  }

  async resetSession(previousId?: string | null, ipAddress?: string, userAgent?: string): Promise<SessionMetadata> {
    await this.init();

    if (previousId && this.sessions.has(previousId)) {
      const prior = this.sessions.get(previousId)!;
      prior.expiredAt = Date.now();
      this.sessions.set(previousId, prior);
    }

    const next = this.createSession(ipAddress, userAgent);
    this.sessions.set(next.id, next);

    await this.persist();

    return next;
  }

  touchSession(sessionId: string, ipAddress?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.lastSeen = Date.now();
    if (ipAddress) {
      session.ipAddress = ipAddress;
    }
    this.sessions.set(sessionId, session);

    void this.persist();
  }

  getSession(sessionId: string): SessionMetadata | undefined {
    const session = this.sessions.get(sessionId);
    if (!session || session.expiredAt) {
      return undefined;
    }
    const metadata: SessionMetadata = {
      id: session.id,
      createdAt: session.createdAt,
      lastSeen: session.lastSeen,
    };

    if (session.ipAddress) {
      metadata.ipAddress = session.ipAddress;
    }

    if (session.userAgent) {
      metadata.userAgent = session.userAgent;
    }

    return metadata;
  }

  summarize(): SessionSummary[] {
    return Array.from(this.sessions.values()).map((session) => {
      const summary: SessionSummary = {
        id: session.id,
        createdAt: session.createdAt,
        lastSeen: session.lastSeen,
      };

      if (typeof session.expiredAt === 'number') {
        summary.expiredAt = session.expiredAt;
      }

      if (session.ipAddress) {
        summary.ipAddress = session.ipAddress;
      }

      return summary;
    });
  }
}
