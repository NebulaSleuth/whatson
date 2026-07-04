/**
 * Route mounting split by network "surface" — the structural control from
 * docs/remote-access/01-security-hardening.md.
 *
 * The internet-facing remote listener must not expose admin routes. Rather
 * than auth-gate a growing route table (and eventually miss one), we mount
 * admin routers on the LAN surface *only*, so they are unreachable from the
 * remote listener by construction — `GET :3002/api/config` is a 404, not a
 * gated 200.
 *
 * This module has NO side effects (it never listens), so it is safe to import
 * from a test harness to build a remote app and assert the not-mounted
 * invariant.
 */
import type { Express, ErrorRequestHandler } from 'express';

import { userContext } from '../middleware/userContext.js';
import { apiAuth } from '../middleware/apiAuth.js';

// Consumer routers — the read/playback surface an app needs. Mounted on both
// the LAN and remote listeners.
import { healthRouter } from '../routes/health.js';
import { homeRouter } from '../routes/home.js';
import { tvRouter } from '../routes/tv.js';
import { moviesRouter } from '../routes/movies.js';
import { searchRouter } from '../routes/search.js';
import { scrobbleRouter } from '../routes/scrobble.js';
import { artworkRouter } from '../routes/artwork.js';
import { discoverRouter } from '../routes/discover.js';
import { playbackRouter } from '../routes/playback.js';
import { libraryRouter } from '../routes/library.js';
import { recommendationsRouter } from '../routes/recommendations.js';
import { liveRouter } from '../routes/live.js';
import { sportsRouter } from '../routes/sports.js';
import { usersRouter } from '../routes/users.js';
import { whatsonUsersRouter } from '../routes/whatsonUsers.js';
import { authRouter } from '../routes/auth.js';

// Admin routers — LAN surface only. Never mounted on the remote listener.
import { configRouter } from '../routes/config.js';
import { debugRouter } from '../routes/debug.js';
import { addRouter } from '../routes/add.js';
import { updateRouter } from '../routes/update.js';
import { logsRouter } from '../routes/logs.js';

export type Surface = 'lan' | 'remote';

/**
 * Mount `/api` middleware + routers on `app` for the given surface.
 *
 * Both surfaces get `userContext` + `apiAuth` and the consumer routers. Only
 * the LAN surface gets the admin routers. `setup` static and the web SPA are
 * mounted by the caller (LAN only) since they aren't `/api` routers.
 *
 * NOTE (M1 scope): a few consumer routers still bundle owner-only sub-routes
 * (`usersRouter` /select, `whatsonUsersRouter` CRUD, `authRouter` LAN pair
 * flow). Those are tightened in M2 via role separation before the remote
 * listener is enabled in production; the remote listener refuses to start
 * without an admin password today (see index.ts), so `apiAuth` already gates
 * every non-public path on it.
 */
export function mountApiRoutes(app: Express, surface: Surface): void {
  app.use('/api', userContext);
  app.use('/api', apiAuth);

  // Consumer routes — both surfaces.
  app.use('/api', usersRouter);
  app.use('/api', whatsonUsersRouter);
  app.use('/api', healthRouter);
  app.use('/api', homeRouter);
  app.use('/api', tvRouter);
  app.use('/api', moviesRouter);
  app.use('/api', searchRouter);
  app.use('/api', scrobbleRouter);
  app.use('/api', artworkRouter);
  app.use('/api', discoverRouter);
  app.use('/api', playbackRouter);
  app.use('/api', libraryRouter);
  app.use('/api', recommendationsRouter);
  app.use('/api', liveRouter);
  app.use('/api', authRouter);
  app.use('/api', sportsRouter);

  // Admin routes — LAN surface only. Unreachable on the remote listener.
  if (surface === 'lan') {
    app.use('/api', configRouter);
    app.use('/api', debugRouter);
    app.use('/api', addRouter);
    app.use('/api', updateRouter);
    app.use('/api', logsRouter);
  }
}

/**
 * Terminal error handler. Logs full detail server-side and returns a generic
 * message to the client — no stack traces or inner errors leak, which matters
 * once the surface faces the internet. Mount LAST, after all routes.
 */
export function makeErrorHandler(surface: Surface): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    console.error(`[${surface}] Unhandled error on ${req.method} ${req.originalUrl}:`, err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  };
}
