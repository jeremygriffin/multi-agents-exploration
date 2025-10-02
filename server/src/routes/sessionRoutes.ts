import { Router } from 'express';

import { requireSessionContext } from '../middleware/sessionMiddleware';
import type { SessionManager } from '../services/sessionManager';

export const createSessionRouter = (sessions: SessionManager): Router => {
  const router = Router();

  router.post('/reset', async (req, res, next) => {
    try {
      const current = req.sessionContext ?? null;
      const ipAddress = current?.ipAddress ?? req.ip;
      const userAgent = req.header('user-agent') ?? undefined;

      const nextSession = await sessions.resetSession(current?.sessionId, ipAddress, userAgent);

      req.sessionContext = {
        sessionId: nextSession.id,
        metadata: nextSession,
        ...(ipAddress ? { ipAddress } : {}),
      };

      res.setHeader('x-session-id', nextSession.id);
      res.setHeader('x-session-status', 'rotated');

      res.json({
        sessionId: nextSession.id,
        createdAt: nextSession.createdAt,
        lastSeen: nextSession.lastSeen,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/current', (req, res) => {
    const context = requireSessionContext(req);
    res.json({
      sessionId: context.sessionId,
      createdAt: context.metadata.createdAt,
      lastSeen: context.metadata.lastSeen,
      ipAddress: context.ipAddress,
    });
  });

  return router;
};
