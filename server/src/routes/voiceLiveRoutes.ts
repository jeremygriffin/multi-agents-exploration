import { Router } from 'express';

import { requireSessionContext } from '../middleware/sessionMiddleware';
import type { Orchestrator } from '../orchestrator';
import type {
  LiveVoiceOfferRequest,
  LiveVoiceService,
  LiveVoiceSessionRequest,
} from '../services/liveVoiceService';

export const createVoiceLiveRouter = (
  orchestrator: Orchestrator,
  liveVoice: LiveVoiceService
): Router => {
  const router = Router();

  router.post('/session', async (req, res, next) => {
    try {
      const { sessionId, ipAddress } = requireSessionContext(req);
      const { conversationId } = req.body as { conversationId?: string };

      if (!conversationId) {
        res.status(400).json({ error: 'conversationId is required' });
        return;
      }

      const conversation = orchestrator.getConversation(conversationId);

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      if (conversation.sessionId !== sessionId) {
        res.status(403).json({ error: 'Conversation does not belong to the active session' });
        return;
      }

      const payload: LiveVoiceSessionRequest = {
        conversationId,
        sessionId,
        ...(ipAddress ? { ipAddress } : {}),
      };
      const outcome = await liveVoice.createSession(payload);

      if (outcome.status === 'disabled') {
        res.status(404).json({ error: outcome.message });
        return;
      }

      if (outcome.status === 'blocked') {
        res.status(429).json({ error: outcome.message });
        return;
      }

      res.status(200).json(outcome);
    } catch (error) {
      next(error);
    }
  });

  router.post('/offer', async (req, res, next) => {
    try {
      if (!liveVoice.isEnabled()) {
        res.status(404).json({ error: 'Live voice mode is not enabled on this server.' });
        return;
      }

      const { sessionId, ipAddress } = requireSessionContext(req);
      const { conversationId, sdp, type } = req.body as {
        conversationId?: string;
        sdp?: string;
        type?: 'offer' | 'answer';
      };

      if (!conversationId || !sdp) {
        res.status(400).json({ error: 'conversationId and sdp are required' });
        return;
      }

      const conversation = orchestrator.getConversation(conversationId);

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      if (conversation.sessionId !== sessionId) {
        res.status(403).json({ error: 'Conversation does not belong to the active session' });
        return;
      }

      const offerRequest: LiveVoiceOfferRequest = {
        conversationId,
        sessionId,
        sdp,
        ...(typeof type === 'string' ? { type } : {}),
        ...(ipAddress ? { ipAddress } : {}),
      };

      const outcome = await liveVoice.handleOffer(offerRequest);

      res.status(200).json(outcome);
    } catch (error) {
      next(error);
    }
  });

  return router;
};
