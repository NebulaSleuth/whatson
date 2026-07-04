import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './paths.js';

/**
 * Single-use grant enforcement (finding H3). A grant carries a unique `jti`;
 * once redeemed it's recorded here so a captured grant can't be replayed to
 * mint a second device key before it expires.
 */

let redeemed: Set<string> | null = null;

function file(): string {
  return join(dataDir(), 'redeemed-grants.json');
}

function load(): Set<string> {
  if (redeemed) return redeemed;
  try {
    const arr = JSON.parse(readFileSync(file(), 'utf-8'));
    redeemed = new Set(Array.isArray(arr) ? arr : []);
  } catch {
    redeemed = new Set();
  }
  return redeemed;
}

export function isRedeemed(jti: string): boolean {
  return load().has(jti);
}

export function markRedeemed(jti: string): void {
  const set = load();
  set.add(jti);
  try {
    writeFileSync(file(), JSON.stringify([...set]), 'utf-8');
  } catch {
    /* best-effort; in-memory set still prevents replay this run */
  }
}
