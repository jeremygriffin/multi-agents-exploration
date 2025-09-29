import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'path';

import { Orchestrator } from './orchestrator';
import { createConversationRouter } from './routes/conversationRoutes';
import { ConversationStore } from './services/conversationStore';
import { InteractionLogger } from './services/interactionLogger';

const requiredEnv = ['OPENAI_API_KEY'];
const missing = requiredEnv.filter((key) => !process.env[key]);

if (missing.length > 0) {
  // eslint-disable-next-line no-console
  console.warn(`Missing environment variables: ${missing.join(', ')}. The server may not function correctly.`);
}

const app = express();
app.use(cors());
app.use(express.json());

const store = new ConversationStore();
const logger = new InteractionLogger();
const orchestrator = new Orchestrator(store, logger);

app.use('/api/conversations', createConversationRouter(orchestrator, logger));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT ?? 3001);

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${port}`);
});
