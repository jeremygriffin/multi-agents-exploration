import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

import type { UsageEvent } from '../types';
import { ensureStorageDir } from '../utils/fileUtils';

type UsageBucket = {
  day: string;
  count: number;
};

type BucketTable = Map<string, Map<UsageEvent, UsageBucket>>;

interface StoredUsageState {
  sessions: Record<string, Record<UsageEvent, UsageBucket>>;
  ips: Record<string, Record<UsageEvent, UsageBucket>>;
}

export interface UsageCountContext {
  sessionId: string;
  ipAddress?: string;
}

export interface UsageRecordContext extends UsageCountContext {
  event: UsageEvent;
  units?: number;
}

interface BucketWithReset {
  bucket: UsageBucket;
  reset: boolean;
}

const USAGE_FILENAME = 'usage.json';

const todayKey = (): string => new Date().toISOString().slice(0, 10);

export class UsageTracker {
  private readonly sessions: BucketTable = new Map();

  private readonly ips: BucketTable = new Map();

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

    return {
      sessions: dumpTable(this.sessions),
      ips: dumpTable(this.ips),
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

  summarize(): StoredUsageState {
    return this.serialize();
  }
}
