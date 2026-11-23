# Public read-only demo — demo.whatsontv.net

A What's On TV server anyone can try, with free-to-use media: Blender open
movies (CC-BY), public-domain films and public-domain TV episodes. The apps'
**Try the demo** button and whatsontv.net's **Try the live preview** link
point here, and it is what app-store reviewers use.

## How it is locked down

| Layer | What it does |
|---|---|
| `WHATSON_DEMO=1` (`packages/api/src/middleware/demoGuard.ts`) | Every write is refused (403 `{demo:true}`) except choosing a profile. Admin routes, `/setup` and all of `/auth` except the two boot-time status reads are closed for every method. Playback progress is acknowledged and dropped. Background updater, download monitor, remote listener and cloud registration never start. |
| Stream proxy (`services/streamProxy.ts`) | All playback goes through `/api/stream/proxy`, which only fetches Jellyfin `/Videos/` and `/Audio/` paths. |
| Rate limits (`security/rateLimit.ts`) | Per-IP token buckets; 429 when exceeded. |
| Jellyfin `demo` account | Not an administrator; can play, nothing else. Its data never changes, because demo mode never forwards writes. |
| Network | Only Caddy (80/443) is public. Jellyfin listens on the VM's loopback only; SSH is limited to one admin IP by the NSG. Media is mounted read-only. |

Tests: `npm test -w packages/api`.

## Files

| File | Purpose |
|---|---|
| `provision.sh` | Azure resource group, B2s Ubuntu VM (128 GB disk, static IP), NSG, `demo` DNS record, optional budget alert. **Creates billable resources.** |
| `cloud-init.yaml` | First boot: Docker, ffmpeg, jq, unattended upgrades, clones the repo to `/srv/whatson`. |
| `docker-compose.yml`, `Caddyfile` | Caddy (TLS) → backend in demo mode → Jellyfin. |
| `.env.example` | Settings and secrets; copy to `.env` on the VM. |
| `setup-jellyfin.sh` | One-time Jellyfin setup: admin account, restricted `demo` account, libraries, Continue Watching seed, the "Demo" profile. |
| `content/` | Media manifest, `fetch.sh` (download, verify, transcode, credits page). |

## Bringing it up

1. **Provision** (from a machine with `az login` done):
   ```bash
   BUDGET_AMOUNT=60 BUDGET_EMAIL=you@example.com ./deploy/demo/provision.sh
   ```
   If the DNS zone isn't in Azure, add the A record it prints at your DNS host.
2. **Configure** on the VM:
   ```bash
   ssh whatson@<ip>
   cd /srv/whatson/deploy/demo
   cp .env.example .env && nano .env      # ACME_EMAIL, JELLYFIN_DEMO_PASSWORD
   ```
3. **Fetch media** (takes a while; re-runnable):
   ```bash
   MEDIA_DIR=/srv/media bash content/fetch.sh
   cp /srv/media/credits.html site/credits.html
   ```
4. **Start** and set up Jellyfin:
   ```bash
   docker compose up -d --build
   ./setup-jellyfin.sh
   ```
5. **Check**: https://demo.whatsontv.net loads the web app with the demo banner,
   a video plays, and these are refused:
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://demo.whatsontv.net/setup                 # 403
   curl -s -o /dev/null -w '%{http_code}\n' https://demo.whatsontv.net/api/config            # 403
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://demo.whatsontv.net/api/scrobble  # 403
   curl -s -m 5 http://<ip>:8096/ || echo "jellyfin not reachable (good)"
   ```

## Updating

```bash
cd /srv/whatson && git pull && cd deploy/demo && docker compose up -d --build
```

Jellyfin's admin UI is only reachable through a tunnel:
`ssh -L 8096:127.0.0.1:8096 whatson@<ip>`, then http://localhost:8096 with
`jfadmin` and the password in `jellyfin-admin-password.txt`.

## Tearing it down

```bash
az group delete -n whatson-demo
```
