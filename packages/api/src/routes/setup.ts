import { Router } from 'express';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

export const setupRouter = Router();

// Cache the HTML content
let cachedHtml: string | null = null;

function getAdminHtml(): string {
  if (cachedHtml) return cachedHtml;

  // Try multiple locations
  const candidates = [
    join(__dirname, '..', '..', 'admin', 'index.html'),       // Dev: dist/../admin/
    join(__dirname, '..', 'admin', 'index.html'),              // Dev: src/../admin/
    join(dirname(process.execPath), 'admin', 'index.html'),    // Standalone: next to .exe
    join(process.cwd(), 'admin', 'index.html'),                // CWD fallback
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      cachedHtml = readFileSync(p, 'utf-8');
      return cachedHtml;
    }
  }

  // Fallback: minimal page
  cachedHtml = `<!DOCTYPE html>
<html><head><title>Whats On Setup</title></head>
<body style="background:#0a0a0a;color:#e0e0e0;font-family:sans-serif;text-align:center;padding-top:100px">
<h1 style="color:#e5a00d">Whats On</h1>
<p>Admin UI files not found. Place the admin/ folder next to the executable.</p>
</body></html>`;
  return cachedHtml;
}

setupRouter.get('/', (_req, res) => {
  res.type('html').send(getAdminHtml());
});
