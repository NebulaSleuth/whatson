import { config } from '../../config.js';
import { obtainCertificate, certDaysRemaining } from './acme.js';
import { restartRemoteListener } from '../../server/remoteListener.js';

/**
 * Per-server certificate lifecycle (M8/8b-4). Ensures a valid cert exists and
 * the remote listener is serving it, and renews before expiry. Everything is
 * background + self-guarding, so enabling remote access returns immediately
 * while the ~30s ACME order runs, then the listener flips HTTP -> HTTPS.
 *
 * Dormant unless remote access + a cloud URL are configured. Obtains only when
 * there's no cert or it's within the renewal window, so restarts don't burn the
 * ACME rate limit.
 */

const RENEW_BELOW_DAYS = 30; // Let's Encrypt certs live 90d; renew with margin.
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // twice a day
let renewTimer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

/** True while a cert order is running (so the panel can show "obtaining…"). */
export function isObtainingCert(): boolean {
  return inFlight;
}

/**
 * Obtain the cert if missing/expiring, then restart the listener so the new
 * cert takes effect. Safe to call repeatedly; a no-op when a healthy cert
 * already exists.
 */
export async function ensureCertificateAndServe(): Promise<void> {
  if (!config.remote.enabled || !config.cloud.url) return;
  if (inFlight) return;
  const days = certDaysRemaining();
  if (days !== null && days > RENEW_BELOW_DAYS) return; // healthy — nothing to do

  inFlight = true;
  try {
    console.log(`[acme] ${days === null ? 'obtaining' : `renewing (${days}d left)`} certificate…`);
    await obtainCertificate({ email: process.env.ACME_EMAIL || undefined });
    restartRemoteListener(); // rebind with the new cert (HTTP -> HTTPS, or swap)
  } catch (err) {
    console.warn(`[acme] certificate acquisition failed: ${(err as Error).message}`);
  } finally {
    inFlight = false;
  }
}

/** Kick off acquisition now (background) + a periodic renewal check. Idempotent. */
export function startCertManager(): void {
  if (!config.remote.enabled || !config.cloud.url) return;
  void ensureCertificateAndServe();
  if (!renewTimer) {
    renewTimer = setInterval(() => void ensureCertificateAndServe(), CHECK_INTERVAL_MS);
  }
}

export function stopCertManager(): void {
  if (renewTimer) {
    clearInterval(renewTimer);
    renewTimer = null;
  }
}
