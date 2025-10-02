import { Router } from 'express';
import type { Response } from 'express';
import multer from 'multer';

import { requireSessionContext } from '../middleware/sessionMiddleware';
import type { Orchestrator } from '../orchestrator';
import type { InteractionLogger } from '../services/interactionLogger';
import type { UsageLimitService, UsageDecision } from '../services/usageLimitService';

const respondWithLimit = (res: Response, decision: UsageDecision) => {
  const message = decision.message ?? 'Usage limit reached. Please try again later.';
  return res.status(429).json({ error: message, event: decision.event, scope: decision.limitType });
};

export const createConversationRouter = (
  orchestrator: Orchestrator,
  logger: InteractionLogger,
  usageLimits: UsageLimitService
): Router => {
  const router = Router();
  const upload = multer();

  router.post('/', (req, res) => {
    const { sessionId, ipAddress } = requireSessionContext(req);
    const conversation = orchestrator.createConversation(sessionId, ipAddress);
    res.status(201).json({
      id: conversation.id,
      createdAt: conversation.createdAt,
      sessionId: conversation.sessionId,
    });
  });

  router.get('/:conversationId/messages', (req, res) => {
    const { conversationId } = req.params as { conversationId: string };
    const { sessionId } = requireSessionContext(req);

    const conversation = orchestrator.getConversation(conversationId);

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    if (conversation.sessionId !== sessionId) {
      res.status(403).json({ error: 'Conversation does not belong to the active session' });
      return;
    }

    res.json({ messages: conversation.messages, createdAt: conversation.createdAt });
  });

  router.post('/:conversationId/messages', upload.single('attachment'), async (req, res, next) => {
    try {
      const { conversationId } = req.params as { conversationId: string };
      const { content } = req.body as { content?: string };
      const { sessionId, ipAddress } = requireSessionContext(req);

      if (!content) {
        res.status(400).json({ error: 'Message content is required' });
        return;
      }

      const trimmed = content.trim();

      if (trimmed.length === 0) {
        res.status(400).json({ error: 'Message content is required' });
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

      const messageDecision = await usageLimits.consume('message', {
        sessionId,
        conversationId,
        ...(ipAddress ? { ipAddress } : {}),
      });

      if (!messageDecision.allowed) {
        respondWithLimit(res, messageDecision);
        return;
      }

      if (attachments && attachments.length > 0) {
        const fileDecision = await usageLimits.consume('file_upload', {
          sessionId,
          conversationId,
          units: attachments.length,
          ...(ipAddress ? { ipAddress } : {}),
        });

        if (!fileDecision.allowed) {
          respondWithLimit(res, fileDecision);
          return;
        }
      }

      const result = await orchestrator.handleUserMessage(
        conversationId,
        sessionId,
        trimmed,
        {
          ...(attachments ? { attachments } : {}),
          ...(ipAddress ? { ipAddress } : {}),
        }
      );
      res.json({
        ...result,
        sessionId,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('does not belong to session')) {
        res.status(403).json({ error: 'Conversation does not belong to the active session' });
        return;
      }

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
