#!/usr/bin/env bash
# Download, verify and transcode the demo media listed in manifest.json, lay it
# out with Jellyfin naming, and generate the credits page.
#
#   MEDIA_DIR=/srv/media bash content/fetch.sh            # everything
#   MEDIA_DIR=/srv/media bash content/fetch.sh sintel doa # only these ids
#   CREDITS_ONLY=1 MEDIA_DIR=/srv/media bash content/fetch.sh
#   DRY_RUN=1 bash content/fetch.sh                       # show the plan, touch nothing
#
# Output:
#   $MEDIA_DIR/Movies/<Title> (<Year>)/<Title> (<Year>).mp4
#   $MEDIA_DIR/Shorts/<Title> (<Year>)/<Title> (<Year>).mp4
#   $MEDIA_DIR/Shows/<Series> (<Year>)/Season NN/<Series> (<Year>) SNNEMM - <Title>.mp4
#   $MEDIA_DIR/credits.html   (copy to deploy/demo/site/credits.html for Caddy)
#
# Idempotent: downloads resume, finished outputs are skipped, and each output
# records the sha256 of the source it was made from. The first successful
# download of an item writes its sha256 into manifest.json; later runs verify
# against it and refuse a file that doesn't match.
#
# Environment:
#   MEDIA_DIR        media root mounted into Jellyfin (default /srv/media)
#   CACHE_DIR        downloaded sources (default $MEDIA_DIR/.downloads; it's
#                    outside the Movies/Shorts/Shows library folders)
#   MANIFEST         manifest path (default: manifest.json next to this script)
#   CREDITS_OUT      credits page path (default $MEDIA_DIR/credits.html)
#   PRUNE_DOWNLOADS  1 = delete each source once its output is written
#   X264_PRESET      libx264 preset (default slow)
#   X264_CRF         libx264 CRF (default 20)
#   DRY_RUN          1 = print what would happen and exit
#   CREDITS_ONLY     1 = only regenerate credits.html
#
# Needs: bash 4+, curl, jq, ffmpeg/ffprobe (with libx264), sha256sum, unzip, flock.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="${MANIFEST:-$SCRIPT_DIR/manifest.json}"
MEDIA_DIR="${MEDIA_DIR:-/srv/media}"
CACHE_DIR="${CACHE_DIR:-$MEDIA_DIR/.downloads}"
CREDITS_OUT="${CREDITS_OUT:-$MEDIA_DIR/credits.html}"
PRUNE_DOWNLOADS="${PRUNE_DOWNLOADS:-0}"
X264_PRESET="${X264_PRESET:-slow}"
X264_CRF="${X264_CRF:-20}"
DRY_RUN="${DRY_RUN:-0}"
CREDITS_ONLY="${CREDITS_ONLY:-0}"
MAX_W=1920
MAX_H=1080

# All logging goes to stderr so functions can return values on stdout.
log()  { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
warn() { printf '%s WARN %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die()  { printf 'ERROR %s\n' "$*" >&2; exit 1; }

need_tools() {
  local missing=() t
  for t in "$@"; do command -v "$t" >/dev/null 2>&1 || missing+=("$t"); done
  [ ${#missing[@]} -eq 0 ] || die "missing tools: ${missing[*]} (apt-get install -y curl jq ffmpeg unzip util-linux)"
}

# Make a string safe as a file or folder name (Jellyfin reads the year in
# "(YYYY)", so keep parentheses; drop what Linux/SMB clients choke on).
safe_name() {
  local s="$1"
  s="${s//\//-}"; s="${s//\\/-}"; s="${s//:/ -}"
  s="${s//\?/}"; s="${s//\*/}"; s="${s//\"/}"; s="${s//</}"; s="${s//>/}"; s="${s//|/-}"
  s="$(printf '%s' "$s" | tr -s ' ')"
  s="${s#"${s%%[![:space:]]*}"}"; s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

# Item field accessor: jfield <json> <jq-expr>
jfield() { jq -r "$2 // empty" <<<"$1"; }

# Relative output path (under MEDIA_DIR) for an item.
output_rel() {
  local item="$1" kind title year series syear season episode folder
  kind="$(jfield "$item" .kind)"
  title="$(safe_name "$(jfield "$item" .title)")"
  year="$(jfield "$item" .year)"
  case "$kind" in
    movie|short)
      local lib=Movies; [ "$kind" = short ] && lib=Shorts
      folder="$title${year:+ ($year)}"
      printf '%s/%s/%s.mp4' "$lib" "$folder" "$folder"
      ;;
    episode)
      series="$(safe_name "$(jfield "$item" .series)")"
      syear="$(jfield "$item" .series_year)"
      season="$(jfield "$item" .season)"; episode="$(jfield "$item" .episode)"
      [ -n "$series" ] && [ -n "$season" ] && [ -n "$episode" ] || return 1
      folder="$series${syear:+ ($syear)}"
      printf 'Shows/%s/Season %02d/%s S%02dE%02d - %s.mp4' \
        "$folder" "$season" "$folder" "$season" "$episode" "$title"
      ;;
    *) return 1 ;;
  esac
}

# Write sha256 for one id back into the manifest (atomic replace).
record_sha() {
  local id="$1" sha="$2" tmp
  tmp="$(mktemp "${MANIFEST}.XXXXXX")"
  jq --indent 2 --arg id "$id" --arg sha "$sha" \
    '(.items[] | select(.id == $id) | .sha256) = $sha' "$MANIFEST" >"$tmp"
  chmod --reference="$MANIFEST" "$tmp" 2>/dev/null || true
  mv -f "$tmp" "$MANIFEST"
}

# Download $url to $dest (resumable). Returns non-zero on failure.
download() {
  local url="$1" dest="$2" part="$2.part"
  mkdir -p "$(dirname "$dest")"
  log "  downloading $url"
  # -C - resumes a partial .part file; --retry covers flaky mirrors.
  curl -fL --retry 5 --retry-delay 10 --retry-all-errors --connect-timeout 30 \
       -C - -o "$part" -A "whatson-demo-fetch/1.0" "$url" || return 1
  mv -f "$part" "$dest"
}

# If the source is a zip, extract the largest video in it; echo the path to use.
unpack_if_needed() {
  local item="$1" src="$2" id archive dir inner
  id="$(jfield "$item" .id)"; archive="$(jfield "$item" .archive)"
  if [ "$archive" != zip ]; then printf '%s' "$src"; return 0; fi
  dir="$CACHE_DIR/$id.unzipped"
  inner="$(find "$dir" -type f \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.mkv' -o -iname '*.avi' -o -iname '*.webm' \) \
           -printf '%s\t%p\n' 2>/dev/null | sort -rn | head -n1 | cut -f2- || true)"
  if [ -z "$inner" ] || [ "$src" -nt "$dir/.done" ]; then
    rm -rf "$dir"; mkdir -p "$dir"
    log "  unzipping $(basename "$src")"
    unzip -q -o "$src" -d "$dir" >&2 || return 1
    touch "$dir/.done"
    inner="$(find "$dir" -type f \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.mkv' -o -iname '*.avi' -o -iname '*.webm' \) \
             -printf '%s\t%p\n' | sort -rn | head -n1 | cut -f2-)"
  fi
  [ -n "$inner" ] || { warn "no video found inside $src"; return 1; }
  printf '%s' "$inner"
}

# Build the ffmpeg command for $in -> $out, copying streams that already comply.
transcode() {
  local in="$1" out="$2" title="$3"
  local v a vcodec pixfmt w h profile field acodec
  v="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt,width,height,profile,field_order \
        -of json "$in")"
  a="$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,channels -of json "$in")"
  vcodec="$(jq -r '.streams[0].codec_name // ""' <<<"$v")"
  pixfmt="$(jq -r '.streams[0].pix_fmt // ""' <<<"$v")"
  w="$(jq -r '.streams[0].width // 0' <<<"$v")"
  h="$(jq -r '.streams[0].height // 0' <<<"$v")"
  profile="$(jq -r '.streams[0].profile // ""' <<<"$v")"
  field="$(jq -r '.streams[0].field_order // "progressive"' <<<"$v")"
  acodec="$(jq -r '.streams[0].codec_name // ""' <<<"$a")"
  local channels; channels="$(jq -r '.streams[0].channels // 0' <<<"$a")"
  [ -n "$vcodec" ] || { warn "no video stream in $in"; return 1; }

  local vargs aargs
  if [ "$vcodec" = h264 ] && [ "$pixfmt" = yuv420p ] && [ "$w" -le $MAX_W ] && [ "$h" -le $MAX_H ] \
     && [[ "$profile" != *"High 10"* && "$profile" != *"4:2:2"* && "$profile" != *"4:4:4"* ]] \
     && [[ "$field" = progressive || "$field" = unknown ]]; then
    vargs=(-c:v copy)
    log "  video: h264 ${w}x${h} already compliant, copying"
  else
    local vf="scale=w='min($MAX_W,iw)':h='min($MAX_H,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
    case "$field" in tt|bb|tb|bt) vf="bwdif=mode=send_frame:parity=auto:deint=all,$vf" ;; esac
    vargs=(-c:v libx264 -preset "$X264_PRESET" -crf "$X264_CRF" -profile:v high -level:v 4.1
           -pix_fmt yuv420p -vf "$vf")
    log "  video: $vcodec ${w}x${h} ($field) -> h264 (crf $X264_CRF, preset $X264_PRESET)"
  fi
  if [ -z "$acodec" ]; then
    aargs=()
    log "  audio: none"
  elif [ "$acodec" = aac ] && [ "$channels" -le 2 ]; then
    aargs=(-map 0:a:0 -c:a copy)
    log "  audio: aac ${channels}ch, copying"
  else
    aargs=(-map 0:a:0 -c:a aac -b:a 160k -ac 2)
    log "  audio: $acodec ${channels}ch -> aac stereo"
  fi

  local tmp="${out%.mp4}.partial.mp4"
  mkdir -p "$(dirname "$out")"
  ffmpeg -nostdin -hide_banner -loglevel error -stats -y -i "$in" \
    -map 0:v:0 "${aargs[@]}" "${vargs[@]}" \
    -map_metadata -1 -map_chapters -1 -metadata title="$title" \
    -movflags +faststart -f mp4 "$tmp" || { rm -f "$tmp"; return 1; }
  mv -f "$tmp" "$out"
}

# Process one item. Returns non-zero on failure (the run continues).
process_item() {
  local item="$1" id url sha_want rel out srcname src sha_have input title
  id="$(jfield "$item" .id)"
  url="$(jfield "$item" .source_url)"
  sha_want="$(jfield "$item" .sha256)"
  title="$(jfield "$item" .title)"
  rel="$(output_rel "$item")" || { warn "$id: can't build an output path (check kind/series/season/episode)"; return 1; }
  out="$MEDIA_DIR/$rel"
  srcname="${url##*/}"; srcname="${srcname%%\?*}"
  src="$CACHE_DIR/$id/$srcname"

  log "[$id] -> $rel"
  if [ "$DRY_RUN" = 1 ]; then
    log "  would fetch $url${sha_want:+ (expect sha256 $sha_want)}"
    return 0
  fi

  # Finished output from the same verified source: nothing to do.
  if [ -f "$out" ] && [ -f "$out.source-sha256" ] && [ -n "$sha_want" ] \
     && [ "$(cat "$out.source-sha256")" = "$sha_want" ]; then
    log "  up to date"
    return 0
  fi

  if [ ! -f "$src" ]; then
    download "$url" "$src" || { warn "$id: download failed"; return 1; }
  fi

  log "  hashing"
  sha_have="$(sha256sum "$src" | cut -d' ' -f1)"
  if [ -z "$sha_want" ]; then
    record_sha "$id" "$sha_have" || { warn "$id: couldn't write sha256 to $MANIFEST"; return 1; }
    sha_want="$sha_have"
    log "  recorded sha256 $sha_have in manifest"
  elif [ "$sha_have" != "$sha_want" ]; then
    warn "$id: sha256 mismatch (manifest $sha_want, got $sha_have); moving the file aside"
    mv -f "$src" "$src.bad-$(date +%s)"
    return 1
  fi

  input="$(unpack_if_needed "$item" "$src")" || { warn "$id: unpack failed"; return 1; }
  transcode "$input" "$out" "$title" || { warn "$id: ffmpeg failed"; return 1; }
  printf '%s\n' "$sha_want" >"$out.source-sha256"
  log "  wrote $(du -h "$out" | cut -f1) $rel"

  if [ "$PRUNE_DOWNLOADS" = 1 ]; then
    rm -rf "$CACHE_DIR/$id"
    log "  pruned download"
  fi
}

write_credits() {
  local out="$1" tmp
  mkdir -p "$(dirname "$out")"
  tmp="$(mktemp "${out}.XXXXXX")"
  {
    cat <<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Credits - What's On TV demo</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 52rem; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.6rem; margin-bottom: .25rem; }
  h2 { font-size: 1.2rem; margin-top: 2rem; border-bottom: 1px solid #8884; padding-bottom: .25rem; }
  .item { margin: 1rem 0; }
  .item h3 { font-size: 1rem; margin: 0; }
  .meta { opacity: .8; font-size: .92rem; }
  .credit { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9rem; }
  a { color: inherit; }
</style>
</head>
<body>
<h1>Credits</h1>
<p>The demo library at this server contains only media that may be freely redistributed: open movies from the
Blender Foundation under Creative Commons Attribution licenses, and films and TV episodes in the public domain in the
United States. Each title is shown unaltered apart from format conversion (H.264/AAC, at most 1080p), with its original
credits intact. Public-domain status is assessed under US law and may differ elsewhere.</p>
HTML
    jq -r '
      def esc: tostring | @html;
      def entry:
        "<div class=\"item\"><h3>"
        + (if .kind == "episode"
             then (.series|esc) + " (" + (.series_year|tostring) + ") &mdash; S" + ((.season|tostring) | if length < 2 then "0"+. else . end)
                  + "E" + ((.episode|tostring) | if length < 2 then "0"+. else . end) + ": " + (.title|esc)
             else (.title|esc) + " (" + (.year|tostring) + ")" end)
        + "</h3>"
        + (if (.attribution // "") != "" then "<div class=\"credit\">" + (.attribution|esc) + "</div>" else "" end)
        + "<div class=\"meta\">"
        + (if .license == "public-domain"
             then "Public domain in the United States (<a href=\"" + (.license_url|esc) + "\">Public Domain Mark</a>). "
             else "Licensed under <a href=\"" + (.license_url|esc) + "\">" + (.license|esc) + "</a>. " end)
        + (.basis|esc)
        + " <a href=\"" + (.basis_url|esc) + "\">Source</a>."
        + " Copy obtained from <a href=\"" + (.source_url|esc) + "\">" + ((.source_url | capture("^https?://(?<h>[^/]+)").h)|esc) + "</a>."
        + "</div></div>";
      def section($title; f):
        ([.items[] | select(f)]) as $xs
        | if ($xs|length) == 0 then empty
          else "<h2>" + $title + "</h2>", ($xs[] | entry) end;
      section("Blender open movies"; .kind == "short"),
      section("Feature films"; .kind == "movie"),
      section("TV episodes"; .kind == "episode")
    ' "$MANIFEST"
    printf '<p class="meta">Generated %s from manifest.json.</p>\n</body>\n</html>\n' "$(date -u +%Y-%m-%d)"
  } >"$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$out"
  log "credits page: $out"
}

main() {
  need_tools jq
  [ -f "$MANIFEST" ] || die "manifest not found: $MANIFEST"
  jq -e '.items | type == "array"' "$MANIFEST" >/dev/null || die "manifest has no items array"

  if [ "$CREDITS_ONLY" = 1 ]; then write_credits "$CREDITS_OUT"; return 0; fi

  if [ "$DRY_RUN" != 1 ]; then
    need_tools curl ffmpeg ffprobe sha256sum unzip flock find
    mkdir -p "$MEDIA_DIR" "$CACHE_DIR"
    exec 9>"$CACHE_DIR/.fetch.lock"
    flock -n 9 || die "another fetch.sh is already running (lock $CACHE_DIR/.fetch.lock)"
  fi

  local -a wanted=("$@")
  local failed=() n=0 item id
  # Read items one per line; sha256 updates rewrite the file, so re-read each
  # item fresh by id rather than holding the whole list.
  local -a ids
  mapfile -t ids < <(jq -r '.items[].id' "$MANIFEST")
  if [ ${#wanted[@]} -gt 0 ]; then
    local w found
    for w in "${wanted[@]}"; do
      found=0; for id in "${ids[@]}"; do [ "$id" = "$w" ] && found=1; done
      [ $found = 1 ] || die "unknown id: $w"
    done
    ids=("${wanted[@]}")
  fi

  for id in "${ids[@]}"; do
    item="$(jq -c --arg id "$id" '.items[] | select(.id == $id)' "$MANIFEST")"
    n=$((n + 1))
    process_item "$item" || failed+=("$id")
  done

  [ "$DRY_RUN" = 1 ] && return 0
  write_credits "$CREDITS_OUT"
  log "media size: $(du -sh --exclude=.downloads "$MEDIA_DIR" 2>/dev/null | cut -f1) (downloads: $(du -sh "$CACHE_DIR" 2>/dev/null | cut -f1))"
  if [ ${#failed[@]} -gt 0 ]; then
    warn "${#failed[@]} of $n item(s) failed: ${failed[*]} (re-run to retry)"
    return 1
  fi
  log "done: $n item(s)"
}

main "$@"
