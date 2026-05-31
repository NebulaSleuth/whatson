' Per-cell renderer for the show-detail episodes MarkupGrid. See
' EpisodeListItem.xml for the visual layout and the contract on which
' fields each cell expects (itemThumbUrl, title, itemEpisodeLabel,
' itemDuration, itemSummary, itemWatched, itemProgress).

sub init()
    m.cellBg = m.top.findNode("cellBg")
    m.thumb = m.top.findNode("thumb")
    m.thumbDim = m.top.findNode("thumbDim")
    m.progressBg = m.top.findNode("progressBg")
    m.progressFill = m.top.findNode("progressFill")
    m.epLabel = m.top.findNode("epLabel")
    m.epDuration = m.top.findNode("epDuration")
    m.epWatchedCheck = m.top.findNode("epWatchedCheck")
    m.epTitle = m.top.findNode("epTitle")
    m.epSummary = m.top.findNode("epSummary")
    m.focusRingTop = m.top.findNode("focusRingTop")
    m.focusRingBottom = m.top.findNode("focusRingBottom")
    m.focusRingLeft = m.top.findNode("focusRingLeft")
    m.focusRingRight = m.top.findNode("focusRingRight")
end sub

sub onContentChanged()
    content = m.top.itemContent
    if content = invalid then return

    ' Thumb. itemThumbUrl is the landscape episode preview that mobile
    ' uses as `artwork.thumbnail`. Falls back to HDPosterUrl (poster)
    ' only when no thumb is available — a rare backend case but worth
    ' rendering *something* rather than a blank tile.
    thumbUrl = ""
    if content.itemThumbUrl <> invalid and content.itemThumbUrl <> "" then thumbUrl = content.itemThumbUrl
    if thumbUrl = "" and content.HDPosterUrl <> invalid then thumbUrl = content.HDPosterUrl
    m.thumb.uri = thumbUrl

    ' Episode label (E01) — gold accent at top-left of the right column.
    epLabel = ""
    if content.itemEpisodeLabel <> invalid then epLabel = content.itemEpisodeLabel
    m.epLabel.text = epLabel

    ' Duration — secondary dim text. itemDuration is the raw minute
    ' count as a string (matches the rest of HomeScene.brs), so append
    ' "min" here for display.
    duration = ""
    if content.itemDuration <> invalid and content.itemDuration <> "" and content.itemDuration <> "0"
        duration = content.itemDuration + " min"
    end if
    m.epDuration.text = duration

    ' Title — plain episode title (no "E01 " prefix; that's in epLabel).
    title = ""
    if content.title <> invalid then title = content.title
    m.epTitle.text = title

    ' Summary — clamped to 2 lines by maxLines. Producer should send the
    ' raw episode summary; we don't ellipsize ourselves.
    summary = ""
    if content.itemSummary <> invalid and content.itemSummary <> "" then summary = content.itemSummary
    m.epSummary.text = summary

    ' Watched indicator + dim overlay on thumb.
    watched = content.itemWatched = true
    m.thumbDim.visible = watched
    m.epWatchedCheck.text = chr(10003) ' "✓"
    m.epWatchedCheck.visible = watched
    if watched
        m.epTitle.color = "0x8c8c8cff"
        m.epSummary.color = "0x6f6f6fff"
    else
        m.epTitle.color = "0xffffffff"
        m.epSummary.color = "0xb8b8b8ff"
    end if

    ' Progress strip on bottom 4px of thumb — only when not watched
    ' and progress is somewhere between 1 and 99%.
    progress = 0
    if content.itemProgress <> invalid
        if type(content.itemProgress) = "Float" or type(content.itemProgress) = "roFloat" or type(content.itemProgress) = "Integer" or type(content.itemProgress) = "roInteger"
            progress = content.itemProgress
        end if
    end if
    showProgress = (not watched) and progress > 0 and progress < 100
    m.progressBg.visible = showProgress
    m.progressFill.visible = showProgress
    if showProgress
        fillWidth = Int(240 * progress / 100)
        if fillWidth < 1 then fillWidth = 1
        if fillWidth > 240 then fillWidth = 240
        m.progressFill.width = fillWidth
    end if
end sub

sub onFocusChanged()
    fp = m.top.focusPercent
    focused = fp >= 0.5
    m.focusRingTop.visible = focused
    m.focusRingBottom.visible = focused
    m.focusRingLeft.visible = focused
    m.focusRingRight.visible = focused
    ' Lighten the background a bit on focus so the row visibly lifts
    ' even before the user notices the gold strips.
    if focused
        m.cellBg.color = "0x26262cff"
    else
        m.cellBg.color = "0x18181cff"
    end if
end sub
