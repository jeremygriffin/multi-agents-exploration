import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { SessionManager } from '../sessionManager';

describe('SessionManager', () => {
  let tempDir: string;
  let manager: SessionManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'session-manager-'));
    const storageFile = join(tempDir, 'sessions.json');
    manager = new SessionManager(storageFile);
    await manager.init();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates and reuses sessions when provided with a valid identifier', async () => {
    const first = await manager.ensureSession();
    expect(first.wasCreated).toBe(true);
    expect(first.session.id).toBeDefined();

    const second = await manager.ensureSession({ requestedId: first.session.id });
    expect(second.wasCreated).toBe(false);
    expect(second.session.id).toBe(first.session.id);
  });

  it('rotates sessions on reset and marks the prior session as expired', async () => {
    const initial = await manager.ensureSession();
    const rotated = await manager.resetSession(initial.session.id);

    expect(rotated.id).not.toBe(initial.session.id);

    const summary = manager.summarize();
    const prior = summary.find((entry) => entry.id === initial.session.id);

    expect(prior?.expiredAt).toBeTypeOf('number');
    expect(summary.some((entry) => entry.id === rotated.id)).toBe(true);
  });
});
