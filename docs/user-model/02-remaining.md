# Unified User Model — Remaining Work (detailed)

Companion to [`STATUS.md`](STATUS.md). The model is **shipped + live (v0.1.144)**;
nothing here is blocking. This is the actionable backlog with file-level specifics
so a fresh session can pick any item up cold.

---

## 1. Mobile PIN hardening (`X-Whatson-Session`) — HIGH VALUE

**State.** Backend is done: `POST /whatson-users/:id/select` returns a
`sessionToken` (AES-GCM, 30d, bound to the WO user id — `whatsonUsers.mintSessionToken`),
and `userContext` verifies `X-Whatson-Session` for **PIN-protected** users. It's
**soft** (logs, allows) until `WHATSON_STRICT_PIN=1`. The apps don't send the token
yet, so under the fully-shared picker a PIN-protected user is still effectively
client-assertable. **Keep `WHATSON_STRICT_PIN` OFF until the apps send the token.**

**Mobile TODO** (`apps/mobile`):
1. `app/select-whatson-user.tsx` — `api.selectWhatsOnUser(id, pin)` returns
   `data.sessionToken`. Capture it in the success path (both the no-PIN and PIN
   branches). (`app/select-user.tsx` legacy Plex picker has no token — it's being
   retired anyway.)
2. `lib/store.ts` + `lib/storage.ts` — add a `sessionToken` field to the current-user
   state + persist it (like `authKey`). Clear it on user switch / sign-out.
3. `lib/api.ts` — `fetchApi` already adds `X-Whatson-User` via `getUserHeader()`;
   add `X-Whatson-Session: <token>` from the store when present.
4. Rebuild + install APKs (phone + SHIELD), verify a PIN user still works.
5. Set `WHATSON_STRICT_PIN=1` in the backend `.env` (via `/setup` or env) to enforce.

**Roku** (`apps/roku`) — `ApiTask.brs` should send the header too once the racer/
session model there is updated; lower priority (parity item).

---

## 2. Phase C — per-user library management UI

**State.** `WhatsOnUser.libraries.{plex,jellyfin,emby}: string[]` exists and is
applied **on create-new** (via `subsystemUsers.provisionUser` → `EnabledFolders`).
`GET /whatson-users/libraries/:kind` lists a subsystem's libraries. The admin can
only set libraries when *creating* a new JF/Emby user.

**TODO:**
- **Edit existing user's libraries.** In `admin/index.html` `editWoUser`, show the
  library picker for a user's mapped JF/Emby subsystems (load current
  `Policy.EnabledFolders`), and on save call a backend path that applies
  `subsystemUsers.setLibraries` (which exists). Add to `PATCH /whatson-users/:id` or
  a dedicated route.
- **Default library set per subsystem** — a `data/library-defaults.json` (impl §1.4)
  + a defaults editor in the admin UI; prefill the picker for new users.
- **Policy decision:** for **mapped-existing** users (`managed:false`), applying WO's
  library set overwrites their server-side policy. Decide: only manage libraries for
  `managed:true` users, or warn before touching an existing user's policy. Don't
  clobber silently.

---

## 3. Self-create provisioning spec (Phase D flow B completion) — NEEDS DESIGN

**State.** `POST /whatson-users/guest-profile` creates a **bare** WO user (no
subsystem mapping → sees **no content**, since inherit-default was retired). The
cloud `Invite` carries an opaque `provisioningRef`; nothing consumes it yet.

**TODO / open design:**
- Backend `data/pending-invites.json` — a spec keyed by `provisioningRef`:
  `{ subsystems: ['jellyfin'|'emby'], libraries: {...} }`.
- `/remote/invite` (admin) — optionally attach a spec (which subsystems + libraries
  a self-created user gets); store the pending-invite; pass `provisioningRef` to the
  cloud (createInvite already forwards it).
- **The hard part:** the guest's device, on first connect, must know *which*
  `provisioningRef` to apply. The device-code grant does NOT carry it today (grants
  are binding-free by design). Options to design:
  (a) the invite-accept web page stashes the ref and the app fetches it, or
  (b) the cloud returns the ref in the device-code poll for that account's membership,
  (c) the backend matches the guest's cloud accountId → the membership → the invite.
  Pick one; (c) keeps the cloud starved. Until built, **flow B users are bare** — use
  flow A (admin creates the user in `/setup`, then invites) as the working path.

---

## 4. Browser / live E2E of the admin create-user flow

Load `http://192.168.1.181:3001/setup → Users` in a browser against the live backend
and actually create a Jellyfin/Emby user (verify the account appears on the server
with the right libraries, and delete removes it). **Needs:** JF/Emby configured in
the backend (`JELLYFIN_URL/USERNAME/PASSWORD`, `EMBY_*` — currently unset on the live
box) + the JF/Emby admin password (owner deleted `c:\temp\pw.txt`). The underlying
ops are proven live 8/8; this confirms the *UI wiring* end-to-end.

---

## 5. Smaller loose ends

- **Pixel phone** — only the SHIELD got the v0.1.144 mobile build. Rebuild
  (`WHATSON_TV=0`) + `adb install` to the Pixel (`47101FDAS007VA`) when wanted.
- **JF/Emby not configured on the live box** — subsystem provisioning is dormant
  until the owner adds `JELLYFIN_URL/USERNAME/PASSWORD` + `EMBY_*` in `/setup`.
- **Dead code:** `whatsonUsers.setEnabled` + the `enabled` file field are vestigial
  (isEnabled = users>0); safe to remove.
- **Cloud store back-compat:** old `GuestMembership`/`Invite` records carry retired
  binding fields (ignored by the new code, not migrated). Harmless; prune if desired.
- **Mailgun** still not keyed on the cloud (`MAILGUN_API_KEY`) — invites work
  link-first; set it to auto-email.
- **`secrets.ts` master key** at `<DATA_DIR>/whatson-secret.key` on the live box —
  back it up; losing it makes encrypted subsystem tokens undecryptable.

---

## Pre-existing remote-access deferrals (carry forward, unrelated to the user model)

From `../remote-access/STATUS.md`, still open: UPnP/NAT-PMP auto port-forward,
stable-IPv6 address, a `/setup` reachability panel, per-credential rate limiting on
`/auth/*` + PIN-verify + device-code, and the relay (paid, CGNAT + v4-only-client).
