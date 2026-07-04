import { createServer } from 'node:http';
import express from 'express';
import { config } from './config.js';
import { initCloudKey, cloudPublicKeyPem } from './crypto.js';
import { initCloudWebSocket } from './ws.js';
import { accountsRouter } from './routes/accounts.js';
import { serversRouter } from './routes/servers.js';
import { invitesRouter } from './routes/invites.js';
import { deviceCodeRouter } from './routes/deviceCode.js';

/**
 * Whats On Cloud — the control plane (doc 02 §4). Rendezvous + address book +
 * reachability oracle. It never sees media, watch state, service tokens, PINs,
 * or (v1) any stream — only accounts, server registrations, current addresses,
 * invites, and grants.
 *
 * Deploy on App Service or a small container (NOT Functions — the WSS needs a
 * long-lived socket). See README.md.
 */

// Ensure the Ed25519 signing key exists before anything can issue a grant.
initCloudKey();

const app = express();
app.use(express.json());

// Liveness + the pinned public key (published so the backend/app build can pin
// it; it is NOT trusted over the wire — no TOFU, per finding M5).
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/cloud-key', (_req, res) => res.type('text/plain').send(cloudPublicKeyPem()));

app.use('/api', accountsRouter);
app.use('/api', serversRouter);
app.use('/api', invitesRouter);
app.use('/api', deviceCodeRouter);

// Terminal error handler — generic body, detail server-side.
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(`[cloud] error on ${req.method} ${req.originalUrl}:`, err);
  if (!res.headersSent) res.status(500).json({ error: 'internal error' });
});

const server = createServer(app);
initCloudWebSocket(server);

server.listen(config.port, () => {
  console.log(`[cloud] control plane on :${config.port}  (domain ${config.cloudDomain})`);
});
