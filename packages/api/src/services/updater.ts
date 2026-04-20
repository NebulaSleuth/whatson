import axios from 'axios';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { APP_VERSION } from '@whatson/shared';
import { config } from '../config.js';

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  prerelease: boolean;
  draft: boolean;
  assets: ReleaseAsset[];
  html_url: string;
  published_at: string;
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  assetName: string | null;
  downloadUrl: string | null;
  publishedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  enabled: boolean;
  platformSupported: boolean;
}

let lastStatus: UpdateStatus = buildInitialStatus();
let lastCheckMs = 0;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
const MIN_CHECK_INTERVAL_MS = 55 * 60 * 1000;

function buildInitialStatus(): UpdateStatus {
  return {
    currentVersion: APP_VERSION,
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: null,
    assetName: null,
    downloadUrl: null,
    publishedAt: null,
    lastCheckedAt: null,
    lastError: null,
    enabled: config.update.enabled,
    platformSupported: process.platform === 'win32',
  };
}

function parseVersion(v: string): number[] {
  return v
    .replace(/^v/i, '')
    .split(/[.\-+]/)
    .map((p) => parseInt(p, 10))
    .filter((n) => !Number.isNaN(n));
}

function isNewer(candidate: string, baseline: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(baseline);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] || 0;
    const bi = b[i] || 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return false;
}

function pickAsset(release: GitHubRelease): ReleaseAsset | null {
  if (process.platform !== 'win32') return null;
  const setup = release.assets.find((a) => /setup\.exe$/i.test(a.name));
  return setup || null;
}

export function getStatus(): UpdateStatus {
  return { ...lastStatus, enabled: config.update.enabled };
}

export async function checkForUpdate(force = false): Promise<UpdateStatus> {
  const now = Date.now();
  if (!force && now - lastCheckMs < MIN_CHECK_INTERVAL_MS) {
    return getStatus();
  }
  lastCheckMs = now;

  const repo = config.update.repo;
  const channel = config.update.channel;
  const url = channel === 'prerelease'
    ? `https://api.github.com/repos/${repo}/releases`
    : `https://api.github.com/repos/${repo}/releases/latest`;

  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'whatson-api',
        Accept: 'application/vnd.github+json',
      },
      timeout: 10000,
    });

    const release: GitHubRelease | null = Array.isArray(data)
      ? data.find((r: GitHubRelease) => !r.draft) || null
      : data;

    if (!release) {
      lastStatus = {
        ...buildInitialStatus(),
        lastCheckedAt: new Date().toISOString(),
        lastError: 'No releases found',
      };
      return lastStatus;
    }

    const latest = release.tag_name || '';
    const asset = pickAsset(release);
    const available = isNewer(latest, APP_VERSION);

    lastStatus = {
      currentVersion: APP_VERSION,
      latestVersion: latest,
      updateAvailable: available && !!asset,
      releaseUrl: release.html_url || null,
      assetName: asset?.name || null,
      downloadUrl: asset?.browser_download_url || null,
      publishedAt: release.published_at || null,
      lastCheckedAt: new Date().toISOString(),
      lastError: null,
      enabled: config.update.enabled,
      platformSupported: process.platform === 'win32',
    };

    console.log(
      `[Updater] Check: current=${APP_VERSION} latest=${latest} available=${lastStatus.updateAvailable}`,
    );
    return lastStatus;
  } catch (error) {
    const msg = (error as Error).message;
    console.warn(`[Updater] Check failed: ${msg}`);
    lastStatus = {
      ...getStatus(),
      lastCheckedAt: new Date().toISOString(),
      lastError: msg,
    };
    return lastStatus;
  }
}

export async function downloadAndApply(): Promise<{ started: boolean; reason?: string }> {
  if (process.platform !== 'win32') {
    return { started: false, reason: 'Auto-update only supported on Windows' };
  }
  if (!lastStatus.updateAvailable || !lastStatus.downloadUrl) {
    return { started: false, reason: 'No update available' };
  }

  const downloadUrl = lastStatus.downloadUrl;
  const tempDir = tmpdir();
  if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
  const tempPath = join(tempDir, `whatson-update-${Date.now()}.exe`);

  console.log(`[Updater] Downloading ${downloadUrl} → ${tempPath}`);
  try {
    const response = await axios.get(downloadUrl, {
      responseType: 'stream',
      timeout: 5 * 60 * 1000,
      headers: { 'User-Agent': 'whatson-api' },
    });
    const writer = createWriteStream(tempPath);
    await new Promise<void>((resolve, reject) => {
      response.data.pipe(writer);
      writer.on('finish', () => resolve());
      writer.on('error', reject);
      response.data.on('error', reject);
    });
  } catch (error) {
    const msg = (error as Error).message;
    console.error(`[Updater] Download failed: ${msg}`);
    return { started: false, reason: msg };
  }

  // NSIS /S = silent install. Detached so the installer survives when it stops our service.
  console.log(`[Updater] Launching installer silently: ${tempPath} /S`);
  try {
    const child = spawn('cmd.exe', ['/c', 'start', '""', '/B', tempPath, '/S'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch (error) {
    const msg = (error as Error).message;
    console.error(`[Updater] Spawn failed: ${msg}`);
    return { started: false, reason: msg };
  }

  return { started: true };
}

async function runScheduledCheck(): Promise<void> {
  if (!config.update.enabled) return;
  if (process.platform !== 'win32') return;

  try {
    await checkForUpdate();
    if (lastStatus.updateAvailable) {
      console.log(`[Updater] Applying update ${lastStatus.latestVersion}`);
      await downloadAndApply();
    }
  } catch (error) {
    console.warn('[Updater] Scheduled check errored:', (error as Error).message);
  }
}

export function startUpdateScheduler(): void {
  stopUpdateScheduler();
  if (!config.update.enabled) {
    console.log('[Updater] Auto-update disabled (AUTO_UPDATE=false)');
    return;
  }
  if (process.platform !== 'win32') {
    console.log(`[Updater] Auto-update disabled on ${process.platform}`);
    return;
  }

  console.log(
    `[Updater] Scheduler armed — repo=${config.update.repo} channel=${config.update.channel}, startup check in 60s then every 60m`,
  );
  startupTimer = setTimeout(runScheduledCheck, 60 * 1000);
  pollInterval = setInterval(runScheduledCheck, 60 * 60 * 1000);
}

export function stopUpdateScheduler(): void {
  if (startupTimer) clearTimeout(startupTimer);
  if (pollInterval) clearInterval(pollInterval);
  startupTimer = null;
  pollInterval = null;
}
