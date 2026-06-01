import { spawn, ChildProcess, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Per-source live-stream → HLS transmux. Spawns ffmpeg as a child
 * process and writes HLS segments to disk under
 * `<data-dir>/livetv-hls/<sessionId>/`. Clients fetch the playlist
 * and segments via the public `/api/live/hls/:sessionId/:file`
 * route.
 *
 * Why this exists:
 *  - Roku decodes MPEG-2 video in MPEG-TS but doesn't reliably pick
 *    up AC-3 audio elementary streams from HDHomeRun's raw OTA feed.
 *  - Browsers don't decode MPEG-TS at all and need HLS for the
 *    HTML5 <video> + hls.js stack to play anything.
 *
 * Approach:
 *  - Re-encode video to H.264 (libx264 veryfast) — ensures Roku
 *    HLS compatibility regardless of upstream codec (MPEG-2 OTA or
 *    HEVC ATSC 3.0).
 *  - Re-encode audio to AAC stereo — universally decoded.
 *  - 4-second segments, 6-segment rolling window. `delete_segments`
 *    keeps disk usage bounded. `independent_segments` lets clients
 *    join mid-stream without waiting for a keyframe from the start.
 *
 * Sessions are reaped after IDLE_TIMEOUT_MS of no segment fetches.
 */

interface HlsSession {
  id: string;
  channelId: string;
  sourceUrl: string;
  proc: ChildProcess;
  dir: string;
  startedAt: number;
  lastAccessAt: number;
  ready: boolean;
}

const IDLE_TIMEOUT_MS = 2 * 60 * 1000;  // 2 min — typical user tab close grace
const STARTUP_WAIT_MS = 8 * 1000;       // wait up to 8s for first .ts segment

let baseDir: string | null = null;
let resolvedFfmpegPath: string | null = null;
const sessions = new Map<string, HlsSession>();

// Per-channel session reuse — if a session already exists for the
// same channel and it's still ready, hand back the same playlist URL
// instead of spawning a duplicate ffmpeg.
const byChannel = new Map<string, string>(); // channelId → sessionId

/**
 * Resolve ffmpeg's absolute path. NSSM services run as a
 * non-interactive account whose PATH usually doesn't include
 * WinGet / Chocolatey shims — so `spawn('ffmpeg', ...)` that works
 * from a dev shell can silently fail under the service. Try:
 *   1. FFMPEG_PATH env var
 *   2. PATH lookup (where/which, via execFile to avoid shell parsing)
 *   3. Common install dirs (WinGet, Chocolatey, Program Files, brew)
 *   4. Bare 'ffmpeg' (last-resort, will fail loudly if not on PATH)
 * Cached for process lifetime.
 */
function resolveFfmpegPath(): string {
  if (resolvedFfmpegPath) return resolvedFfmpegPath;

  const env = (process.env.FFMPEG_PATH || '').trim();
  if (env && fs.existsSync(env)) {
    console.log(`[hls] using ffmpeg from FFMPEG_PATH=${env}`);
    resolvedFfmpegPath = env;
    return env;
  }

  // PATH lookup via where/which. execFileSync — no shell parsing,
  // no user input — finds the resolved binary path on stdout.
  try {
    const tool = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(tool, ['ffmpeg'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const first = out.split(/\r?\n/)[0]?.trim();
    if (first && fs.existsSync(first)) {
      console.log(`[hls] using ffmpeg from PATH: ${first}`);
      resolvedFfmpegPath = first;
      return first;
    }
  } catch {}

  // Common install dirs
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const programData = process.env.ProgramData || 'C:\\ProgramData';
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    candidates.push(
      path.join(programData, 'WhatsOn', 'ffmpeg.exe'),
      path.join(programData, 'chocolatey', 'bin', 'ffmpeg.exe'),
      path.join(programFiles, 'ffmpeg', 'bin', 'ffmpeg.exe'),
      path.join(programFiles, 'gyan.dev', 'ffmpeg', 'bin', 'ffmpeg.exe'),
      path.join(programFilesX86, 'ffmpeg', 'bin', 'ffmpeg.exe'),
    );
    const userLocal = process.env.LOCALAPPDATA;
    if (userLocal) {
      candidates.push(path.join(userLocal, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'));
    }
  } else {
    candidates.push('/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg');
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log(`[hls] using ffmpeg from known install dir: ${p}`);
      resolvedFfmpegPath = p;
      return p;
    }
  }

  console.warn('[hls] ffmpeg not found in FFMPEG_PATH, PATH, or known install dirs — falling back to bare "ffmpeg"');
  resolvedFfmpegPath = 'ffmpeg';
  return 'ffmpeg';
}

/** True if ffmpeg can be located + responds to -version. */
export function isFfmpegAvailable(): boolean {
  try {
    const p = resolveFfmpegPath();
    execFileSync(p, ['-version'], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function getBaseDir(): string {
  if (baseDir) return baseDir;
  const candidates: string[] = [];
  if (process.env.WHATSON_DATA_DIR) candidates.push(process.env.WHATSON_DATA_DIR);
  if (process.platform === 'win32') candidates.push('C:\\ProgramData\\WhatsOn\\data');
  candidates.push(path.join(process.cwd(), 'data'));
  candidates.push(path.join(process.cwd(), 'packages', 'api', 'data'));
  for (const dir of candidates) {
    try {
      const sub = path.join(dir, 'livetv-hls');
      fs.mkdirSync(sub, { recursive: true });
      baseDir = sub;
      return sub;
    } catch {}
  }
  // Last-resort temp dir
  baseDir = path.join(process.cwd(), 'livetv-hls-tmp');
  try { fs.mkdirSync(baseDir, { recursive: true }); } catch {}
  return baseDir;
}

/**
 * Start (or return existing) HLS session for a live stream URL.
 * Resolves with the playlist URL relative to /api once the playlist
 * has been written by ffmpeg.
 */
export async function ensureHlsSession(channelId: string, sourceUrl: string): Promise<HlsSession> {
  const existingId = byChannel.get(channelId);
  if (existingId) {
    const s = sessions.get(existingId);
    if (s && s.ready && s.proc.exitCode === null) {
      s.lastAccessAt = Date.now();
      return s;
    }
    // Stale — clean up before starting fresh
    if (s) killSession(s);
  }

  const id = crypto.randomBytes(8).toString('hex');
  const dir = path.join(getBaseDir(), id);
  fs.mkdirSync(dir, { recursive: true });

  const playlistPath = path.join(dir, 'index.m3u8');
  const segmentPattern = path.join(dir, 'seg%05d.ts');

  // veryfast preset keeps CPU manageable for realtime; crf 23 gives
  // ~3-5 Mbps for 1080i broadcasts. -ac 2 forces stereo so we don't
  // hand Roku a 5.1 stream that might still cause downmix issues.
  //
  // -map 0:v:0? -map 0:a:0? — explicit first-video + first-audio
  // selection. The `?` makes it optional so ffmpeg doesn't error if
  // a track is missing (some test channels have video-only).
  //
  // -profile:a aac_low + -ar 48000 — Roku HLS spec wants AAC-LC at
  // a fixed sample rate. The default ffmpeg AAC encoder usually picks
  // these but pinning them avoids edge cases like 32kHz fallbacks.
  //
  // -loglevel info raised from warning so the input-stream listing
  // ("Stream #0:0: Video: mpeg2video..." / "Stream #0:1: Audio: ac3...")
  // lands in the backend log on every startup — makes diagnostics
  // possible without re-shipping.
  const args = [
    '-hide_banner', '-loglevel', 'info',
    '-fflags', '+genpts+discardcorrupt',
    '-i', sourceUrl,
    '-map', '0:v:0?', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '192k', '-ac', '2', '-ar', '48000',
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+independent_segments+omit_endlist',
    '-hls_segment_filename', segmentPattern,
    playlistPath,
  ];

  const ffmpegBin = resolveFfmpegPath();
  console.log(`[hls ${id}] starting ${ffmpegBin} for ${channelId}, source=${sourceUrl}`);
  const proc = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  // Without an 'error' listener, a spawn failure (ENOENT etc.)
  // becomes an uncaughtException. Catch + log instead so the failure
  // mode is "channel didn't tune, error in /api/logs" rather than
  // "process died".
  proc.on('error', (err) => {
    console.error(`[hls ${id}] ffmpeg spawn error: ${err.message} — is ffmpeg on PATH for the service account?`);
    sessions.delete(id);
    if (byChannel.get(channelId) === id) byChannel.delete(channelId);
  });

  proc.stderr.on('data', (chunk) => {
    // ffmpeg writes both info AND warnings/errors to stderr. We log
    // everything (truncated) so the input-stream listing is captured
    // on every session start — invaluable for "no audio" diagnosis.
    const text = chunk.toString();
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) console.log(`[hls ${id}] ${trimmed.slice(0, 240)}`);
    }
  });
  proc.on('exit', (code, signal) => {
    console.log(`[hls ${id}] ffmpeg exited code=${code} signal=${signal}`);
    sessions.delete(id);
    if (byChannel.get(channelId) === id) byChannel.delete(channelId);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  const session: HlsSession = {
    id,
    channelId,
    sourceUrl,
    proc,
    dir,
    startedAt: Date.now(),
    lastAccessAt: Date.now(),
    ready: false,
  };
  sessions.set(id, session);
  byChannel.set(channelId, id);

  // Wait for the playlist to land. ffmpeg writes it as soon as the
  // first segment is ready.
  await waitForPlaylist(playlistPath);
  session.ready = true;
  console.log(`[hls ${id}] ready for ${channelId} (${Date.now() - session.startedAt}ms)`);
  return session;
}

async function waitForPlaylist(playlistPath: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < STARTUP_WAIT_MS) {
    try {
      const stat = await fs.promises.stat(playlistPath);
      if (stat.size > 0) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('HLS transmux timed out — ffmpeg failed to produce a playlist within 8s');
}

export function getSession(sessionId: string): HlsSession | undefined {
  return sessions.get(sessionId);
}

export function touchSession(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (s) s.lastAccessAt = Date.now();
}

function killSession(s: HlsSession): void {
  try {
    if (s.proc.exitCode === null) s.proc.kill('SIGTERM');
  } catch {}
  sessions.delete(s.id);
  if (byChannel.get(s.channelId) === s.id) byChannel.delete(s.channelId);
  setTimeout(() => {
    try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch {}
  }, 1500);
}

// Idle reaper — runs every 30s, kills sessions whose lastAccess is
// older than IDLE_TIMEOUT_MS.
setInterval(() => {
  const now = Date.now();
  for (const s of sessions.values()) {
    if (now - s.lastAccessAt > IDLE_TIMEOUT_MS) {
      console.log(`[hls ${s.id}] idle timeout — reaping`);
      killSession(s);
    }
  }
}, 30 * 1000).unref?.();
