#!/usr/bin/env bash
# One-time Jellyfin setup for the What's On TV demo. Run on the VM from this
# folder after `docker compose up -d`. Needs curl and jq.
#
#   1. Completes Jellyfin's first-run wizard with an admin account whose random
#      password is written to ./jellyfin-admin-password.txt (git-ignored).
#      Remote access is turned off; the admin UI is only reachable through
#      an SSH tunnel:  ssh -L 8096:127.0.0.1:8096 whatson@<vm>
#   2. Creates the restricted "demo" account the backend signs in as
#      (JELLYFIN_DEMO_PASSWORD from .env): not an administrator, can only play.
#   3. Adds the Movies, Shorts and Shows libraries from /media and scans them.
#   4. Marks a few items as part-watched so Continue Watching has something to
#      show. Demo mode drops progress reports, so they stay that way.
#   5. Writes the single "Demo" profile into ./data and restarts the backend.
#
# Safe to re-run: the wizard step is skipped once complete, and existing
# users/libraries are reused.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

JF="${JF:-http://127.0.0.1:8096}"
CLIENT='MediaBrowser Client="whatson-demo-setup", Device="setup", DeviceId="whatson-demo-setup", Version="1.0"'
: "${JELLYFIN_DEMO_PASSWORD:?set JELLYFIN_DEMO_PASSWORD in .env}"

echo "== Waiting for Jellyfin at $JF"
for _ in $(seq 1 60); do curl -fsS "$JF/System/Info/Public" >/dev/null 2>&1 && break; sleep 2; done
INFO="$(curl -fsS "$JF/System/Info/Public")"

ADMIN_USER=jfadmin
PWFILE=./jellyfin-admin-password.txt
if [ "$(jq -r '.StartupWizardCompleted' <<<"$INFO")" != "true" ]; then
  echo "== Completing the first-run wizard"
  [ -f "$PWFILE" ] || (umask 077; head -c 24 /dev/urandom | base64 | tr -d '/+=' > "$PWFILE")
  ADMIN_PW="$(cat "$PWFILE")"
  curl -fsS -X POST "$JF/Startup/Configuration" -H 'Content-Type: application/json' \
    -d '{"UICulture":"en-US","MetadataCountryCode":"US","PreferredMetadataLanguage":"en"}'
  curl -fsS "$JF/Startup/User" >/dev/null
  curl -fsS -X POST "$JF/Startup/User" -H 'Content-Type: application/json' \
    -d "$(jq -n --arg n "$ADMIN_USER" --arg p "$ADMIN_PW" '{Name:$n, Password:$p}')"
  curl -fsS -X POST "$JF/Startup/RemoteAccess" -H 'Content-Type: application/json' \
    -d '{"EnableRemoteAccess":false,"EnableAutomaticPortMapping":false}'
  curl -fsS -X POST "$JF/Startup/Complete"
fi
[ -f "$PWFILE" ] || { echo "Wizard already done but $PWFILE is missing." >&2; exit 1; }
ADMIN_PW="$(cat "$PWFILE")"

login() { # user password -> access token
  curl -fsS -X POST "$JF/Users/AuthenticateByName" -H 'Content-Type: application/json' \
    -H "Authorization: $CLIENT" \
    -d "$(jq -n --arg u "$1" --arg p "$2" '{Username:$u, Pw:$p}')" | jq -r '.AccessToken'
}
TOKEN="$(login "$ADMIN_USER" "$ADMIN_PW")"
AUTH="$CLIENT, Token=\"$TOKEN\""
jf() { # method path [json]
  if [ $# -ge 3 ]; then
    curl -fsS -X "$1" "$JF$2" -H "Authorization: $AUTH" -H 'Content-Type: application/json' -d "$3"
  else
    curl -fsS -X "$1" "$JF$2" -H "Authorization: $AUTH"
  fi
}

echo "== Demo account"
DEMO_ID="$(jf GET /Users | jq -r '.[] | select(.Name=="demo") | .Id')"
if [ -z "$DEMO_ID" ]; then
  DEMO_ID="$(jf POST /Users/New "$(jq -n --arg p "$JELLYFIN_DEMO_PASSWORD" '{Name:"demo", Password:$p}')" | jq -r '.Id')"
fi
jf POST "/Users/$DEMO_ID/Policy" "$(jq -n '{
  IsAdministrator: false, IsHidden: true, IsDisabled: false,
  EnableAllFolders: true, EnableAllChannels: false, EnableAllDevices: true,
  EnableMediaPlayback: true, EnableAudioPlaybackTranscoding: true,
  EnableVideoPlaybackTranscoding: true, EnablePlaybackRemuxing: true,
  ForceRemoteSourceTranscoding: false,
  EnableContentDeletion: false, EnableContentDeletionFromFolders: [],
  EnableContentDownloading: false, EnableSyncTranscoding: false,
  EnableMediaConversion: false, EnablePublicSharing: false,
  EnableRemoteControlOfOtherUsers: false, EnableSharedDeviceControl: false,
  EnableRemoteAccess: true, EnableLiveTvManagement: false, EnableLiveTvAccess: false,
  EnableCollectionManagement: false, EnableSubtitleManagement: false,
  EnableLyricManagement: false, EnableUserPreferenceAccess: false,
  InvalidLoginAttemptCount: 0, LoginAttemptsBeforeLockout: -1,
  MaxActiveSessions: 0, RemoteClientBitrateLimit: 0, SyncPlayAccess: "None",
  BlockedTags: [], AllowedTags: [], BlockUnratedItems: [],
  AccessSchedules: [], EnabledChannels: [], EnabledDevices: [], EnabledFolders: [],
  AuthenticationProviderId: "Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider",
  PasswordResetProviderId: "Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider"
}')"
echo "   demo user id: $DEMO_ID"

echo "== Libraries"
EXISTING="$(jf GET /Library/VirtualFolders | jq -r '.[].Name')"
add_lib() { # name collectionType folder
  if grep -qx "$1" <<<"$EXISTING"; then echo "   $1 exists"; return; fi
  [ -d "${MEDIA_DIR:-/srv/media}/$3" ] || { echo "   skipping $1: ${MEDIA_DIR:-/srv/media}/$3 not found"; return; }
  jf POST "/Library/VirtualFolders?name=$1&collectionType=$2&refreshLibrary=false&paths=/media/$3" \
    '{"LibraryOptions":{"EnableRealtimeMonitor":false,"SaveLocalMetadata":false,"EnableChapterImageExtraction":false}}'
  echo "   added $1"
}
add_lib Movies movies Movies
add_lib Shorts movies Shorts
add_lib Shows tvshows Shows
jf POST /Library/Refresh
echo "   scanning; waiting for items to appear"
for _ in $(seq 1 90); do
  COUNT="$(jf GET "/Items?Recursive=true&IncludeItemTypes=Movie,Episode&Limit=0" | jq -r '.TotalRecordCount')"
  [ "$COUNT" -gt 0 ] && break
  sleep 5
done
sleep 20
echo "   $COUNT playable items"

# Jellyfin matches titles against TMDB by name, which can attach the wrong
# film's poster and summary (it matched Blender's "Spring" (2019) to "Spring
# Breakers"). Titles TMDB can't tell apart are pinned here, keyed by file or
# folder name; every other item is checked and any mismatch is reported.
declare -A PINNED_TMDB=(
  ["Spring (2019)"]=593048
)
echo "== Metadata matches"
norm() { tr '[:upper:]' '[:lower:]' <<<"$1" | tr -cd '[:alnum:]'; }
MISMATCH=0
while read -r it; do
  [ -n "$it" ] || continue
  id="$(jq -r .id <<<"$it")"; type="$(jq -r .type <<<"$it")"; name="$(jq -r .name <<<"$it")"
  stem="$(jq -r .path <<<"$it" | sed 's#/*$##; s#.*/##; s#\.[A-Za-z0-9]*$##')"
  want="${stem% (*}"; year="$(sed -n 's/.*(\([0-9]\{4\}\))$/\1/p' <<<"$stem")"
  pin="${PINNED_TMDB[$stem]:-}"
  if [ -n "$pin" ] && [ "$(jq -r '.tmdb // ""' <<<"$it")" != "$pin" ]; then
    jf POST "/Items/RemoteSearch/Apply/$id?replaceAllImages=true" \
      "$(jq -n --arg n "$want" --arg t "$pin" --argjson y "${year:-0}" \
        '{Name:$n, ProductionYear:$y, ProviderIds:{Tmdb:$t}, SearchProviderName:"TheMovieDb"}')" >/dev/null
    echo "   $stem: pinned to TMDB $pin (was \"$name\")"
  elif [ "$(norm "$name")" != "$(norm "$want")" ]; then
    echo "   WARNING: $type \"$stem\" matched \"$name\". Pin its TMDB id in PINNED_TMDB."
    MISMATCH=1
  fi
done < <(jf GET "/Items?Recursive=true&IncludeItemTypes=Movie,Series&Fields=Path,ProviderIds" \
  | jq -c '.Items[] | {id: .Id, type: .Type, name: .Name, path: .Path, tmdb: .ProviderIds.Tmdb}')
[ "$MISMATCH" = 0 ] && echo "   all titles match their files"

echo "== Continue Watching seed"
RESUMABLE="$(jf GET "/UserItems/Resume?userId=$DEMO_ID&Limit=1" | jq -r '.TotalRecordCount // 0')"
if [ "$RESUMABLE" -gt 0 ]; then
  echo "   already seeded"
else
  SEED="$(jf GET "/Items?Recursive=true&IncludeItemTypes=Movie,Episode&SortBy=Random&Limit=3&Fields=RunTimeTicks" \
    | jq -c '.Items[] | {id: .Id, ticks: (.RunTimeTicks // 0)}')"
  while read -r item; do
    [ -n "$item" ] || continue
    id="$(jq -r .id <<<"$item")"; ticks="$(jq -r .ticks <<<"$item")"
    pos=$(( ticks * 35 / 100 ))
    jf POST "/UserItems/$id/UserData?userId=$DEMO_ID" \
      "$(jq -n --argjson p "$pos" '{PlaybackPositionTicks: $p, Played: false}')" >/dev/null && echo "   $id at 35%"
  done <<<"$SEED"
fi

echo "== Demo profile"
mkdir -p data
jq -n --arg jf "$DEMO_ID" '{
  users: [{
    id: "demo",
    name: "Demo",
    avatar: "fox",
    role: "member",
    pinHash: null,
    mappings: { jellyfin: { userId: $jf, token: null, managed: false } }
  }]
}' > data/whatsonUsers.json
docker compose restart whatson-api

echo "Done. Jellyfin admin: $ADMIN_USER / password in $PWFILE (UI via SSH tunnel only)."
