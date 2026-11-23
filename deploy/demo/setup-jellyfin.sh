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
#   5. Writes the single "Demo" profile into ./data, installs the followed
#      sports teams from seed/sports.json (visitors can't change them), and
#      restarts the backend.
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
echo "   scanning; waiting for the item count to settle"
# The scan adds items over a minute or more, so wait until the count is
# non-zero and unchanged for four checks in a row (20 s).
COUNT=0; STABLE=0
for _ in $(seq 1 120); do
  sleep 5
  NOW="$(jf GET "/Items?Recursive=true&IncludeItemTypes=Movie,Episode&Limit=0" | jq -r '.TotalRecordCount')"
  if [ "$NOW" -gt 0 ] && [ "$NOW" = "$COUNT" ]; then STABLE=$((STABLE + 1)); else STABLE=0; fi
  COUNT="$NOW"
  [ "$STABLE" -ge 4 ] && break
done
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
# Items no metadata provider knows (e.g. The Big Picture, a US Army series)
# keep raw folder names, and their episodes all get the series name. For
# those, write NFO files (Jellyfin's local metadata, read before any online
# provider) next to the media, naming them from the files, then refresh.
MEDIA_HOST="${MEDIA_DIR:-/srv/media}"
xml() { sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g' <<<"$1"; }
poster_from_video() { # video out.jpg: a 2:3 frame two minutes in, as a stand-in poster
  [ -f "$2" ] || [ -z "$1" ] && return 0
  ffmpeg -nostdin -loglevel error -ss 120 -i "$1" -frames:v 1 \
    -vf 'crop=min(iw\,ih*2/3):ih,scale=600:-2' -q:v 3 "$2" || echo "   (no poster frame for $1)"
}
write_nfos() { # id type /media/path title year
  local host="$MEDIA_HOST${3#/media}"
  if [ "$2" = Series ]; then
    printf '<?xml version="1.0" encoding="utf-8"?>\n<tvshow><title>%s</title><year>%s</year></tvshow>\n' \
      "$(xml "$4")" "$5" > "$host/tvshow.nfo"
    local f base ep_title s e
    while IFS= read -r f; do
      base="$(basename "$f" .mp4)"; ep_title="${base#* - }"
      s="$(sed -n 's/.* S\([0-9]\{2,\}\)E[0-9]\{2,\} - .*/\1/p' <<<"$base")"
      e="$(sed -n 's/.* S[0-9]\{2,\}E\([0-9]\{2,\}\) - .*/\1/p' <<<"$base")"
      printf '<?xml version="1.0" encoding="utf-8"?>\n<episodedetails><title>%s</title><showtitle>%s</showtitle><season>%d</season><episode>%d</episode><year>%s</year></episodedetails>\n' \
        "$(xml "$ep_title")" "$(xml "$4")" "$((10#$s))" "$((10#$e))" "$5" > "${f%.mp4}.nfo"
    done < <(find "$host" -name '*.mp4')
    poster_from_video "$(find "$host" -name '*.mp4' | sort | head -1)" "$host/folder.jpg"
  else
    printf '<?xml version="1.0" encoding="utf-8"?>\n<movie><title>%s</title><year>%s</year></movie>\n' \
      "$(xml "$4")" "$5" > "${host%.*}.nfo"
    poster_from_video "$host" "$(dirname "$host")/folder.jpg"
  fi
  jf POST "/Items/$1/Refresh?Recursive=true&MetadataRefreshMode=FullRefresh&ImageRefreshMode=Default&ReplaceAllMetadata=true&ReplaceAllImages=false" >/dev/null
}
MISMATCH=0
while read -r it; do
  [ -n "$it" ] || continue
  id="$(jq -r .id <<<"$it")"; type="$(jq -r .type <<<"$it")"; name="$(jq -r .name <<<"$it")"
  stem="$(jq -r .path <<<"$it" | sed 's#/*$##; s#.*/##; s#\.[A-Za-z0-9]*$##')"
  if [ "$type" = Episode ]; then want="${stem#* - }"; else want="${stem% (*}"; fi
  year="$(sed -n 's/.*(\([0-9]\{4\}\))$/\1/p' <<<"$stem")"
  pin="${PINNED_TMDB[$stem]:-}"
  if [ -n "$pin" ] && [ "$(jq -r '.tmdb // ""' <<<"$it")" != "$pin" ]; then
    jf POST "/Items/RemoteSearch/Apply/$id?replaceAllImages=true" \
      "$(jq -n --arg n "$want" --arg t "$pin" --argjson y "${year:-0}" \
        '{Name:$n, ProductionYear:$y, ProviderIds:{Tmdb:$t}, SearchProviderName:"TheMovieDb"}')" >/dev/null
    echo "   $stem: pinned to TMDB $pin (was \"$name\")"
  elif [ "$type" = Episode ]; then
    : # named by the online match, or by its series' NFO files
  elif [ "$(jq -r .matched <<<"$it")" != "true" ]; then
    nfo="$MEDIA_HOST$(jq -r .path <<<"$it" | sed 's#^/media##')"
    if [ "$type" = Series ]; then nfo="$nfo/tvshow.nfo"; else nfo="${nfo%.*}.nfo"; fi
    if [ -f "$nfo" ]; then
      echo "   $type \"$stem\": no online match; using its NFO metadata"
    else
      write_nfos "$id" "$type" "$(jq -r .path <<<"$it")" "$want" "$year"
      echo "   $type \"$stem\": no online match; wrote NFO metadata from the file names"
    fi
  elif [ "$(norm "$name")" != "$(norm "$want")" ]; then
    echo "   WARNING: $type \"$stem\" matched \"$name\". Pin its TMDB id in PINNED_TMDB."
    MISMATCH=1
  fi
done < <(jf GET "/Items?Recursive=true&IncludeItemTypes=Movie,Series,Episode&Fields=Path,ProviderIds" \
  | jq -c '.Items[] | {id: .Id, type: .Type, name: .Name, path: .Path, tmdb: .ProviderIds.Tmdb,
      matched: ((.ProviderIds // {}) | length > 0)}')
[ "$MISMATCH" = 0 ] && echo "   no wrong matches"

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

echo "== Sports"
# A sample of followed teams so the Sports tab has scores and schedules.
# Team ids are the backend's (GET /api/sports/teams?league=<key>).
cp seed/sports.json data/sports.json
jq -r '.leagues[] | "   \(.key): \(if .mode == "all" then "all events" else "\(.teamIds | length) teams" end)"' data/sports.json

echo "== Credits page"
if [ -f "${MEDIA_DIR:-/srv/media}/credits.html" ]; then
  cp "${MEDIA_DIR:-/srv/media}/credits.html" site/credits.html && echo "   site/credits.html updated"
else
  echo "   ${MEDIA_DIR:-/srv/media}/credits.html not found; run content/fetch.sh first"
fi

docker compose restart whatson-api

echo "Done. Jellyfin admin: $ADMIN_USER / password in $PWFILE (UI via SSH tunnel only)."
