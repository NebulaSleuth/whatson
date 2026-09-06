/**
 * Download monitor — an opt-in background sweep of the Sonarr/Radarr queues
 * that removes completed downloads which will never import because they are
 * malicious or junk.
 *
 * Why: indexers regularly serve fake releases — an `.exe` (or script) named
 * like an episode, a "video" that's random bytes with an .mkv extension, or
 * an archive with nothing importable inside. Sonarr/Radarr *detect* most of
 * these ("Caution: Found executable file with extension: '.exe'", "No files
 * found are eligible for import …") but leave the item parked in the queue
 * with a warning, and the file sitting in the download folder where someone
 * could double-click it. This service closes that loop.
 *
 * Signals, in precedence order:
 *   1. Sonarr/Radarr's own import warnings (`statusMessages`) — the primary
 *      signal; needs no filesystem access.
 *   2. Optional local inspection of the download folder when
 *      DOWNLOAD_MONITOR_PATH_MAP lets this server reach it: executable /
 *      script extensions, magic-byte + ffprobe validation of video files.
 *   3. A stuck deadline: completed + un-imported for longer than
 *      DOWNLOAD_MONITOR_STUCK_MIN with no known-benign explanation.
 *
 * Action for a flagged item: DELETE /queue/{id}?removeFromClient=true&
 * blocklist=true (removes it from Sonarr/Radarr AND the download client,
 * which deletes the files, and remembers the release so it isn't re-grabbed),
 * delete any leftovers still visible via the path map, then re-search unless
 * Sonarr/Radarr's own auto-redownload-on-failure already does that.
 *
 * Known-benign warnings (not an upgrade, path not accessible, unpacking,
 * partial season, …) are never acted on — those are policy/config problems,
 * not bad releases.
 */
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../config.js';
import * as sonarr from './sonarr.js';
import * as radarr from './radarr.js';
import { flattenStatusMessages } from '../utils.js';
import { notifyDataChanged } from '../ws.js';
import { resolveFfprobePath } from './live/hlsProxy.js';

const execFileAsync = promisify(execFile);

export type MonitorSource = 'sonarr' | 'radarr';
export type Verdict = 'dangerous' | 'no-valid-video' | 'stuck';
export type Classification = Verdict | 'benign' | 'watching';

export interface MonitorAction {
  at: string;
  source: MonitorSource;
  queueId: number;
  title: string;
  verdict: Verdict;
  reasons: string[];
  outputPath?: string;
  dryRun: boolean;
  removed: boolean;
  researched: boolean;
  leftoversDeleted: boolean;
  error?: string;
}

/** A completed-but-not-imported queue item the monitor is currently tracking. */
export interface PendingItem {
  source: MonitorSource;
  queueId: number;
  title: string;
  state: string;
  warnings: string[];
  outputPath?: string;
  firstSeenAt: string;
  ageMinutes: number;
  classification: Classification;
  reasons: string[];
}

export interface SweepResult {
  at: string;
  dryRun: boolean;
  scanned: number;
  pending: number;
  flagged: number;
  removed: number;
  errors: number;
  durationMs: number;
}

export interface MonitorStatus {
  enabled: boolean;
  dryRun: boolean;
  intervalMinutes: number;
  stuckMinutes: number;
  research: boolean;
  pathMap: Array<{ remote: string; local: string }>;
  localInspection: boolean;
  ffprobe: string | null;
  running: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  lastRun: SweepResult | null;
  pending: PendingItem[];
  history: MonitorAction[];
}

// ── Classification tables ──────────────────────────────────────────────

/** Sonarr/Radarr's own "this release contains an executable" warnings. */
const DANGEROUS_MESSAGE = /executable file|dangerous file|potentially dangerous/i;

/** Inconclusive — Sonarr/Radarr couldn't read the file's runtime. Not a verdict. */
const UNCERTAIN_MESSAGE = /unable to determine/i;

/** Warnings that mean nothing importable was found / the video is not a video. */
const NO_VIDEO_MESSAGES: RegExp[] = [
  /no files found are eligible for import/i,
  /no video files/i,
  /not a valid video/i,
  /invalid video/i,
  /unsupported (file )?extension/i,
  /^sample$/i,
  /is a sample/i,
  /sample (file|video)/i,
  /unable to parse file/i,
];

/**
 * Warnings that explain a legitimate stall — never acted on, even past the
 * stuck deadline. These are policy or configuration problems for the admin
 * to resolve in Sonarr/Radarr, not bad releases.
 */
const BENIGN_MESSAGES: RegExp[] = [
  /not an upgrade/i,
  /same or better quality/i,
  /not a custom format upgrade/i,
  /already imported/i,
  /already exists/i,
  /path does not exist/i,
  /not accessible/i,
  /permission/i,
  /free space/i,
  /still being unpacked/i,
  /unpacking/i,
  /expected in this release were not imported/i,
  /tba title/i,
  /not monitored/i,
  /manual import required/i,
  /wasn't grabbed by/i,
  /not in a category/i,
  /does not contain intermediate path/i,
];

/**
 * Extensions that must never be imported. Anything here inside a download
 * folder marks the whole release as dangerous.
 */
const EXECUTABLE_EXTS = new Set([
  '.exe', '.com', '.scr', '.pif', '.msi', '.msp', '.msc', '.cpl', '.dll', '.sys', '.drv',
  '.bat', '.cmd', '.ps1', '.psm1', '.psd1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
  '.hta', '.reg', '.lnk', '.url', '.inf', '.jar', '.py', '.pyw', '.pyc', '.sh', '.bash',
  '.zsh', '.csh', '.ksh', '.fish', '.pl', '.rb', '.php', '.app', '.dmg', '.pkg', '.apk',
  '.deb', '.rpm', '.run', '.appimage', '.elf', '.so', '.dylib', '.scpt', '.command',
]);

/** Extensions Sonarr/Radarr consider video. */
const VIDEO_EXTS = new Set([
  '.mkv', '.mp4', '.m4v', '.avi', '.mov', '.wmv', '.ts', '.m2ts', '.mts', '.mpg', '.mpeg',
  '.webm', '.flv', '.divx', '.vob', '.ogm', '.ogv', '.3gp', '.rm', '.rmvb', '.asf', '.xvid',
]);

/** Disc images we can't cheaply validate — counted as valid so we never delete them. */
const UNVERIFIABLE_EXTS = new Set(['.iso', '.img']);

const HISTORY_CAP = 200;
const MAX_FILES_WALKED = 5000;
const MAX_VIDEOS_PROBED = 20;
const STARTUP_DELAY_MS = 30 * 1000;

// ── State ──────────────────────────────────────────────────────────────

interface PersistedState {
  firstSeen: Record<string, string>;
  history: MonitorAction[];
}

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'download-monitor.json');

let state: PersistedState | null = null;
let running = false;
let lastRunAt: string | null = null;
let lastError: string | null = null;
let lastRun: SweepResult | null = null;
let pending: PendingItem[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;

function loadState(): PersistedState {
  if (state) return state;
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    state = {
      firstSeen: raw?.firstSeen && typeof raw.firstSeen === 'object' ? raw.firstSeen : {},
      history: Array.isArray(raw?.history) ? raw.history : [],
    };
  } catch {
    state = { firstSeen: {}, history: [] };
  }
  return state;
}

function saveState(): void {
  if (!state) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn(`[DownloadMonitor] Could not persist state: ${(e as Error).message}`);
  }
}

// ── Path mapping + local inspection ────────────────────────────────────

interface Mapping { remote: string; local: string }

/** Translate a Sonarr/Radarr-side outputPath into a path this machine can open. */
export function mapToLocal(remotePath: string, pathMap: Mapping[]): { local: string; mapping: Mapping } | null {
  if (!remotePath) return null;
  const lower = remotePath.toLowerCase();
  // Longest prefix wins so /share/Public/TorrentDL beats /share/Public.
  const sorted = [...pathMap].sort((a, b) => b.remote.length - a.remote.length);
  for (const m of sorted) {
    if (!lower.startsWith(m.remote.toLowerCase())) continue;
    let rest = remotePath.slice(m.remote.length);
    const localUsesBackslash = m.local.includes('\\');
    rest = localUsesBackslash ? rest.replace(/\//g, '\\') : rest.replace(/\\/g, '/');
    const sep = localUsesBackslash ? '\\' : '/';
    const base = m.local.endsWith(sep) ? m.local : m.local + sep;
    const local = base + rest.replace(/^[\\/]+/, '');
    return { local, mapping: m };
  }
  return null;
}

interface Inspection {
  exists: boolean;
  totalFiles: number;
  executables: string[];
  validVideos: number;
  invalidVideos: string[];
}

function walk(root: string, out: string[]): void {
  const stack = [root];
  while (stack.length && out.length < MAX_FILES_WALKED) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile()) out.push(full);
      if (out.length >= MAX_FILES_WALKED) break;
    }
  }
}

/**
 * Cheap container check on the first bytes: the file claims to be video by
 * extension — does the header agree? False = definitely not a video.
 */
export function hasVideoMagic(file: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(400);
    const n = fs.readSync(fd, buf, 0, 400, 0);
    if (n < 12) return false;
    const b = buf.subarray(0, n);
    const ascii = (off: number, len: number) => b.toString('latin1', off, off + len);
    // Matroska / WebM (EBML)
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return true;
    // ISO BMFF: MP4 / MOV / M4V / 3GP — a box type at offset 4
    const box = ascii(4, 4);
    if (['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(box)) return true;
    // AVI (RIFF … 'AVI ')
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'AVI ') return true;
    // ASF / WMV
    if (b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2 && b[3] === 0x75) return true;
    // MPEG program stream (pack header) or elementary stream
    if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && (b[3] === 0xba || b[3] === 0xb3)) return true;
    // MPEG transport stream: sync byte every 188 bytes
    if (b[0] === 0x47 && (n < 189 || b[188] === 0x47) && (n < 377 || b[376] === 0x47)) return true;
    // FLV, Ogg, RealMedia
    if (ascii(0, 3) === 'FLV') return true;
    if (ascii(0, 4) === 'OggS') return true;
    if (ascii(0, 4) === '.RMF') return true;
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

/** ffprobe confirmation: does the file have at least one decodable video stream? */
async function ffprobeHasVideo(ffprobe: string, file: string): Promise<boolean | null> {
  try {
    const { stdout } = await execFileAsync(
      ffprobe,
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file],
      { timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    return stdout.trim().length > 0;
  } catch (e) {
    // A crash / non-zero exit means ffprobe couldn't read it as media at all.
    const err = e as { code?: string | number; killed?: boolean };
    if (err.killed || err.code === 'ENOENT') return null; // timeout or ffprobe missing: unknown
    return false;
  }
}

async function inspectLocal(localPath: string, ffprobe: string | null): Promise<Inspection> {
  const result: Inspection = { exists: false, totalFiles: 0, executables: [], validVideos: 0, invalidVideos: [] };
  let stat: fs.Stats;
  try {
    stat = fs.statSync(localPath);
  } catch {
    return result;
  }
  result.exists = true;

  const files: string[] = [];
  if (stat.isFile()) files.push(localPath);
  else walk(localPath, files);
  result.totalFiles = files.length;

  const videos: string[] = [];
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (EXECUTABLE_EXTS.has(ext)) result.executables.push(path.basename(f));
    else if (UNVERIFIABLE_EXTS.has(ext)) result.validVideos++;
    else if (VIDEO_EXTS.has(ext)) videos.push(f);
  }

  // Probe the largest candidates first — the main feature file is what matters.
  const sized = videos
    .map((f) => {
      try { return { f, size: fs.statSync(f).size }; } catch { return { f, size: 0 }; }
    })
    .sort((a, b) => b.size - a.size)
    .slice(0, MAX_VIDEOS_PROBED);

  for (const { f, size } of sized) {
    if (size === 0 || !hasVideoMagic(f)) {
      result.invalidVideos.push(path.basename(f));
      continue;
    }
    if (ffprobe) {
      const ok = await ffprobeHasVideo(ffprobe, f);
      if (ok === false) {
        result.invalidVideos.push(path.basename(f));
        continue;
      }
    }
    result.validVideos++;
  }
  return result;
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[^a-z0-9]+/g, '');
}

/**
 * Guard for deleting leftovers ourselves: the path must sit strictly inside
 * the mapped local root, and its basename must correspond to the release
 * title. Anything else (category root, an unrelated folder) is refused.
 */
export function isSafeToDelete(localPath: string, mapping: Mapping, title: string): boolean {
  const target = path.resolve(localPath);
  const root = path.resolve(mapping.local);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const base = normalizeTitle(path.basename(target));
  const want = normalizeTitle(title);
  if (!base || want.length < 8) return false;
  return base === want || base.includes(want) || want.includes(base);
}

function deleteLeftovers(localPath: string, mapping: Mapping, title: string): boolean {
  if (!fs.existsSync(localPath)) return false;
  if (!isSafeToDelete(localPath, mapping, title)) {
    console.warn(`[DownloadMonitor] Refusing to delete "${localPath}" — outside mapped root or name doesn't match release`);
    return false;
  }
  fs.rmSync(localPath, { recursive: true, force: true });
  return true;
}

// ── Queue analysis ─────────────────────────────────────────────────────

const UNIMPORTED_STATES = new Set(['importpending', 'importblocked', 'importfailed']);

/** True for a finished download that Sonarr/Radarr has not been able to import. */
function isUnimportedComplete(rec: any): boolean {
  const status = String(rec?.status || '').toLowerCase();
  const state = String(rec?.trackedDownloadState || '').toLowerCase();
  const tds = String(rec?.trackedDownloadStatus || '').toLowerCase();
  if (['downloading', 'queued', 'paused', 'delay', 'downloadclientunavailable'].includes(status)) return false;
  if (UNIMPORTED_STATES.has(state)) return true;
  return status === 'completed' && (tds === 'warning' || tds === 'error');
}

interface Analysis {
  classification: Classification;
  reasons: string[];
}

function classifyMessages(warnings: string[]): Analysis {
  const reasons: string[] = [];
  if (warnings.some((w) => DANGEROUS_MESSAGE.test(w))) {
    return { classification: 'dangerous', reasons: warnings.filter((w) => DANGEROUS_MESSAGE.test(w)) };
  }
  for (const w of warnings) {
    // "Unable to determine if file is a sample" is Sonarr saying it couldn't
    // read the runtime — inconclusive, not a verdict. Leave it to the
    // local-inspection / stuck rules rather than the "sample" pattern.
    if (UNCERTAIN_MESSAGE.test(w)) continue;
    if (NO_VIDEO_MESSAGES.some((re) => re.test(w))) reasons.push(w);
  }
  if (reasons.length) return { classification: 'no-valid-video', reasons };
  const benign = warnings.filter((w) => BENIGN_MESSAGES.some((re) => re.test(w)));
  if (benign.length) return { classification: 'benign', reasons: benign };
  return { classification: 'watching', reasons: [] };
}

async function analyse(
  rec: any,
  source: MonitorSource,
  firstSeenAt: string,
  now: number,
  ffprobe: string | null,
): Promise<PendingItem> {
  const warnings = flattenStatusMessages(rec?.statusMessages) || [];
  const item: PendingItem = {
    source,
    queueId: Number(rec?.id) || 0,
    title: String(rec?.title || ''),
    state: String(rec?.trackedDownloadState || rec?.status || ''),
    warnings,
    outputPath: rec?.outputPath || undefined,
    firstSeenAt,
    ageMinutes: Math.max(0, Math.round((now - new Date(firstSeenAt).getTime()) / 60000)),
    classification: 'watching',
    reasons: [],
  };

  const byMessage = classifyMessages(warnings);
  item.classification = byMessage.classification;
  item.reasons = byMessage.reasons;
  if (item.classification === 'dangerous' || item.classification === 'no-valid-video') return item;

  // Local inspection (when the folder is reachable) can upgrade a benign /
  // watching item to a definite verdict — an executable is an executable no
  // matter what else Sonarr says about the release.
  const mapped = item.outputPath ? mapToLocal(item.outputPath, config.downloadMonitor.pathMap) : null;
  if (mapped) {
    const insp = await inspectLocal(mapped.local, ffprobe);
    if (insp.exists) {
      if (insp.executables.length) {
        item.classification = 'dangerous';
        item.reasons = [`Executable file(s): ${insp.executables.slice(0, 5).join(', ')}`];
        return item;
      }
      if (item.classification !== 'benign' && insp.validVideos === 0) {
        item.classification = 'no-valid-video';
        item.reasons = insp.invalidVideos.length
          ? [`Not a valid video: ${insp.invalidVideos.slice(0, 5).join(', ')}`]
          : [insp.totalFiles ? `No video files among ${insp.totalFiles} file(s)` : 'Download folder is empty'];
        return item;
      }
    }
  }

  if (item.classification === 'benign') return item;

  const stuckMinutes = config.downloadMonitor.stuckMinutes;
  if (stuckMinutes > 0 && item.ageMinutes >= stuckMinutes) {
    item.classification = 'stuck';
    item.reasons = [
      `Un-imported for ${item.ageMinutes} min (limit ${stuckMinutes})`,
      ...warnings,
    ];
  }
  return item;
}

// ── Actions ────────────────────────────────────────────────────────────

async function act(item: PendingItem, rec: any, dryRun: boolean, autoRedownload: boolean): Promise<MonitorAction> {
  const action: MonitorAction = {
    at: new Date().toISOString(),
    source: item.source,
    queueId: item.queueId,
    title: item.title,
    verdict: item.classification as Verdict,
    reasons: item.reasons,
    outputPath: item.outputPath,
    dryRun,
    removed: false,
    researched: false,
    leftoversDeleted: false,
  };
  const tag = `[DownloadMonitor] ${item.source} "${item.title}" (${item.classification}: ${item.reasons[0] || ''})`;
  if (dryRun) {
    console.log(`${tag} — DRY RUN, would remove + blocklist`);
    return action;
  }

  try {
    if (item.source === 'sonarr') await sonarr.cancelDownload(item.queueId, true);
    else await radarr.cancelDownload(item.queueId, true);
    action.removed = true;
    console.log(`${tag} — removed from queue + download client, blocklisted`);
  } catch (e) {
    action.error = `remove failed: ${(e as Error).message}`;
    console.error(`${tag} — ${action.error}`);
    return action;
  }

  // Leftover cleanup — the download client normally deletes the files, but
  // a client that failed to (or a path it no longer tracks) leaves the
  // executable on disk. Only within the mapped root and only a path whose
  // name matches the release.
  const mapped = item.outputPath ? mapToLocal(item.outputPath, config.downloadMonitor.pathMap) : null;
  if (mapped) {
    try {
      action.leftoversDeleted = deleteLeftovers(mapped.local, mapped.mapping, item.title);
      if (action.leftoversDeleted) console.log(`${tag} — deleted leftovers at ${mapped.local}`);
    } catch (e) {
      action.error = `leftover cleanup failed: ${(e as Error).message}`;
      console.warn(`${tag} — ${action.error}`);
    }
  }

  // Re-search. Sonarr/Radarr with "Redownload Failed" on already queue a
  // search when a blocklisted item is removed; only search ourselves when
  // that's off, so we don't fire two searches per release.
  if (config.downloadMonitor.research && !autoRedownload) {
    try {
      if (item.source === 'sonarr') {
        const episodeId = Number(rec?.episodeId || rec?.episode?.id);
        if (episodeId) { await sonarr.searchEpisode(episodeId); action.researched = true; }
      } else {
        const movieId = Number(rec?.movieId || rec?.movie?.id);
        if (movieId) { await radarr.searchMovie(movieId); action.researched = true; }
      }
    } catch (e) {
      action.error = `re-search failed: ${(e as Error).message}`;
      console.warn(`${tag} — ${action.error}`);
    }
  } else if (config.downloadMonitor.research && autoRedownload) {
    action.researched = true; // delegated to Sonarr/Radarr
  }
  return action;
}

// ── Sweep ──────────────────────────────────────────────────────────────

function sourceConfigured(source: MonitorSource): boolean {
  const c = source === 'sonarr' ? config.sonarr : config.radarr;
  return Boolean(c.url && c.apiKey);
}

/**
 * One pass over both queues. `opts.dryRun` forces a no-op preview regardless
 * of config (used by the admin "Preview" button). Single-flight: a second
 * call while one is running returns the in-flight result.
 */
export async function runSweep(opts: { dryRun?: boolean } = {}): Promise<SweepResult> {
  if (running && lastRun) return lastRun;
  running = true;
  const started = Date.now();
  const dryRun = opts.dryRun ?? config.downloadMonitor.dryRun;
  const st = loadState();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const ffprobe = config.downloadMonitor.pathMap.length ? resolveFfprobePath() : null;
  const result: SweepResult = { at: nowIso, dryRun, scanned: 0, pending: 0, flagged: 0, removed: 0, errors: 0, durationMs: 0 };
  const nextPending: PendingItem[] = [];
  const liveKeys = new Set<string>();
  let anyRemoved = false;

  try {
    for (const source of ['sonarr', 'radarr'] as MonitorSource[]) {
      if (!sourceConfigured(source)) continue;
      const svc = source === 'sonarr' ? sonarr : radarr;
      let records: any[];
      try {
        records = await svc.getRawQueue();
      } catch (e) {
        console.warn(`[DownloadMonitor] ${source} queue fetch failed: ${(e as Error).message}`);
        result.errors++;
        // Keep firstSeen entries for this source alive so a transient outage
        // doesn't reset the stuck clock.
        for (const k of Object.keys(st.firstSeen)) if (k.startsWith(`${source}:`)) liveKeys.add(k);
        continue;
      }
      result.scanned += records.length;

      let autoRedownload = true;
      if (!dryRun) {
        try { autoRedownload = (await svc.getDownloadClientSettings()).autoRedownloadFailed; } catch {}
      }

      for (const rec of records) {
        if (!isUnimportedComplete(rec)) continue;
        const key = `${source}:${rec.id}`;
        liveKeys.add(key);
        if (!st.firstSeen[key]) st.firstSeen[key] = nowIso;
        const item = await analyse(rec, source, st.firstSeen[key], now, ffprobe);
        result.pending++;

        const actionable = item.classification === 'dangerous'
          || item.classification === 'no-valid-video'
          || item.classification === 'stuck';
        if (!actionable) {
          nextPending.push(item);
          continue;
        }

        result.flagged++;
        const action = await act(item, rec, dryRun, autoRedownload);
        if (action.removed) {
          result.removed++;
          anyRemoved = true;
          liveKeys.delete(key);
        } else {
          nextPending.push(item);
        }
        if (action.error) result.errors++;
        st.history.unshift(action);
      }
    }

    // Forget items that left the queue (imported or removed by someone else).
    for (const k of Object.keys(st.firstSeen)) if (!liveKeys.has(k)) delete st.firstSeen[k];
    if (st.history.length > HISTORY_CAP) st.history.length = HISTORY_CAP;
    saveState();
    lastError = null;
  } catch (e) {
    lastError = (e as Error).message;
    console.error(`[DownloadMonitor] Sweep failed: ${lastError}`);
    result.errors++;
  } finally {
    running = false;
  }

  result.durationMs = Date.now() - started;
  pending = nextPending;
  lastRun = result;
  lastRunAt = result.at;
  if (anyRemoved) notifyDataChanged('download-monitor', 'home', 'tv', 'movies');
  console.log(
    `[DownloadMonitor] Sweep${dryRun ? ' (dry run)' : ''}: ${result.scanned} queued, ${result.pending} un-imported, ${result.flagged} flagged, ${result.removed} removed, ${result.errors} errors, ${result.durationMs}ms`,
  );
  return result;
}

export function getStatus(): MonitorStatus {
  const cfg = config.downloadMonitor;
  return {
    enabled: cfg.enabled,
    dryRun: cfg.dryRun,
    intervalMinutes: cfg.intervalMinutes,
    stuckMinutes: cfg.stuckMinutes,
    research: cfg.research,
    pathMap: cfg.pathMap,
    localInspection: cfg.pathMap.length > 0,
    ffprobe: cfg.pathMap.length ? resolveFfprobePath() : null,
    running,
    lastRunAt,
    lastError,
    lastRun,
    pending,
    history: loadState().history,
  };
}

/** (Re)arm the scheduler from current config. Safe to call after a config save. */
export function startDownloadMonitor(): void {
  stopDownloadMonitor();
  const cfg = config.downloadMonitor;
  if (!cfg.enabled) {
    console.log('[DownloadMonitor] Disabled (DOWNLOAD_MONITOR=false)');
    return;
  }
  if (!sourceConfigured('sonarr') && !sourceConfigured('radarr')) {
    console.log('[DownloadMonitor] Enabled but neither Sonarr nor Radarr is configured — idle');
    return;
  }
  console.log(
    `[DownloadMonitor] Armed — every ${cfg.intervalMinutes}m, stuck after ${cfg.stuckMinutes || '∞'}m, ` +
    `${cfg.dryRun ? 'DRY RUN' : 'live'}, local inspection ${cfg.pathMap.length ? 'on' : 'off'}`,
  );
  const tick = () => { runSweep().catch(() => {}); };
  startupTimer = setTimeout(tick, STARTUP_DELAY_MS);
  timer = setInterval(tick, cfg.intervalMinutes * 60 * 1000);
}

export function stopDownloadMonitor(): void {
  if (startupTimer) clearTimeout(startupTimer);
  if (timer) clearInterval(timer);
  startupTimer = null;
  timer = null;
}

/** Exposed for the classification unit test harness. */
export const _internals = { classifyMessages, isUnimportedComplete, EXECUTABLE_EXTS, VIDEO_EXTS };
