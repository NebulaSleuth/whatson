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
end sub

sub onContentChanged()
    content = m.top.itemContent
    if content = invalid then return
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
    src = lcase(stringOrEmpty(content.itemSource))
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
        badgeColor = "0x9c27b0ff"        ' Jellyfin purple
        badgeTextColor = "0xffffffff"
        ' Truncated from "JELLYFIN" — even at 14px the full word
        ' won't fit cleanly in a 64px label without crowding.
        badgeText = "JELLY"
    else if src = "emby"
        showBadge = true
        badgeColor = "0x52b54bff"        ' Emby green
        badgeTextColor = "0xffffffff"
        badgeText = "EMBY"
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
        fillWidth = Int(160 * progress / 100)
        if fillWidth < 2 then fillWidth = 2
        if fillWidth > 160 then fillWidth = 160
        m.progressBarFill.width = fillWidth
    end if

    ' Watched dim overlay. We only dim items the user has explicitly
    ' marked watched (or that the server returned as watched). Avoids
    ' the dim from sneaking onto un-watched cards on first paint.
    m.watchedDim.visible = watched
end sub

sub onFocusChanged()
    ' RowList / MarkupGrid handles the focus visual itself via the
    ' `floatingFocus` animation style — we only swap the title colour
    ' between dim grey (unfocused) and bright white (focused) so the
    ' active cell's label pops.
    pct = m.top.focusPercent
    if pct = invalid then pct = 0
    if pct >= 0.5
        m.label.color = "0xffffffff"
    else
        m.label.color = "0xb0b0b0ff"
    end if
end sub

function stringOrEmpty(v as dynamic) as string
    if v = invalid then return ""
    return v
end function
