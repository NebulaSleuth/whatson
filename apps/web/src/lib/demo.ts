import { useSyncExternalStore } from 'react';

/**
 * Public read-only demo mode. The demo server (DEMO_API_URL in
 * packages/shared) serves this web app same-origin and reports `demo: true`
 * on /api/auth/providers; it refuses every write with 403 `{ demo: true }`.
 * While set, write actions are hidden and a banner links back to the site.
 */
let demo = false;
const listeners = new Set<() => void>();

export function isDemo(): boolean {
  return demo;
}

export function setDemo(next: boolean): void {
  if (next === demo) return;
  demo = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useIsDemo(): boolean {
  return useSyncExternalStore(subscribe, isDemo, isDemo);
}

/** Thrown when the demo server refuses a write (403 `demo: true`). */
export class DemoReadOnlyError extends Error {
  readonly demo = true;
  constructor(message = 'Read-only demo') {
    super(message);
    this.name = 'DemoReadOnlyError';
  }
}

export function isDemoReadOnlyError(err: unknown): boolean {
  return err instanceof DemoReadOnlyError;
}
