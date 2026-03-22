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
    dotenv.config({ path: envPath });
    console.log(`[Config] Loaded .env from: ${envPath}`);
    envLoaded = true;
  }
}
if (!envLoaded) {
  dotenv.config(); // Default behavior — tries cwd
  console.warn('[Config] No .env file found in any searched location');
}
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { homeRouter } from './routes/home.js';
import { tvRouter } from './routes/tv.js';
import { moviesRouter } from './routes/movies.js';
import { searchRouter } from './routes/search.js';
import { scrobbleRouter } from './routes/scrobble.js';
import { configRouter } from './routes/config.js';
import { healthRouter } from './routes/health.js';
import { artworkRouter } from './routes/artwork.js';
import { debugRouter } from './routes/debug.js';
import { discoverRouter } from './routes/discover.js';
import { addRouter } from './routes/add.js';
import { playbackRouter } from './routes/playback.js';

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api', healthRouter);
app.use('/api', homeRouter);
app.use('/api', tvRouter);
app.use('/api', moviesRouter);
app.use('/api', searchRouter);
app.use('/api', scrobbleRouter);
app.use('/api', configRouter);
app.use('/api', artworkRouter);
app.use('/api', debugRouter);
app.use('/api', discoverRouter);
app.use('/api', addRouter);
app.use('/api', playbackRouter);

// Start listening immediately, discover services in the background
app.listen(config.port, () => {
  console.log(`[Whats On API] Ready on port ${config.port}`);
  console.log(`[Whats On API] .env loaded from: ${process.cwd()}`);
  console.log(
    `[Plex] ${config.plex.token ? (config.plex.url ? `Direct: ${config.plex.url}` : 'Auto-discover via plex.tv') : 'Not configured'}`,
  );
  console.log(`[Sonarr] ${config.sonarr.url || 'Not configured'}`);
  console.log(`[Radarr] ${config.radarr.url || 'Not configured'}`);
  console.log(`[EPG] Provider: ${config.epg.provider}, Country: ${config.epg.country}`);
});
