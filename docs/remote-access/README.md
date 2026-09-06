# Remote Access - Design & Implementation Docs

> **PARTIALLY SUPERSEDED (2026-07):** the M7 guest/invite/viewer-**binding** model
> described in these docs (an invite maps a guest onto one WO profile) was retired by the
> **unified user model** — see [`../user-model/STATUS.md`](../user-model/STATUS.md).
> Invites now just grant server access; identity is the shared "Who's Watching?" picker.
> The remote-access **infrastructure** here (cloud control plane, per-server TLS,
> device-code flow, connection racer) shipped and carries forward unchanged — see
> [`STATUS.md`](STATUS.md) in this folder for what's live.

This folder specifies a cloud-assisted remote-access feature for the Whats On
backend, plus the backend security hardening that must ship alongside it. The
goal: let a user reach their own Whats On backend from outside the home the way
Plex does - without forcing them to stand up Tailscale, a reverse proxy, or a
Cloudflare Tunnel - while never leaking private data or service credentials.

These documents are written to be handed to another model (or engineer) for
implementation. They reference real files and line numbers in the repo as of
the commit where this folder was added. Verify those anchors still exist before
editing; the surrounding code moves.

## The documents

| File | Scope | When |
|------|-------|------|
| [`01-security-hardening.md`](01-security-hardening.md) | Backend changes that make it safe to expose a port to the internet. Mostly independent of the cloud service - several are real holes **today**. | v1, do first |
| [`02-v1-design.md`](02-v1-design.md) | The cloud discovery/rendezvous service, the backend "remote listener," device linking + invites, and client-side connection racing. **No video ever transits the cloud.** | v1 |
| [`03-v2-relay.md`](03-v2-relay.md) | What we know today about the optional, paid, bandwidth-capped relay for users who can't get a direct connection (CGNAT). Not built in v1. | v2 |

## The one-paragraph summary

v1 solves remote access with **direct connections only**. The backend registers
with a small cloud service and heartbeats its reachable addresses (LAN, WAN,
IPv6). Apps ask the cloud "where is my server right now?", get a list of
candidate URLs, and race them - preferring LAN, falling back to WAN/IPv6 - with
the list cached on-device so the LAN keeps working when the internet is down.
Direct reachability comes from the user forwarding one port (or the backend
punching it via UPnP/NAT-PMP) plus IPv6, which quietly rescues most CGNAT
households. The cloud only ever handles tiny control-plane data (accounts,
invites, current addresses); it never sees or relays a byte of video. The relay
that would rescue the remaining CGNAT-without-IPv6 users is deferred to v2 as a
paid, bitrate-capped add-on.

None of this is safe without the hardening in doc 01, because the backend's
current security model is "the LAN is trusted." Exposing today's server to the
internet would leak service tokens (`GET /api/config`), allow profile
impersonation (`X-Whatson-User` is client-asserted), and expose an SSRF in the
artwork proxy. Doc 01 closes those; doc 02 builds on top.

## Identity layers (don't conflate these)

The system has three separate notions of "user." Keeping them distinct is
essential to the design.

1. **Cloud account** - one per backend *owner*. Lives in the cloud service.
   Owns the server registration and sends invites. Guests who redeem an invite
   get a lightweight cloud identity (or just a redeemed-invite record) scoped to
   that one server. This layer is **new** (doc 02).

2. **Paired device** - a specific app install (a Roku, a phone) that has proven
   it's allowed to talk to a backend. Already exists: `services/pairing.ts`
   issues a 256-bit auth key per device, presented via `X-Whatson-Auth`. v1
   extends this so a device is provisioned remotely via an invite/device-code
   instead of only via the LAN `/setup` flow.

3. **Whats On User** - a household *profile* on the backend ("who's watching",
   PIN, avatar, and the mapping to per-service Plex/Jellyfin/Emby users). Already
   exists: `services/whatsonUsers.ts`, selected via `X-Whatson-User`. The cloud
   never needs to know these exist. An invite maps a guest onto one WO profile.

A guest flow, end to end: owner sends an invite -> guest's app redeems it against
the cloud -> cloud hands back the server's address + a signed grant -> the app
pairs with the backend and receives an auth key bound to one WO profile -> guest
browses as that profile, their watched state isolated like everyone else's.

## Hard requirements (carried from design discussion)

- **Roku parity.** The Roku channel must work through all of this. Roku speaks
  HTTPS only - no WebRTC, no VPN client, and its media/image loaders can't set
  custom headers (hence the existing `?auth=` query fallback). Every mechanism
  here must be expressible as plain authenticated HTTPS. This killed an earlier
  WebRTC-data-channel idea outright.
- **Works offline on the LAN.** If the internet is down but the phone/TV is on
  the home network, everything must keep working. This is a Plex weakness we are
  explicitly fixing via on-device candidate caching. The LAN listener must never
  depend on the cloud.
- **The cloud is starved by design.** It stores the minimum (owner email, server
  public key/id, current addresses, invite tokens) and never sees media
  metadata, service tokens, PINs, or - in v1 - any stream. Treat the cloud as
  untrusted infrastructure that only helps two authenticated parties find each
  other.
- **CRLF line endings** on all files in this repo (Windows convention).
