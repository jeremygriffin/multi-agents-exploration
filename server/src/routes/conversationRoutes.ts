import { Router } from 'express';
import multer from 'multer';

import type { Orchestrator } from '../orchestrator';
import type { InteractionLogger } from '../services/interactionLogger';

export const createConversationRouter = (
  orchestrator: Orchestrator,
  logger: InteractionLogger
): Router => {
  const router = Router();
  const upload = multer();

  router.post('/', (_req, res) => {
    const conversation = orchestrator.createConversation();
    res.status(201).json({ id: conversation.id, createdAt: conversation.createdAt });
  });

  router.get('/:conversationId/messages', (req, res) => {
    const { conversationId } = req.params as { conversationId: string };

    const conversation = orchestrator.getConversation(conversationId);

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    res.json({ messages: conversation.messages, createdAt: conversation.createdAt });
  });

  router.post('/:conversationId/messages', upload.single('attachment'), async (req, res, next) => {
    try {
      const { conversationId } = req.params as { conversationId: string };
      const { content } = req.body as { content?: string };

      if (!content) {
        res.status(400).json({ error: 'Message content is required' });
        return;
      }

      const trimmed = content.trim();

      if (trimmed.length === 0) {
        res.status(400).json({ error: 'Message content is required' });
        return;
      }

      const attachments = req.file
        ? [
            {
              originalName: req.file.originalname,
              mimetype: req.file.mimetype,
              buffer: req.file.buffer,
              size: req.file.size,
            },
          ]
        : undefined;

      const result = await orchestrator.handleUserMessage(
        conversationId,
        trimmed,
        attachments ? { attachments } : undefined
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:conversationId/log', async (req, res, next) => {
    try {
      const { conversationId } = req.params as { conversationId: string };
      const entries = await logger.read(conversationId, 200);
      res.json({ entries });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
