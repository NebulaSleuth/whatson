# Whats On — Unified User Model: Implementation Plan

**Companion to** [`00-vision.md`](00-vision.md) (the decided model). This is the build
blueprint: data-model changes, new modules, phase ordering, migration, the M7
unwind checklist, and verification. **No code yet** — this is what we agree to
before touching the tree.

---

## 0. Shape of the work

Three moving parts, in dependency order:

1. **Data model + always-on users** (backend) — the foundation everything hangs on.
2. **Subsystem user *management*** (backend) — net-new: today the adapters only
   *read* content + `listUsers()`; nothing *creates/deletes/library-scopes* users.
3. **Rework M7** (cloud + backend + mobile) — invites become "invite a user,"
   cloud account becomes pure server-access, viewers/bindings/open-closed retired.

Load-bearing constraints from the vision:
- **Fully-shared picker** (§8): any authorized device can act as any Whats On user,
  gated by PIN. → makes **per-request PIN enforcement** a real security item (today
  it's `/select`-time only, then `X-Whatson-User` is client-trusted).
- **Cloud stays starved**: it stores only account↔server access + role. All
  profile / library / subsystem-credential data lives on the LAN backend.
- **Plex is map-only** (Home users, capped 15, Plex-Pass-gated); Jellyfin/Emby are
  full auto-provision.

---

## 1. Data model

### 1.1 Whats On user (`services/whatsonUsers.ts`)

```
WhatsOnUser {
  id, name, avatar
  role: 'admin' | 'member'                 // NEW
  pinHash: string | null                   // bcrypt (unchanged)
  mappings: {                              // NEW — replaces the flat plex/jelly/emby fields
    plex?:     { homeUserId: number, token: EncBlob }          // admin-mapped Home user
    jellyfin?: { userId: string, token: EncBlob, managed: bool } // managed=we created it
    emby?:     { userId: string, token: EncBlob, managed: bool }
  }
  libraries: {                             // NEW (Phase C) — per-subsystem allowed lib ids
    plex?: string[]      // section keys, or null = all mapped
    jellyfin?: string[]  // EnabledFolders ids
    emby?: string[]
  }
  createdAt
}
```
- `EncBlob` = AES-256-GCM ciphertext (§2.2). Replaces today's **plaintext**
  `plexUserToken`.
- The old top-level `enabled` flag and `guestMode` are **removed** (always-on).
- `managed: true` means Whats On created the subsystem user (so it may delete it);
  `false` means mapped-to-existing (never delete on our say-so).

### 1.2 Paired device (`services/pairing.ts`)

- **Remove** `guestBinding` and `boundWoProfileId`. A device is just "authorized on
  this server" + a `role` (owner/member → admin/member). No per-user binding.

### 1.3 Cloud (`packages/cloud/src/types.ts`)

- `Invite`: drop `binding`, `boundWoProfileId`, `newUserName`. Keep `email`,
  `serverId`, `role`, `expiresAt`. Add optional `provisioningRef` (opaque token the
  *backend* uses to look up what to provision — cloud never sees libraries).
- `GuestMembership` → **`ServerMembership`** `{ accountId, serverId, role }`. No
  binding, no `boundWoProfileId`.
- `GrantPayload`: drop `guestBinding` + `newUserName`. Keep `role` (owner=admin).
  The grant now says only "this device is authorized on server X as role Y."

### 1.4 Backend config / new files

- `data/library-defaults.json` — admin's default library set per subsystem (Phase C).
- `data/pending-invites.json` — backend-side provisioning specs keyed by the cloud
  invite's `provisioningRef` (libraries + subsystems + optional pre-created user).
- Encryption key: reuse the cloud-key pattern — a generated key file at
  `data/whatson-secret.key` (0600), overridable via `WHATSON_SECRET_KEY`.

---

## 2. New modules

### 2.1 Subsystem user management (`services/subsystemUsers.ts` + adapter extension)

Net-new. Add an optional capability to the adapter layer (or a parallel
`UserManager` per kind — Plex's API is plex.tv, not the PMS, so it won't fit the
content-adapter cleanly):

```
createUser(name)            -> subsystem userId          // JF/Emby: POST /Users/New
setPassword(userId, pw)                                  // POST /Users/{id}/Password
setLibraries(userId, libIds | all)                       // POST /Users/{id}/Policy EnabledFolders
authToken(userId, pw)       -> access token              // POST /Users/AuthenticateByName
deleteUser(userId)                                       // DELETE /Users/{id}
listUsers()                 -> [{id,name}]               // (exists)
listLibraries()             -> [{id,name}]               // GET /Library/MediaFolders
```
- **Jellyfin + Emby**: identical surface (verified live). Emby ≈ Jellyfin.
- **Plex**: only `listHomeUsers`, `mapHomeUser` (derive per-user token via existing
  `users.ts` switch), and — Plex-Pass + free-slot only — `createHomeUser` /
  `setHomeUserLibraries`. No password concept.

### 2.2 Secret store (`services/secrets.ts`)

- `encrypt(plaintext) -> EncBlob`, `decrypt(EncBlob) -> plaintext`, AES-256-GCM
  under the `data/whatson-secret.key` master key.
- One-time migration: encrypt existing plaintext `plexUserToken` on first load.

### 2.3 Per-user session tokens (`services/pairing.ts` or new) — the PIN fix

To make "isolation by PIN" real under fully-shared: `/whatson-users/:id/select`
validates the PIN and returns a **short-lived per-user session token**; subsequent
requests send it (alongside `X-Whatson-User`) and `userContext` verifies it.
Without it, `X-Whatson-User` stays client-assertable (fine on a trusted LAN, weak
remotely). Scope: PIN-protected users require the token; PIN-less users don't.
*(Flag: this is a security hardening we should not skip once remote is in play.)*

---

## 3. Phases

### Phase A — User model refactor (foundation)
- `whatsonUsers.ts`: add `role`, restructure to `mappings`/`libraries`, drop
  `enabled`/`guestMode`. Force always-on.
- `userContext.ts`: delete the binding-aware branches + the "inherit default"
  path. Resolve `X-Whatson-User` → user; enforce the per-user session token
  (§2.3) for PIN-protected users. Owners/admins unrestricted.
- `pairing.ts`: drop `guestBinding`/`boundWoProfileId`.
- **Migration** (§4).
- Admin UI: remove the enable toggle + guest-mode radios; add a `role` control.
- Ships behind: nothing — this is the new baseline.

### Phase B — Subsystem provisioning (net-new capability)
- `secrets.ts` (§2.2) + encrypt existing Plex tokens.
- `subsystemUsers.ts` (§2.1) for Jellyfin/Emby create/password/delete/token, Plex
  Home map/create.
- `whatsonUsers.ts`: create-user flow → provision subsystem users (or map
  existing), store encrypted tokens.
- Admin UI: "add user" → pick subsystems, create-new vs map-existing per subsystem.

### Phase C — Per-user libraries
- `library-defaults.json` + per-user `libraries`.
- Apply on create/update: JF/Emby `EnabledFolders`; Plex Home restrictions.
- Admin UI: library multiselect per user + a defaults editor.
- Aggregator already scopes to the mapped identity, so shelves follow automatically.

### Phase D — Invites as users (rework M7)
- **Cloud**: `POST /servers/:id/invites` keeps email/role/expiry + `provisioningRef`;
  drop binding params. `/invites/redeem` creates a `ServerMembership` (access), no
  binding. `device-code/approve` grants server access by membership/ownership (role
  derived), no binding. Retire `membership/profile` back-fill.
- **Backend**: `POST /remote/invite` writes a `pending-invites.json` spec (libraries
  + subsystems, or a pre-created user id for flow A) and calls the cloud with the
  `provisioningRef`. On the invitee's first backend contact, provision per the spec.
- **Two flows** (vision §6): admin-creates-then-invites (user exists, invite just
  grants access) / invitee-self-creates (provision at accept).
- **Mobile**: `cloud-signin` → after redeem, always land on the shared
  `select-whatson-user` picker. Repurpose `create-profile.tsx` as the generic
  "set up your user" screen used by the self-create flow (name+avatar+PIN), else
  remove.

### Phase E — Cleanup + migration finalize
- Delete dead M7 code (see §5).
- Remove the legacy `X-Plex-User` picker (`select-user.tsx`) once Plex flows via
  mappings.
- Verify migration on a copy of real `whatsonUsers.json` / `paired-devices.json`.

---

## 4. Migration

Run once on backend boot at the new version:
1. **WO-Users was OFF** → force on. If **no users exist**, auto-create an `admin`
   user from the Plex owner (map the owner Home user) + the Jellyfin/Emby admin if
   configured — preserves today's single-user behavior.
2. **Existing users**: restructure flat `plexUserId`/`jellyfinUserId`/`embyUserId`
   → `mappings`; first/owner user → `role: admin`, rest → `member`.
3. **Plaintext `plexUserToken`** → `secrets.encrypt(...)` in place.
4. **M7 paired guest devices**: drop `guestBinding`/`boundWoProfileId` (device
   becomes plain authorized-device; the person picks their user from the picker).
5. **Cloud**: migrate `GuestMembership` → `ServerMembership` (strip binding fields);
   existing invites with binding fields are ignored/expired.

Migration must be **idempotent** and **non-destructive** (back up the JSON files
before rewrite; the cloud-db has a proven backup path — see remote-access STATUS).

---

## 5. M7 unwind checklist (what gets deleted)

| Concept | Where | Action |
|---|---|---|
| `guestBinding` (locked/locked-new/open) | cloud+api types, GrantPayload, PairedDevice, userContext, auth redeem-grant, mobile cloudAuth/cloud-signin | remove |
| `guestMode` (open/closed) | whatsonUsers service + config route + admin UI | remove |
| "viewer" language + `newUserName` | cloud invites, mobile | remove |
| `GuestMembership.binding`, `boundWoProfileId` | cloud store/types | → `ServerMembership{role}` |
| `membership/profile` back-fill | cloud servers route + mobile reportGuestProfileToCloud | remove |
| "inherit default content" (unmapped user) | userContext Phase 4b | remove (§11 #1) |
| WO-Users enable toggle | whatsonUsers + admin UI | remove (always-on) |
| Legacy `X-Plex-User` picker | mobile select-user.tsx | remove (Phase E) |

Kept + repurposed: cloud device-code onboarding, `create-profile.tsx` (→ generic
user setup), the shared `select-whatson-user` picker, per-server TLS/cloud infra.

---

## 6. Risks & verification

- **Plex Home cap (15) + Plex-Pass gating** — detect and message; on a
  Plex-Pass-less server, Plex is owner-only and JF/Emby carry multi-user.
- **Credential blast radius** — a leaked `whatson-secret.key` decrypts subsystem
  tokens. Keep it 0600, LAN-only, never in the cloud. Net improvement over today's
  plaintext.
- **Managed-user deletion** — only ever delete `managed:true` subsystem users;
  never touch mapped-existing ones.
- **Migration on real data** — dry-run against copies of the owner's
  `whatsonUsers.json` + `paired-devices.json` + cloud-db before shipping.
- **Verification pattern** (as used all session): probe scripts against the real
  Jellyfin/Emby/Plex for create/library/delete; a backend harness for
  migration + userContext/PIN-token gating; the cloud integration test rewritten
  for `ServerMembership` (no binding).

---

## 7. Sequencing

A → B → C → D → E, each independently shippable behind the always-on model. A is
pure backend (safe to ship first). B/C add capability without breaking A. D is the
visible payoff (invite a real user, auto-provisioned). E removes the scaffolding.
Recommend shipping A+B together (foundation + provisioning) so there's something
demoable, then C, then D, then E.
