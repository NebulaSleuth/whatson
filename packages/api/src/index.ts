import './logger.js'; // Must be first — captures all logs + uncaught errors to file

// Load .env — look next to the executable first, then cwd, then the module directory
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import dotenv from 'dotenv';

const programData = process.env.ProgramData || 'C:\\ProgramData';
const envPaths = [
  join(dirname(process.execPath), '.env'),            // Next to the .exe
  join(programData, 'WhatsOn', '.env'),               // C:\ProgramData\WhatsOn\.env (Windows service)
  join(process.cwd(), '.env'),                        // Current working directory
  join(__dirname, '..', '.env'),                      // Relative to dist/ (dev mode)
];

let envLoaded = false;
console.log('[Config] Searching for .env in:');
for (const envPath of envPaths) {
  const found = existsSync(envPath);
  console.log(`[Config]   ${found ? '✓' : '✗'} ${envPath}`);
  if (found && !envLoaded) {
    // override: true — replace any pre-set (possibly empty) env vars the service inherited.
    // Without this, dotenv silently skips keys that already exist in process.env.
    const result = dotenv.config({ path: envPath, override: true });
    if (result.error) {
      console.warn(`[Config] dotenv parse error for ${envPath}: ${result.error.message}`);
    } else {
      console.log(`[Config] Loaded .env from: ${envPath} (${Object.keys(result.parsed || {}).length} keys)`);
    }
    envLoaded = true;
  }
}
if (!envLoaded) {
  dotenv.config({ override: true });
  console.warn('[Config] No .env file found in any searched location');
}
// One-line sanity dump — values redacted. Lets us tell at a glance whether .env actually took effect.
console.log(
  `[Config] Sanity: PLEX_TOKEN=${(process.env.PLEX_TOKEN || '').length}ch, SONARR_URL=${process.env.SONARR_URL ? 'set' : 'empty'}, RADARR_URL=${process.env.RADARR_URL ? 'set' : 'empty'}`,
);
import { createServer } from 'http';
import express from 'express';
import { config, reloadConfig } from './config.js';
import { corsMiddleware, hostGuard } from './security/httpGuards.js';

// Some module's init code may have accessed the config Proxy before dotenv ran,
// memoizing an empty-env snapshot. Force a reload now that process.env is populated.
reloadConfig();
import { startUpdateScheduler } from './services/updater.js';
import { initWebSocket } from './ws.js';
import { mountApiRoutes, makeErrorHandler } from './server/surface.js';
import { startRemoteListener } from './server/remoteListener.js';
import { startCloudRegistration } from './services/cloud/registration.js';
import { startCertManager } from './services/cloud/certManager.js';
import { ensureDefaultAdmin } from './services/userBootstrap.js';

const app = express();

// Reject DNS-rebinding (public-domain Host headers) before anything else, then
// apply the CORS allowlist. See security/httpGuards.ts.
app.use(hostGuard);
app.use(corsMiddleware);
app.use(express.json());

// Serve the admin UI — check multiple locations for the admin/ directory
import { join as pathJoin, dirname as pathDirname } from 'path';
import { existsSync as fileExists } from 'fs';
import { setupRouter } from './routes/setup.js';
const adminCandidates = [
  pathJoin(__dirname, '..', 'admin'),                    // Dev mode (dist/../admin)
  pathJoin(pathDirname(process.execPath), 'admin'),      // Standalone (next to .exe)
  pathJoin(process.cwd(), 'admin'),                      // CWD fallback
];
for (const dir of adminCandidates) {
  if (fileExists(dir)) {
    app.use('/setup', express.static(dir));
    break;
  }
}
// Fallback: serve inline HTML if static files not found
app.use('/setup', setupRouter);

// Mount /api middleware (userContext + apiAuth) and all routers for the LAN
// surface — every route, including admin (config/logs/debug/update/add).
// See server/surface.ts.
mountApiRoutes(app, 'lan');

// Serve the web SPA at /. Mounted AFTER /api/* and /setup so those
// take precedence; the SPA fallback below catches anything else and
// returns index.html so client-side routes (/tv, /movies, …) work
// on hard refresh.
const webCandidates = [
  pathJoin(__dirname, '..', '..', '..', 'apps', 'web', 'dist'),  // dev mode (packages/api/dist/../../../apps/web/dist)
  pathJoin(__dirname, '..', 'web'),                              // bundled alongside admin/
  pathJoin(pathDirname(process.execPath), 'web'),                // standalone (next to .exe)
  pathJoin(process.cwd(), 'web'),
];
let webDir: string | undefined;
for (const dir of webCandidates) {
  if (fileExists(dir)) {
    webDir = dir;
    break;
  }
}
if (webDir) {
  console.log(`[Whats On API] Web UI dir: ${webDir}`);
  app.use(express.static(webDir));
  // SPA fallback: any GET that isn't /api or /setup and didn't match
  // a static file → serve index.html so React Router can handle it.
  app.get(/^\/(?!api\/|setup\/?|ws\/?).*/, (_req, res) => {
    res.sendFile(pathJoin(webDir!, 'index.html'));
  });
} else {
  console.log('[Whats On API] Web UI dir not found — / will 404 until apps/web/dist exists or web/ is bundled.');
}

// Terminal error handler — must be last. Logs detail, returns a generic body.
app.use(makeErrorHandler('lan'));

// Create HTTP server and attach WebSocket
const server = createServer(app);
initWebSocket(server);

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[Whats On API] Port ${config.port} is already in use. Retrying in 5 seconds...`);
    setTimeout(() => {
      server.close();
      server.listen(config.port);
    }, 5000);
  } else {
    console.error(`[Whats On API] Server error:`, err);
  }
});

// Eagerly discover Plex server on startup so artwork URLs work from the first request
import { getServerUrl } from './services/plex.js';
if (config.plex.token) {
  getServerUrl().then((url) => {
    if (url) console.log(`[Plex] Server discovered: ${url}`);
  }).catch(() => {});
}

server.listen(config.port, () => {
  console.log(`[Whats On API] Ready on port ${config.port}`);
  console.log(`[Whats On API] Admin UI: http://localhost:${config.port}/setup`);
  console.log(`[Whats On API] .env loaded from: ${process.cwd()}`);
  console.log(
    `[Plex] ${config.plex.token ? (config.plex.url ? `Direct: ${config.plex.url}` : 'Auto-discover via plex.tv') : 'Not configured'}`,
  );
  console.log(`[Sonarr] ${config.sonarr.url || 'Not configured'}`);
  console.log(`[Radarr] ${config.radarr.url || 'Not configured'}`);
  console.log(`[EPG] Provider: ${config.epg.provider}, Country: ${config.epg.country}`);
  startUpdateScheduler();
  // Unified user model (always-on): create a default admin Whats On user mapped
  // to the server's own identities when there are none. Best-effort; on failure
  // the app stays in legacy Plex mode until a user is created.
  ensureDefaultAdmin().catch((e) => console.warn('[bootstrap] ensureDefaultAdmin failed:', (e as Error).message));
});

// ── Remote listener (docs/remote-access/, M1) ─────────────────────────────
// A second, consumer-routes-only listener for internet-facing access. Off by
// default (REMOTE_ACCESS!=true) so the fleet is unchanged. When enabled it
// refuses to start unless its prerequisites are met, so it can never run open.
//
// M1 ships the structural split + surface hardening (no admin routes, no WS,
// generic error handler, trust proxy). Mandatory auth / roles / TLS are layered
// on in later milestones; today it leans on apiAuth, which is why an admin
// password is a hard prerequisite (without it apiAuth would run open).
// Runtime-toggleable via the /setup Remote Access panel; see remoteListener.ts.
startRemoteListener();
// Obtain/renew the per-server TLS cert and upgrade the listener to HTTPS
// (M8/8b). Self-guards: no-op unless remote access + a cloud URL are set.
startCertManager();

// Cloud registration client (M4). Self-guards: no-op unless remote access is
// enabled AND a CLOUD_URL is configured, so the fleet is unaffected by default.
startCloudRegistration();
