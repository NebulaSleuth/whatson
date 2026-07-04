import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * Persistent data dir for cloud identity + state — same resolution as
 * `pairing.ts` so the server key, pinned cloud key, and redeemed-grant log land
 * next to `paired-devices.json` and survive upgrades.
 */
export function dataDir(): string {
  const candidates: string[] = [];
  if (process.env.WHATSON_DATA_DIR) candidates.push(process.env.WHATSON_DATA_DIR);
  if (process.platform === 'win32') candidates.push('C:\\ProgramData\\WhatsOn\\data');
  candidates.push(join(process.cwd(), 'data'));
  candidates.push(join(process.cwd(), 'packages', 'api', 'data'));
  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true });
      return dir;
    } catch {}
  }
  return '';
}
