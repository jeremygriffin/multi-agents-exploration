import type { NextFunction, Request, Response } from 'express';

import type { SessionManager } from '../services/sessionManager';
import type { SessionMetadata } from '../types';

export interface RequestSessionContext {
  sessionId: string;
  metadata: SessionMetadata;
  ipAddress?: string;
}

const extractIpAddress = (req: Request): string | undefined => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const [first] = forwarded.split(',');
    return first?.trim();
  }

  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0]?.trim();
  }

  return req.ip;
};

export const createSessionMiddleware = (sessions: SessionManager) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const requestedId = req.header('x-session-id') ?? undefined;
      const ipAddress = extractIpAddress(req);
      const userAgent = req.header('user-agent') ?? undefined;

      const ensureArgs: Parameters<typeof sessions.ensureSession>[0] = {};
      if (requestedId) {
        ensureArgs.requestedId = requestedId;
      }
      if (ipAddress) {
        ensureArgs.ipAddress = ipAddress;
      }
      if (userAgent) {
        ensureArgs.userAgent = userAgent;
      }

      const { session, wasCreated, wasRotated } = await sessions.ensureSession(ensureArgs);

      const context: RequestSessionContext = {
        sessionId: session.id,
        metadata: session,
        ...(ipAddress ? { ipAddress } : {}),
      };

      req.sessionContext = context;

      res.setHeader('x-session-id', session.id);
      if (wasCreated) {
        res.setHeader('x-session-status', wasRotated ? 'rotated' : 'new');
      }

      next();
    } catch (error) {
      next(error);
    }
  };

export const requireSessionContext = (req: Request): RequestSessionContext => {
  if (!req.sessionContext) {
    throw new Error('Session context is not available on the request.');
  }
  return req.sessionContext;
};
