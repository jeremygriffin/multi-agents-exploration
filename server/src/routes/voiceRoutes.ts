import { Router, type Response } from 'express';

import { requireSessionContext } from '../middleware/sessionMiddleware';
import type { UsageLimitService, UsageDecision } from '../services/usageLimitService';
import { VoiceSessionService, VoiceSessionError } from '../services/voiceSessionService';

const respondWithLimit = (res: Response, decision: UsageDecision) => {
  const message = decision.message ?? 'Usage limit reached. Please try again later.';
  res.status(429).json({ error: message, event: decision.event, scope: decision.limitType });
};

export const createVoiceRouter = (
  voiceSessions: VoiceSessionService,
  usageLimits: UsageLimitService
): Router => {
  const router = Router();

  router.post('/sessions', async (req, res, next) => {
    try {
      const { sessionId, ipAddress, metadata } = requireSessionContext(req);
      const { conversationId } = req.body as { conversationId?: string };

      if (!conversationId || typeof conversationId !== 'string') {
        res.status(400).json({ error: 'conversationId is required' });
        return;
      }

      const limitDecision = await usageLimits.consume('voice_session', {
        sessionId,
        conversationId,
        ...(ipAddress ? { ipAddress } : {}),
      });

      if (!limitDecision.allowed) {
        respondWithLimit(res, limitDecision);
        return;
      }

      const requestOptions: {
        conversationId: string;
        sessionId: string;
        ipAddress?: string;
        userAgent?: string;
      } = {
        conversationId,
        sessionId,
      };

      if (ipAddress) {
        requestOptions.ipAddress = ipAddress;
      }

      if (metadata.userAgent) {
        requestOptions.userAgent = metadata.userAgent;
      }

      const grant = await voiceSessions.createVoiceSession(requestOptions);

      res.status(201).json({ grant });
    } catch (error) {
      if (error instanceof VoiceSessionError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  return router;
};
