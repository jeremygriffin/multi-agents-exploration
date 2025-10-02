import type { RequestSessionContext } from '../../middleware/sessionMiddleware';

declare module 'express-serve-static-core' {
  interface Request {
    sessionContext?: RequestSessionContext;
  }
}
