import type { Request, Response, NextFunction } from 'express';
import { verifySession } from './crypto.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Cloud account id, set by requireAccount from the session bearer token. */
      accountId?: string;
    }
  }
}

function bearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return undefined;
  return h.slice('Bearer '.length).trim();
}

/** Gate a route on a valid account session (Authorization: Bearer <token>). */
export function requireAccount(req: Request, res: Response, next: NextFunction): void {
  const accountId = verifySession(bearer(req));
  if (!accountId) {
    res.status(401).json({ error: 'account authentication required' });
    return;
  }
  req.accountId = accountId;
  next();
}

export { bearer };
