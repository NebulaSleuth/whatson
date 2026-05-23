' Per-cell renderer for the Library MarkupGrid AND the Home/TV/Movies
' rowLists (configured via rowItemComponentName).
'
' MarkupGrid / RowList sets `itemContent` to the ContentNode for this
' cell and updates `focusPercent` (0.0..1.0) as focus enters/leaves.
' Beyond the standard poster + label rendering this also paints:
'   - a top-left source badge (Plex / Jellyfin / Emby colours)
'   - a bottom progress bar driven by `itemProgress` (0..100)
'   - a translucent dim overlay on watched items
' Each surface no-ops cleanly when the corresponding field is missing
' / 0 / false so non-library callers (sports, default rendering) get
' the original "just a poster" behaviour.

sub init()
    print "[PosterItem] init"
    m.poster = m.top.findNode("poster")
    m.label = m.top.findNode("label")
    m.watchedDim = m.top.findNode("watchedDim")
    m.sourceBadgeBg = m.top.findNode("sourceBadgeBg")
    m.sourceBadgeLabel = m.top.findNode("sourceBadgeLabel")
    m.progressBarBg = m.top.findNode("progressBarBg")
    m.progressBarFill = m.top.findNode("progressBarFill")
    m.focusRingTop = m.top.findNode("focusRingTop")
    m.focusRingBottom = m.top.findNode("focusRingBottom")
    m.focusRingLeft = m.top.findNode("focusRingLeft")
    m.focusRingRight = m.top.findNode("focusRingRight")
    m.statusOverlayBg = m.top.findNode("statusOverlayBg")
    m.statusOverlayLabel = m.top.findNode("statusOverlayLabel")

    ' MarkupGrid (Library / Search) has no per-row focus concept and
    ' never writes to rowFocusPercent, so default to 1.0 — the focus
    ' ring then keys off focusPercent alone in those grids. RowList
    ' overwrites this field as it animates row focus, so the dual-
    ' gate behaviour still kicks in there.
    m.top.rowFocusPercent = 1.0

    ' Sports-mode nodes — populated only for itemSource = "sports".
    m.sportsView = m.top.findNode("sportsView")
    m.sportsBg = m.top.findNode("sportsBg")
    m.sportsAccent = m.top.findNode("sportsAccent")
    m.sportsLeague = m.top.findNode("sportsLeague")
    m.sportsLiveBadge = m.top.findNode("sportsLiveBadge")
    m.sportsT1Logo = m.top.findNode("sportsT1Logo")
    m.sportsT1Name = m.top.findNode("sportsT1Name")
    m.sportsT1Score = m.top.findNode("sportsT1Score")
    m.sportsT2Logo = m.top.findNode("sportsT2Logo")
    m.sportsT2Name = m.top.findNode("sportsT2Name")
    m.sportsT2Score = m.top.findNode("sportsT2Score")
    m.sportsVs = m.top.findNode("sportsVs")
    m.sportsTournament = m.top.findNode("sportsTournament")
    m.sportsScrim = m.top.findNode("sportsScrim")
    m.sportsStatus = m.top.findNode("sportsStatus")
    m.sportsBroadcastPill = m.top.findNode("sportsBroadcastPill")
    m.sportsBroadcastBg = m.top.findNode("sportsBroadcastBg")
    m.sportsBroadcastLabel = m.top.findNode("sportsBroadcastLabel")
end sub

sub onContentChanged()
    content = m.top.itemContent
    if content = invalid then return
    src = lcase(stringOrEmpty(content.itemSource))

    ' Sports cards on Home get the portrait SportsCard layout instead
    ' of the regular poster + title rendering. Mirrors mobile, where
    ' Home Sports On Now / Later use SportsShelf with the full card
    ' design rather than poster cells.
    if src = "sports"
        ' Reshape the inset focus ring to wrap the 340×160 sports card.
        layoutFocusRing(340, 160)
        renderSportsCard(content)
        return
    end if

    ' Standard library / tracked / discover cell: poster + title below.
    ' Restore the focus ring to portrait poster dimensions.
    layoutFocusRing(220, 330)
    m.sportsView.visible = false
    m.poster.visible = true
    m.label.visible = true
    m.poster.uri = content.HDPosterUrl
    m.label.text = content.title

    ' Diagnostic: log the per-cell values so we can tell whether
    ' itemSource / itemProgress / itemWatched are arriving on this
    ' component. Custom AddField'd fields *should* survive when a
    ' ContentNode is handed to a cell component, but if any of these
    ' come back invalid/empty we know the issue is field plumbing,
    ' not visual rendering.
    print "[PosterItem] title="; content.title; " itemSource="; content.itemSource; " itemProgress="; content.itemProgress; " itemWatched="; content.itemWatched

    ' Source badge — only show for actual library servers; sports /
    ' tracked / sonarr / radarr cards skip it. Mirrors mobile's
    ' SourceBadge visibility rule.
    showBadge = false
    badgeColor = "0xe5a00dff"
    badgeTextColor = "0x000000ff"
    badgeText = ""
    if src = "plex"
        showBadge = true
        badgeColor = "0xe5a00dff"        ' Plex orange/gold
        badgeText = "PLEX"
    else if src = "jellyfin"
        showBadge = true
        badgeColor = "0xaa5cc3ff"        ' Jellyfin purple
        badgeTextColor = "0xffffffff"
        ' Truncated from "JELLYFIN" — even at 14px the full word
        ' won't fit cleanly in a 64px label without crowding.
        badgeText = "JELLY"
    else if src = "emby"
        showBadge = true
        badgeColor = "0x00a4dcff"        ' Emby blue
        badgeTextColor = "0xffffffff"
        badgeText = "EMBY"
    else if src = "sonarr"
        showBadge = true
        badgeColor = "0x35c5f4ff"        ' Sonarr sky-blue
        badgeText = "SONARR"
    else if src = "radarr"
        showBadge = true
        badgeColor = "0xffc230ff"        ' Radarr yellow
        badgeText = "RADARR"
    else if src = "live"
        showBadge = true
        badgeColor = "0x4caf50ff"        ' Live TV green
        badgeText = "LIVE TV"
    end if
    m.sourceBadgeBg.visible = showBadge
    m.sourceBadgeLabel.visible = showBadge
    if showBadge
        m.sourceBadgeBg.color = badgeColor
        m.sourceBadgeLabel.color = badgeTextColor
        m.sourceBadgeLabel.text = badgeText
    end if

    ' Progress bar — show when 0 < progress < 100. Watched items
    ' render the dim overlay but skip the bar (the bar's only purpose
    ' is "where you left off", redundant with the watched indicator).
    progress = 0
    if content.itemProgress <> invalid
        if type(content.itemProgress) = "Float" or type(content.itemProgress) = "roFloat" or type(content.itemProgress) = "Integer" or type(content.itemProgress) = "roInteger"
            progress = content.itemProgress
        end if
    end if
    watched = content.itemWatched = true
    showProgress = (not watched) and progress > 0 and progress < 100
    m.progressBarBg.visible = showProgress
    m.progressBarFill.visible = showProgress
    if showProgress
        fillWidth = Int(220 * progress / 100)
        if fillWidth < 2 then fillWidth = 2
        if fillWidth > 220 then fillWidth = 220
        m.progressBarFill.width = fillWidth
    end if

    ' Status overlay — matches the mobile ContentCard:
    '   downloading  → "Downloading" in cyan
    '   coming_soon  → formatted air date in gold
    '   ready+live   → formatted air time in gold
    statusText = ""
    statusColor = "0xe5a00dff"
    if content.itemStatus = "downloading"
        statusText = "Downloading"
        statusColor = "0x52c1d6ff"
    else if content.itemStatus = "coming_soon" and content.itemAvailableAt <> invalid and content.itemAvailableAt <> ""
        statusText = formatAvailableDate(content.itemAvailableAt)
    else if content.itemStatus = "ready" and src = "live" and content.itemAvailableAt <> invalid and content.itemAvailableAt <> ""
        statusText = formatAvailableDate(content.itemAvailableAt)
    end if
    if statusText <> ""
        m.statusOverlayLabel.text = statusText
        m.statusOverlayLabel.color = statusColor
        m.statusOverlayBg.visible = true
        m.statusOverlayLabel.visible = true
    else
        m.statusOverlayBg.visible = false
        m.statusOverlayLabel.visible = false
    end if

    ' Watched dim overlay. We only dim items the user has explicitly
    ' marked watched (or that the server returned as watched). Avoids
    ' the dim from sneaking onto un-watched cards on first paint.
    m.watchedDim.visible = watched
end sub

sub onFocusChanged()
    ' Swap the gold focus ring strips on/off and brighten the title.
    ' Combine focusPercent (per-row) with rowFocusPercent (which row
    ' is the focused row) so the ring only renders on the truly
    ' active cell — otherwise every row the user has previously
    ' visited keeps showing its last cell's ring at focusPercent=1.0.
    pct = m.top.focusPercent
    rowPct = m.top.rowFocusPercent
    if pct = invalid then pct = 0
    if rowPct = invalid then rowPct = 0
    if pct >= 0.5 and rowPct >= 0.5
        m.label.color = "0xffffffff"
        setFocusRingColor("0xe5a00dff")
    else
        m.label.color = "0xb0b0b0ff"
        setFocusRingColor("0x00000000")
    end if
end sub

sub setFocusRingColor(c as string)
    m.focusRingTop.color = c
    m.focusRingBottom.color = c
    m.focusRingLeft.color = c
    m.focusRingRight.color = c
end sub

' Size + position the 4 focus-ring strips to wrap an arbitrary
' cell-content rectangle (w × h). Strips are 4px thick and sit on
' the inside of the boundary, overlaying the outer ~4px of the
' content (poster art / sports card). RowList clips at the cell's
' left edge so we cannot draw an external outline.
sub layoutFocusRing(w as integer, h as integer)
    m.focusRingTop.translation = [0, 0]
    m.focusRingTop.width = w
    m.focusRingTop.height = 4
    m.focusRingBottom.translation = [0, h - 4]
    m.focusRingBottom.width = w
    m.focusRingBottom.height = 4
    m.focusRingLeft.translation = [0, 4]
    m.focusRingLeft.width = 4
    m.focusRingLeft.height = h - 8
    m.focusRingRight.translation = [w - 4, 4]
    m.focusRingRight.width = 4
    m.focusRingRight.height = h - 8
end sub

function stringOrEmpty(v as dynamic) as string
    if v = invalid then return ""
    return v
end function

' Mirrors apps/mobile/components/ContentCard.tsx → formatAvailableDate.
' Today → time of day; ±1 → Tomorrow / Yesterday; within a week →
' short weekday; otherwise → "Mon Day".
function formatAvailableDate(iso as string) as string
    if iso = "" then return ""
    dt = CreateObject("roDateTime")
    dt.FromISO8601String(iso)
    if dt.AsSeconds() = 0 then return ""
    dt.ToLocalTime()

    now = CreateObject("roDateTime")
    now.Mark()
    now.ToLocalTime()

    nowDay = floor_div(now.AsSeconds(), 86400)
    evtDay = floor_div(dt.AsSeconds(), 86400)
    diff = evtDay - nowDay

    weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    if diff = 0
        hours24 = dt.GetHours()
        suffix = "AM"
        hours12 = hours24
        if hours24 = 0
            hours12 = 12
        else if hours24 = 12
            suffix = "PM"
        else if hours24 > 12
            hours12 = hours24 - 12
            suffix = "PM"
        end if
        minutes = dt.GetMinutes().toStr()
        if Len(minutes) = 1 then minutes = "0" + minutes
        return hours12.toStr() + ":" + minutes + " " + suffix
    end if
    if diff = 1 then return "Tomorrow"
    if diff > 1 and diff <= 7 then return weekdays[dt.GetDayOfWeek()]
    if diff = -1 then return "Yesterday"
    if diff < 0 and diff >= -6 then return "Last " + weekdays[dt.GetDayOfWeek()]
    monthIdx = dt.GetMonth() - 1
    if monthIdx < 0 or monthIdx > 11 then monthIdx = 0
    return months[monthIdx] + " " + dt.GetDayOfMonth().toStr()
end function

function floor_div(a as longinteger, b as longinteger) as longinteger
    q = a / b
    if q < 0 and (q * b) <> a then q = q - 1
    return q
end function

' ─── Sports-mode rendering ────────────────────────────────────────
'
' Portrait variant of SportsCard.brs sized for the 160×240 home cell.
' Reads the same flat fields buildSportsCardChild stamps on the
' ContentNode (league, team1Name, team1LogoUrl, statusText, bgColor,
' isLive, isTeamSport, …). Standard poster / label / badge nodes get
' hidden so this view owns the full cell area.

sub renderSportsCard(content as object)
    ' Hide the standard cell chrome — sports view fills the cell.
    m.poster.visible = false
    m.label.visible = false
    m.watchedDim.visible = false
    m.sourceBadgeBg.visible = false
    m.sourceBadgeLabel.visible = false
    m.progressBarBg.visible = false
    m.progressBarFill.visible = false
    m.statusOverlayBg.visible = false
    m.statusOverlayLabel.visible = false
    m.sportsView.visible = true

    isLive = content.isLive = true
    isUpcoming = content.isUpcoming = true
    isCompleted = content.isCompleted = true
    isTeamSport = content.isTeamSport = true

    ' Background — live + completed keep surface dark, upcoming adopts
    ' followed/home team's primary colour when present. Mirrors
    ' SportsCard.brs.
    bgColor = content.bgColor
    if isLive or isCompleted or bgColor = invalid or bgColor = ""
        m.sportsBg.color = "0x1a1a1aff"
    else
        m.sportsBg.color = bgColor
    end if

    ' Top accent strip on live cards only.
    accentColor = content.accentColor
    if isLive and accentColor <> invalid and accentColor <> ""
        m.sportsAccent.color = accentColor
        m.sportsAccent.visible = true
    else
        m.sportsAccent.visible = false
    end if

    ' Scrim under the footer on coloured upcoming cards so the status
    ' text stays legible over bright primary colours.
    m.sportsScrim.visible = isUpcoming and isTeamSport and bgColor <> "" and bgColor <> invalid

    m.sportsLeague.text = stringOrEmpty(content.league)
    m.sportsLiveBadge.visible = isLive

    ' Text colour — black-on-light vs white-on-dark for upcoming cards.
    textColor = "0xffffffff"
    mutedColor = "0xc0c0c0ff"
    if isUpcoming and isTeamSport and bgColor <> "" and bgColor <> invalid
        if isLightBgColor(bgColor)
            textColor = "0x000000ff"
            mutedColor = "0x202020ff"
        end if
    end if
    m.sportsLeague.color = mutedColor

    showTeams = isTeamSport and content.team1Name <> invalid and content.team1Name <> "" and content.team2Name <> invalid and content.team2Name <> ""
    ' Scores show on live + completed cards (final score is the recap).
    ' Upcoming cards omit scores — ESPN's pre-game state often returns
    ' "0" which would mislead.
    showScores = showTeams and (isLive or isCompleted)

    m.sportsT1Logo.visible = showTeams
    m.sportsT1Name.visible = showTeams
    m.sportsT1Score.visible = showScores
    m.sportsT2Logo.visible = showTeams
    m.sportsT2Name.visible = showTeams
    m.sportsT2Score.visible = showScores
    m.sportsVs.visible = false
    m.sportsTournament.visible = not showTeams

    if showTeams
        ' Winner / loser highlight on completed cards.
        winnerColor = "0xe5a00dff"
        loserColor = "0x808080ff"
        t1Color = textColor
        t2Color = textColor
        if isCompleted
            if content.team1Winner = true
                t1Color = winnerColor
                t2Color = loserColor
            else if content.team2Winner = true
                t1Color = loserColor
                t2Color = winnerColor
            end if
        end if

        m.sportsT1Logo.uri = stringOrEmpty(content.team1LogoUrl)
        m.sportsT1Name.text = stringOrEmpty(content.team1Name)
        m.sportsT1Name.color = t1Color
        m.sportsT1Score.text = stringOrEmpty(content.team1Score)
        m.sportsT1Score.color = t1Color

        m.sportsT2Logo.uri = stringOrEmpty(content.team2LogoUrl)
        m.sportsT2Name.text = stringOrEmpty(content.team2Name)
        m.sportsT2Name.color = t2Color
        m.sportsT2Score.text = stringOrEmpty(content.team2Score)
        m.sportsT2Score.color = t2Color
    else
        m.sportsTournament.text = stringOrEmpty(content.tournamentTitle)
        m.sportsTournament.color = textColor
    end if

    m.sportsStatus.text = stringOrEmpty(content.statusText)
    m.sportsStatus.color = textColor

    ' Broadcast pill — bottom-right. On coloured upcoming cards switch
    ' to white-on-brand-text per mobile broadcastPillUpcoming styling.
    ' Hidden on completed — the "Final" status text owns the right side.
    broadcast = stringOrEmpty(content.broadcast)
    if broadcast <> "" and not isCompleted
        m.sportsBroadcastLabel.text = broadcast
        m.sportsBroadcastPill.visible = true
        if isUpcoming and isTeamSport and bgColor <> "" and bgColor <> invalid
            m.sportsBroadcastBg.color = "0xffffffff"
            m.sportsBroadcastLabel.color = "0x111111ff"
        else
            m.sportsBroadcastBg.color = "0xe5a00d33"
            m.sportsBroadcastLabel.color = "0xe5a00dff"
        end if
    else
        m.sportsBroadcastPill.visible = false
    end if

    print "[PosterItem/sports] league="; content.league; " t1="; content.team1Name; " status="; iif(isLive, "live", iif(isCompleted, "completed", "upcoming"))
end sub

function iif(cond as boolean, a as string, b as string) as string
    if cond then return a
    return b
end function

' Luminance check — return true when the bg colour is light enough
' that we should flip the text to black. Same formula as SportsCard.brs
' (Rec. 601 luma ≈ 0.6 cutoff). Input format: "0xRRGGBBAA".
function isLightBgColor(hex as string) as boolean
    if hex = invalid or Len(hex) < 8 then return false
    rPart = Mid(hex, 3, 2)
    gPart = Mid(hex, 5, 2)
    bPart = Mid(hex, 7, 2)
    r = hexToInt(rPart)
    g = hexToInt(gPart)
    b = hexToInt(bPart)
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    return lum >= 0.6
end function

function hexToInt(s as string) as integer
    out = 0
    for i = 1 to Len(s)
        c = ucase(Mid(s, i, 1))
        d = 0
        if c >= "0" and c <= "9"
            d = Asc(c) - Asc("0")
        else if c >= "A" and c <= "F"
            d = 10 + Asc(c) - Asc("A")
        end if
        out = out * 16 + d
    end for
    return out
end function
