import { config, mailEnabled } from './config.js';

/**
 * Mailgun transactional email (M7 invites). Uses Mailgun's HTTP API via the
 * built-in `fetch` (no SDK dependency) so the cloud bundle stays lean.
 *
 * Dormant by design: when Mailgun isn't configured (`mailEnabled()` false),
 * `sendInviteEmail` returns `{ sent: false }` and the caller falls back to
 * showing the invite link in /setup for the owner to share manually. Sending
 * is best-effort — a Mailgun failure never fails the invite creation.
 */

export interface SendResult {
  sent: boolean;
  error?: string;
}

function from(): string {
  return config.mailgun.from || `Whats On <no-reply@${config.mailgun.domain}>`;
}

export async function sendInviteEmail(opts: {
  to: string;
  serverLabel: string;
  inviteUrl: string;
}): Promise<SendResult> {
  if (!mailEnabled()) return { sent: false, error: 'mailgun not configured' };

  const subject = `You're invited to ${opts.serverLabel} on Whats On`;
  const text =
    `You've been invited to watch on "${opts.serverLabel}" via Whats On.\n\n` +
    `Accept your invite and set up your account:\n${opts.inviteUrl}\n\n` +
    `This link expires soon. If you weren't expecting this, you can ignore it.`;
  const html =
    `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111">` +
    `<h2 style="color:#E5A00D">You're invited to Whats On</h2>` +
    `<p>You've been invited to watch on <strong>${escapeHtml(opts.serverLabel)}</strong>.</p>` +
    `<p><a href="${escapeAttr(opts.inviteUrl)}" style="display:inline-block;background:#E5A00D;color:#111;` +
    `text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Accept invite</a></p>` +
    `<p style="color:#666;font-size:13px">Or paste this link into your browser:<br>` +
    `<a href="${escapeAttr(opts.inviteUrl)}">${escapeHtml(opts.inviteUrl)}</a></p>` +
    `<p style="color:#999;font-size:12px">This link expires soon. If you weren't expecting this, ignore it.</p>` +
    `</div>`;

  const body = new URLSearchParams({ from: from(), to: opts.to, subject, text, html });
  const auth = Buffer.from(`api:${config.mailgun.apiKey}`).toString('base64');

  try {
    const res = await fetch(`${config.mailgun.apiBase}/v3/${config.mailgun.domain}/messages`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { sent: false, error: `mailgun ${res.status}: ${detail.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, error: String(err) };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
