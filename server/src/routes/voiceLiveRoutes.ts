import { Router } from 'express';

import { requireSessionContext } from '../middleware/sessionMiddleware';
import type { Orchestrator } from '../orchestrator';
import type { LiveVoiceService } from '../services/liveVoiceService';

export const createVoiceLiveRouter = (
  orchestrator: Orchestrator,
  liveVoice: LiveVoiceService
): Router => {
  const router = Router();

  router.post('/session', async (req, res) => {
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

    const outcome = await liveVoice.createSession({ conversationId, sessionId, ipAddress });

    if (outcome.status === 'disabled') {
      res.status(404).json({ error: outcome.message });
      return;
    }

    res.status(202).json({
      status: outcome.status,
      message: outcome.message,
      notes: outcome.notes,
    });
  });

  router.post('/offer', (_req, res) => {
    if (!liveVoice.isEnabled()) {
      res.status(404).json({ error: 'Live voice mode is not enabled on this server.' });
      return;
    }

    res.status(501).json({ error: 'Live voice offer handling coming soon.' });
  });

  return router;
};
