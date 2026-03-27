import type { TrackedItem, StreamingProvider } from '@whatson/shared';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');

// Active user ID for the current request context (set via setRequestUserId)
let _requestUserId: string | null = null;

/** Set the user ID for per-user data scoping */
export function setRequestUserId(userId: string | null): void {
  _requestUserId = userId;
}

function getUserDir(): string {
  if (_requestUserId) {
    return join(DATA_DIR, 'users', _requestUserId);
  }
  return DATA_DIR;
}

function ensureDataDir(): void {
  try { mkdirSync(getUserDir(), { recursive: true }); } catch {}
}

function trackedFile(): string { return join(getUserDir(), 'tracked.json'); }
function watchedFile(): string { return join(getUserDir(), 'watched.json'); }

function loadTracked(): TrackedItem[] {
  try {
    const f = trackedFile();
    if (!existsSync(f)) return [];
    return JSON.parse(readFileSync(f, 'utf-8'));
  } catch { return []; }
}

function saveTracked(items: TrackedItem[]): void {
  ensureDataDir();
  writeFileSync(trackedFile(), JSON.stringify(items, null, 2), 'utf-8');
}

// ── Watched State for Tracked Items ──

function loadWatched(): Set<string> {
  try {
    const f = watchedFile();
    if (!existsSync(f)) return new Set();
    return new Set(JSON.parse(readFileSync(f, 'utf-8')));
  } catch { return new Set(); }
}

function saveWatched(ids: Set<string>): void {
  ensureDataDir();
  writeFileSync(watchedFile(), JSON.stringify([...ids], null, 2), 'utf-8');
}

/**
 * Check if a tracked item or specific episode is watched.
 * Key format: "tmdbId" for shows/movies, "tmdbId-S1E2" for episodes
 */
export function isWatched(key: string): boolean {
  return loadWatched().has(key);
}

export function markWatched(key: string): void {
  const ids = loadWatched();
  ids.add(key);
  saveWatched(ids);
}

export function markUnwatched(key: string): void {
  const ids = loadWatched();
  ids.delete(key);
  saveWatched(ids);
}

/** Mark an entire show as watched (all tracked episodes) */
export function markShowWatched(tmdbId: number): void {
  const ids = loadWatched();
  ids.add(String(tmdbId));
  saveWatched(ids);
}

// ── CRUD ──

export function getAll(): TrackedItem[] {
  const watched = loadWatched();
  return loadTracked().filter((i) => !watched.has(String(i.tmdbId)));
}

export function getAllIncludingWatched(): TrackedItem[] {
  return loadTracked();
}

export function getByType(type: 'movie' | 'tv'): TrackedItem[] {
  const watched = loadWatched();
  return loadTracked().filter((i) => i.type === type && !watched.has(String(i.tmdbId)));
}

export function add(item: Omit<TrackedItem, 'id' | 'addedAt'>): TrackedItem {
  const items = loadTracked();
  const exists = items.find((i) => i.tmdbId === item.tmdbId);
  if (exists) {
    exists.provider = item.provider;
    saveTracked(items);
    // Unmark as watched if re-adding
    markUnwatched(String(item.tmdbId));
    return exists;
  }

  const newItem: TrackedItem = {
    ...item,
    id: `tracked-${item.tmdbId}-${Date.now()}`,
    addedAt: new Date().toISOString(),
  };

  items.push(newItem);
  saveTracked(items);
  return newItem;
}

export function remove(tmdbId: number): boolean {
  const items = loadTracked();
  const filtered = items.filter((i) => i.tmdbId !== tmdbId);
  if (filtered.length === items.length) return false;
  saveTracked(filtered);
  // Also remove from watched
  markUnwatched(String(tmdbId));
  return true;
}

export function updateProvider(tmdbId: number, provider: StreamingProvider): TrackedItem | null {
  const items = loadTracked();
  const item = items.find((i) => i.tmdbId === tmdbId);
  if (!item) return null;
  item.provider = provider;
  saveTracked(items);
  return item;
}
