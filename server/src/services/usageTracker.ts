import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

import type { UsageEvent } from '../types';
import { ensureStorageDir } from '../utils/fileUtils';

type UsageBucket = {
  day: string;
  count: number;
};

type BucketTable = Map<string, Map<UsageEvent, UsageBucket>>;

type TokenBucket = {
  day: string;
  prompt: number;
  completion: number;
  total: number;
};

type TokenTable = Map<string, TokenBucket>;

interface StoredUsageState {
  sessions: Record<string, Record<UsageEvent, UsageBucket>>;
  ips: Record<string, Record<UsageEvent, UsageBucket>>;
  tokenSessions?: Record<string, TokenBucket>;
  tokenIps?: Record<string, TokenBucket>;
}

export interface UsageCountContext {
  sessionId: string;
  ipAddress?: string;
}

export interface UsageRecordContext extends UsageCountContext {
  event: UsageEvent;
  units?: number;
}

export interface TokenUsageInput {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface TokenUsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface BucketWithReset {
  bucket: UsageBucket;
  reset: boolean;
}

interface TokenBucketWithReset {
  bucket: TokenBucket;
  reset: boolean;
}

const USAGE_FILENAME = 'usage.json';

const todayKey = (): string => new Date().toISOString().slice(0, 10);

export class UsageTracker {
  private readonly sessions: BucketTable = new Map();

  private readonly ips: BucketTable = new Map();

  private readonly tokenSessions: TokenTable = new Map();

  private readonly tokenIps: TokenTable = new Map();

  private storagePath: string | null = null;

  private initialized = false;

  private dirty = false;

  constructor(private readonly fileOverride?: string) {}

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.fileOverride) {
      this.storagePath = this.fileOverride;
    } else {
      const storageDir = await ensureStorageDir();
      this.storagePath = join(storageDir, USAGE_FILENAME);
    }

    try {
      const contents = await readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(contents) as StoredUsageState;
      this.hydrate(parsed);
    } catch {
      // No prior usage data available.
    }

    this.initialized = true;
  }

  private hydrate(state: StoredUsageState): void {
    const loadTable = (source: Record<string, Record<UsageEvent, UsageBucket>>, target: BucketTable) => {
      for (const [key, events] of Object.entries(source)) {
        const eventMap: Map<UsageEvent, UsageBucket> = new Map();
        for (const [event, bucket] of Object.entries(events) as Array<[UsageEvent, UsageBucket]>) {
          eventMap.set(event, { ...bucket });
        }
        target.set(key, eventMap);
      }
    };

    loadTable(state.sessions ?? {}, this.sessions);
    loadTable(state.ips ?? {}, this.ips);

    const loadTokenTable = (source: Record<string, TokenBucket> | undefined, target: TokenTable) => {
      if (!source) {
        return;
      }

      for (const [key, bucket] of Object.entries(source)) {
        target.set(key, { ...bucket });
      }
    };

    loadTokenTable(state.tokenSessions, this.tokenSessions);
    loadTokenTable(state.tokenIps, this.tokenIps);
  }

  private serialize(): StoredUsageState {
    const dumpTable = (source: BucketTable): Record<string, Record<UsageEvent, UsageBucket>> => {
      const result: Record<string, Record<UsageEvent, UsageBucket>> = {};
      for (const [key, events] of source.entries()) {
        result[key] = {} as Record<UsageEvent, UsageBucket>;
        for (const [event, bucket] of events.entries()) {
          result[key][event] = { ...bucket };
        }
      }
      return result;
    };

    const dumpTokenTable = (source: TokenTable): Record<string, TokenBucket> => {
      const result: Record<string, TokenBucket> = {};
      for (const [key, bucket] of source.entries()) {
        result[key] = { ...bucket };
      }
      return result;
    };

    return {
      sessions: dumpTable(this.sessions),
      ips: dumpTable(this.ips),
      tokenSessions: dumpTokenTable(this.tokenSessions),
      tokenIps: dumpTokenTable(this.tokenIps),
    } satisfies StoredUsageState;
  }

  private async persist(): Promise<void> {
    if (!this.storagePath) {
      await this.init();
    }

    if (!this.storagePath || !this.dirty) {
      return;
    }

    this.dirty = false;
    const payload = JSON.stringify(this.serialize(), null, 2);
    await writeFile(this.storagePath, payload, 'utf8');
  }

  private ensureBucket(table: BucketTable, key: string, event: UsageEvent): BucketWithReset {
    let eventMap = table.get(key);
    if (!eventMap) {
      eventMap = new Map();
      table.set(key, eventMap);
    }

    const currentDay = todayKey();
    let bucket = eventMap.get(event);
    let reset = false;

    if (!bucket) {
      bucket = { day: currentDay, count: 0 };
      eventMap.set(event, bucket);
      reset = true;
    } else if (bucket.day !== currentDay) {
      bucket.day = currentDay;
      bucket.count = 0;
      reset = true;
    }

    if (reset) {
      this.dirty = true;
    }

    return { bucket, reset };
  }

  private ensureTokenBucket(table: TokenTable, key: string): TokenBucketWithReset {
    const currentDay = todayKey();
    let bucket = table.get(key);
    let reset = false;

    if (!bucket) {
      bucket = { day: currentDay, prompt: 0, completion: 0, total: 0 };
      table.set(key, bucket);
      reset = true;
    } else if (bucket.day !== currentDay) {
      bucket.day = currentDay;
      bucket.prompt = 0;
      bucket.completion = 0;
      bucket.total = 0;
      reset = true;
    }

    if (reset) {
      this.dirty = true;
    }

    return { bucket, reset };
  }

  async getCount(event: UsageEvent, context: UsageCountContext): Promise<{ session: number; ip?: number }> {
    await this.init();

    const result: { session: number; ip?: number } = { session: 0 };
    let mutated = false;

    const { bucket: sessionBucket, reset: sessionReset } = this.ensureBucket(this.sessions, context.sessionId, event);
    result.session = sessionBucket.count;
    mutated ||= sessionReset;

    if (context.ipAddress) {
      const { bucket: ipBucket, reset: ipReset } = this.ensureBucket(this.ips, context.ipAddress, event);
      result.ip = ipBucket.count;
      mutated ||= ipReset;
    }

    if (mutated) {
      await this.persist();
    }

    return result;
  }

  async record(context: UsageRecordContext): Promise<void> {
    await this.init();

    const units = context.units ?? 1;

    const sessionBucket = this.ensureBucket(this.sessions, context.sessionId, context.event).bucket;
    sessionBucket.count += units;
    this.dirty = true;

    if (context.ipAddress) {
      const ipBucket = this.ensureBucket(this.ips, context.ipAddress, context.event).bucket;
      ipBucket.count += units;
      this.dirty = true;
    }

    await this.persist();
  }

  async getTokenUsage(context: UsageCountContext): Promise<{ session: TokenUsageTotals; ip?: TokenUsageTotals }> {
    await this.init();

    const summarizeBucket = (bucket: TokenBucket): TokenUsageTotals => ({
      promptTokens: bucket.prompt,
      completionTokens: bucket.completion,
      totalTokens: bucket.total,
    });

    const { bucket: sessionBucket, reset: sessionReset } = this.ensureTokenBucket(
      this.tokenSessions,
      context.sessionId
    );
    const result: { session: TokenUsageTotals; ip?: TokenUsageTotals } = {
      session: summarizeBucket(sessionBucket),
    };

    let mutated = sessionReset;

    if (context.ipAddress) {
      const { bucket: ipBucket, reset: ipReset } = this.ensureTokenBucket(
        this.tokenIps,
        context.ipAddress
      );
      result.ip = summarizeBucket(ipBucket);
      mutated ||= ipReset;
    }

    if (mutated) {
      await this.persist();
    }

    return result;
  }

  async recordTokens(
    context: UsageCountContext,
    tokens: TokenUsageInput
  ): Promise<{ session: TokenUsageTotals; ip?: TokenUsageTotals }> {
    await this.init();

    const prompt = typeof tokens.promptTokens === 'number' && Number.isFinite(tokens.promptTokens)
      ? Math.max(tokens.promptTokens, 0)
      : 0;
    const completion =
      typeof tokens.completionTokens === 'number' && Number.isFinite(tokens.completionTokens)
        ? Math.max(tokens.completionTokens, 0)
        : 0;
    const totalFromInput =
      typeof tokens.totalTokens === 'number' && Number.isFinite(tokens.totalTokens)
        ? Math.max(tokens.totalTokens, 0)
        : 0;
    const total = totalFromInput || prompt + completion;

    if (prompt === 0 && completion === 0 && total === 0) {
      return this.getTokenUsage(context);
    }

    const ensure = this.ensureTokenBucket(this.tokenSessions, context.sessionId);
    ensure.bucket.prompt += prompt;
    ensure.bucket.completion += completion;
    ensure.bucket.total += total;

    let mutated = true;

    let ipTotals: TokenUsageTotals | undefined;
    if (context.ipAddress) {
      const ipEnsure = this.ensureTokenBucket(this.tokenIps, context.ipAddress);
      ipEnsure.bucket.prompt += prompt;
      ipEnsure.bucket.completion += completion;
      ipEnsure.bucket.total += total;
      mutated ||= ipEnsure.reset;
      ipTotals = {
        promptTokens: ipEnsure.bucket.prompt,
        completionTokens: ipEnsure.bucket.completion,
        totalTokens: ipEnsure.bucket.total,
      } satisfies TokenUsageTotals;
    }

    if (mutated) {
      this.dirty = true;
    }

    await this.persist();

    return {
      session: {
        promptTokens: ensure.bucket.prompt,
        completionTokens: ensure.bucket.completion,
        totalTokens: ensure.bucket.total,
      },
      ...(ipTotals ? { ip: ipTotals } : {}),
    };
  }

  summarize(): StoredUsageState {
    return this.serialize();
  }
}
