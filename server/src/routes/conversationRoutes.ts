import { Router } from 'express';

import type { Orchestrator } from '../orchestrator';
import type { InteractionLogger } from '../services/interactionLogger';

export const createConversationRouter = (
  orchestrator: Orchestrator,
  logger: InteractionLogger
): Router => {
  const router = Router();

  router.post('/', (_req, res) => {
    const conversation = orchestrator.createConversation();
    res.status(201).json({ id: conversation.id, createdAt: conversation.createdAt });
  });

  router.get('/:conversationId/messages', (req, res) => {
    const { conversationId } = req.params;

    const conversation = orchestrator.getConversation(conversationId);

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    res.json({ messages: conversation.messages, createdAt: conversation.createdAt });
  });

  router.post('/:conversationId/messages', async (req, res, next) => {
    try {
      const { conversationId } = req.params;
      const { content } = req.body as { content?: string };

      if (!content || content.trim().length === 0) {
        res.status(400).json({ error: 'Message content is required' });
        return;
      }

      const result = await orchestrator.handleUserMessage(conversationId, content.trim());
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:conversationId/log', async (req, res, next) => {
    try {
      const { conversationId } = req.params;
      const entries = await logger.read(conversationId, 200);
      res.json({ entries });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
