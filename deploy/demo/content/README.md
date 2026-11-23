# Demo content

This is the media for the public demo server. Every title can be redistributed and streamed publicly:
it is either a Blender open movie under a Creative Commons Attribution license, or a film or TV episode in
the **US** public domain. The demo is hosted in the US, and public-domain status elsewhere can differ.

- `manifest.json` is the source of truth. Each item has its license, a one-sentence `basis` with a
  `basis_url` citation, the exact `attribution` text for CC works, and the `source_url` of the best
  master found.
- `fetch.sh` downloads each item, records its sha256 in the manifest on the first fetch and verifies it on
  later runs, and converts it to H.264/AAC MP4 at 1080p or below. Streams that already comply are copied, not
  re-encoded. Output uses Jellyfin naming, and the script also writes `credits.html`.

**Status: approved by the owner on 2026-11-22.** Research was done the same day. Any title added
later needs the same check and a cited basis before it goes into `manifest.json`.

## Titles (25)

### Blender open movies (9, all `Shorts`)

| Title | Year | License | Basis | Source |
|---|---|---|---|---|
| Big Buck Bunny | 2008 | CC-BY 3.0 | [peach.blender.org/about](https://peach.blender.org/about/) | Blender mirror (nluug), 1080p |
| Elephants Dream | 2006 | CC-BY 2.5 | [orange.blender.org: Creative Commons license](https://orange.blender.org/blog/creative-commons-license-2/) | Internet Archive `ElephantsDream`, 1080p DivX |
| Sintel | 2010 | CC-BY 3.0 | [durian.blender.org/sharing](https://durian.blender.org/sharing/) | Blender mirror (nluug), 1080p MKV |
| Tears of Steel | 2012 | CC-BY 3.0 | [mango.blender.org/sharing](https://mango.blender.org/sharing/) | Blender mirror (nluug), 1080p MOV |
| Cosmos Laundromat | 2015 | CC-BY 3.0 | [gooseberry.blender.org/about](https://gooseberry.blender.org/about/) | video.blender.org, 1920x804 |
| Spring | 2019 | CC-BY 4.0 | [Blender Studio: Spring](https://studio.blender.org/projects/spring/pages/about/) | video.blender.org, 1920x804 |
| Coffee Run | 2020 | CC-BY 4.0 | [Blender Studio: Coffee Run licensing](https://studio.blender.org/projects/coffee-run/pages/licensing/) | video.blender.org |
| Sprite Fright | 2021 | CC-BY | [Blender Studio: Sprite Fright](https://studio.blender.org/projects/sprite-fright/pages/about/) | video.blender.org |
| Wing It! | 2023 | CC-BY 4.0 | [Blender Studio: Wing It! licensing](https://studio.blender.org/projects/wing-it/pages/licensing/) | video.blender.org, 1080p |

The credit lines come from each project's own licensing page and are in `manifest.json` and
`credits.html`. The Peach, Orange and Durian pages also ask that a full screening keep the film's
**entire credits roll**. `fetch.sh` never trims, so keep it that way.

Notes:
- `download.blender.org` sits behind a Cloudflare browser challenge that blocks scripts. The script
  uses the official mirror `ftp.nluug.nl` and Blender's own PeerTube instance (`video.blender.org`) instead.
- Big Buck Bunny, Elephants Dream and Tears of Steel each have a soundtrack also released on its own under
  a narrower license (NC-ND or ND). That license covers the separate audio files only. The films
  themselves are CC-BY, and they are shown unaltered.
- The Sprite Fright page literally says "Attribution 1.0", which is almost certainly a typo for 4.0. Either
  version permits this use with the same credit.

### US public-domain feature films (6, `Movies`)

| Title | Year | Basis | Citation |
|---|---|---|---|
| His Girl Friday | 1940 | The 1940 copyright (Columbia, reg. L 9305) was not renewed, so the film has been PD since 1969. The underlying 1928 play *The Front Page* entered the PD on 1 Jan 2024. | [Wikipedia](https://en.wikipedia.org/wiki/His_Girl_Friday) |
| Meet John Doe | 1941 | The 1941 copyright (reg. L 10453) was not renewed, so the film has been PD since 1969. | [Wikipedia](https://en.wikipedia.org/wiki/Meet_John_Doe) |
| The Stranger | 1946 | The Haig Corp. registered it (reg. L 409) but did not renew in 1973. | [Wikipedia](https://en.wikipedia.org/wiki/The_Stranger_(1946_film)) |
| D.O.A. | 1950 | The renewal was invalid. The Copyright Office first recorded it, then corrected its error. | [Wikipedia](https://en.wikipedia.org/wiki/D.O.A._(1949_film)), citing D. P. Hayes (2008) |
| The Little Shop of Horrors | 1960 | Corman never secured copyright, so the film was PD on release. | [Wikipedia](https://en.wikipedia.org/wiki/The_Little_Shop_of_Horrors), citing Fishman (Nolo 2010) and Pierce, *Film History* (2007) |
| Carnival of Souls | 1962 | The US release prints lacked a valid copyright notice. | [Wikipedia](https://en.wikipedia.org/wiki/Carnival_of_Souls), citing *NYT* 2014-02-14 |

All six sources are the Internet Archive `feature_films` transfers of the original black-and-white release
(MPEG-2, 640x480). Do not swap in a colorized version or a studio restoration. Those can carry their
own copyright in the new material; *Meet John Doe*, for example, has 1990s registrations for restored
editions (PA0000607538, PA0000700261).

### US public-domain TV (2 series, 10 episodes, `Shows`)

**The Big Picture (1951): S01E01–E05**, the US Army's Korean War run: *The First Forty Days in Korea*,
*Turning of the Tide*, *The United Nations Offensive*, *Chinese Reds Enter the Korean War*,
*United Nations Forces Escape the Chinese Trap*.
- Basis: produced by the US Army Signal Corps (Army Pictorial Service). As a work of the US government it was
  never eligible for copyright (17 U.S.C. § 105).
  See [Wikipedia](https://en.wikipedia.org/wiki/The_Big_Picture_(American_TV_series)) and the NARA catalog entries
  [2569439](https://catalog.archives.gov/id/2569439)–[2569443](https://catalog.archives.gov/id/2569443)
  (local IDs 111-TV-169 to 173).
- Source: NARA's own MPEG-2 transfers on Internet Archive (FedFlix, CC0-tagged).
- **Caveat:** NARA marks the whole series "Use restriction: Restricted – Possibly". This is boilerplate that
  means *some* footage *may* carry third-party rights; no specific restriction is listed for these episodes.
  Our episode numbers follow NARA's order and are not official.

**Sherlock Holmes (1954): S01E01–E05**: *The Case of the Cunningham Heritage*, *… of Lady Beryl*,
*… of the Pennsylvania Gun*, *… of the Texas Cowgirl*, *… of the Belligerent Ghost* (Ronald Howard; Guild Films).
- Basis: the episodes were syndicated in the US from October 1954, so a renewal was due in 1981–83. The Copyright
  Office's online records hold every renewal filed since 1978, and a search on each episode title found
  **no renewal (RE) record**. All of Conan Doyle's Holmes stories have been US public domain since 1 Jan 2023, so the
  characters raise no issue. Searched at [publicrecords.copyright.gov](https://publicrecords.copyright.gov/).
- Source: Internet Archive `SherlockHolmes1954`, 640x360 MP4. It's low resolution, but it's the best PD copy online.
- **Caveat:** this basis is the absence of a renewal record, not a published statement.
  Each title search does return one record: a **2025 security agreement (V15039D155)**, a financing
  document in which a lender's collateral list includes these episodes and also *His Girl Friday*. It is not a
  renewal and creates no copyright, but it does mean someone treats copies of these titles as an asset (most
  likely their own restored masters). Our copies are the older public-domain transfers.

## Considered and left out

| Title | Why |
|---|---|
| Agent 327: Operation Barbershop (Blender, 2017) | CC-BY-**ND**, and the characters are © Martin Lodewijk (excluded from the CC license). |
| Charge (Blender, 2022) | No licensing page could be found for it on Blender Studio. Add it if one turns up. |
| Singularity (Blender, 2026) | CC-BY 4.0, but video.blender.org has downloads switched off and no other master was found. |
| Glass Half (Blender, 2015) | CC-BY 3.0, but no downloadable master was found. |
| Caminandes 1–3 (Blender) | Sources disagree on the license (CC-BY 3.0, CC-BY 4.0, CC-BY-SA 3.0) and there's no authoritative page. |
| Night of the Living Dead (1968) | The film is PD (no notice), but its score is pre-existing Capitol Hi-Q library music, whose own copyright is a separate question. **Easy to add back if you're comfortable with that.** |
| Charade (1963) | The film is PD (defective notice), but Wikipedia notes that Mancini's score is still under copyright outside the film. |
| The Last Man on Earth (1964) | Based on Matheson's novel *I Am Legend* (1954), which is still under copyright. |
| Detour (1945) | Based on Goldsmith's 1939 novel. No documented basis covers the underlying work, and the 2018 Academy restoration is a separate work. |
| Silent features (*The General*, *Nosferatu*, etc.) | The films are PD by expiry, but most online copies carry modern, copyrighted scores. |
| Beverly Hillbillies, Bonanza, Dragnet, The Lucy Show, Andy Griffith (PD episodes) | Each has a separately published, renewed theme song or other derivative claims; CBS has asserted derivative rights in PD Andy Griffith episodes. |
| One Step Beyond | Only "most episodes" are PD, according to unsourced trivia, with no per-episode documentation. |
| Three Stooges / Popeye / Superman PD shorts | Trademark and right-of-publicity risk around the characters and performers. |

## Size

- Downloads: about **28 GB** (sum of `approx_size_mb`). They're kept in `$MEDIA_DIR/.downloads` so re-runs can
  verify them; `PRUNE_DOWNLOADS=1` deletes each source once its output is written.
- Output: an estimated **10–15 GB**. Most Blender files are already H.264 and are copied, with only the audio
  converted. The 480p MPEG-2 sources shrink a lot at CRF 20. That leaves plenty of room under 60 GB, even with
  the downloads kept.

## Running it

On the demo VM (needs `curl jq ffmpeg unzip`, plus `flock` from util-linux):

```bash
sudo apt-get install -y curl jq ffmpeg unzip
DRY_RUN=1 bash content/fetch.sh                 # print the plan
MEDIA_DIR=/srv/media bash content/fetch.sh      # everything (re-runnable)
MEDIA_DIR=/srv/media bash content/fetch.sh sintel his-girl-friday   # selected ids
cp /srv/media/credits.html site/credits.html    # Caddy serves it at /credits
```

The first successful run writes each sha256 into `manifest.json`; commit that change so future fetches are
verified. Layout:

```
/srv/media/Movies/His Girl Friday (1940)/His Girl Friday (1940).mp4
/srv/media/Shorts/Sintel (2010)/Sintel (2010).mp4
/srv/media/Shows/Sherlock Holmes (1954)/Season 01/Sherlock Holmes (1954) S01E01 - The Case of the Cunningham Heritage.mp4
```
