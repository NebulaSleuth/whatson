' ──────────────────────────────────────────────────────────────────────────
' HomeScene — phase 1.
'
' Three views inside one Scene: home (RowList of shelves), detail (hero +
' metadata + Play), player (fullscreen Video). Visibility + focus toggle
' between them; no scene stack. The Roku remote Back button is intercepted
' in onKeyEvent so it walks the view stack instead of exiting the channel.
'
' Item metadata flows through ContentNode.metadata: when we build rows we
' stash the full source item dict on each child node so DetailView can
' read everything in one hop.
' ──────────────────────────────────────────────────────────────────────────

sub init()
    m.title = m.top.findNode("title")
    m.status = m.top.findNode("status")
    m.rowList = m.top.findNode("rowList")

    m.homeView = m.top.findNode("homeView")
    m.detailView = m.top.findNode("detailView")
    m.playerView = m.top.findNode("playerView")

    m.detailBackdrop = m.top.findNode("detailBackdrop")
    m.detailTitle = m.top.findNode("detailTitle")
    m.detailSubtitle = m.top.findNode("detailSubtitle")
    m.detailMeta = m.top.findNode("detailMeta")
    m.detailSummary = m.top.findNode("detailSummary")
    m.playButton = m.top.findNode("playButton")
    m.backButton = m.top.findNode("backButton")
    m.video = m.top.findNode("video")

    m.currentView = "home"
    m.selectedItem = invalid
    m.playbackInfo = invalid
    m.lastReportedPositionTime = 0

    ' Resolve apiUrl: prefer the field set by main.brs, else read the
    ' registry directly. See PLAN §11 for rationale.
    apiUrl = m.top.apiUrl
    if apiUrl = invalid or apiUrl = ""
        section = CreateObject("roRegistrySection", "whatson")
        if section <> invalid and section.Exists("apiUrl")
            apiUrl = section.Read("apiUrl")
        end if
    end if
    apiUrl = normalizeApiUrl(apiUrl)
    print "[HomeScene] apiUrl resolved to: "; apiUrl

    if apiUrl = invalid or apiUrl = ""
        m.status.text = "API URL not configured. Set the 'apiUrl' value in registry section 'whatson' (see apps/roku/README.md)."
        return
    end if

    m.apiUrl = apiUrl

    ' Wire row-list selection + button presses.
    m.rowList.observeField("rowItemSelected", "onRowItemSelected")
    m.playButton.observeField("buttonSelected", "onPlayPressed")
    m.backButton.observeField("buttonSelected", "onBackFromDetail")
    m.video.observeField("state", "onVideoStateChanged")
    m.video.observeField("position", "onVideoPosition")

    ' Kick off /api/home.
    m.task = CreateObject("roSGNode", "ApiTask")
    m.task.observeField("response", "onHomeResponse")
    m.task.method = "GET"
    m.task.url = apiUrl + "/api/home"
    m.task.control = "RUN"
end sub

' ─── Home view ─────────────────────────────────────────────────────

sub onHomeResponse()
    response = m.task.response
    if response = invalid
        m.status.text = "No response from API at " + m.apiUrl
        return
    end if
    if response.success <> true
        errMsg = "Error"
        if response.error <> invalid then errMsg = response.error
        m.status.text = errMsg
        return
    end if

    sections = response.data.sections
    if sections = invalid or sections.Count() = 0
        m.status.text = "Home is empty. Make sure your media servers are configured."
        return
    end if

    rows = CreateObject("roSGNode", "ContentNode")
    for each section in sections
        row = rows.createChild("ContentNode")
        row.title = section.title
        items = section.items
        if items <> invalid
            for each item in items
                child = row.createChild("ContentNode")
                child.title = itemDisplayTitle(item)
                child.description = itemDescription(item)
                posterUrl = resolvePosterUrl(item)
                if posterUrl <> ""
                    child.HDPosterUrl = posterUrl
                    child.SDPosterUrl = posterUrl
                end if
                ' Stash the full source item for DetailView to read on click.
                child.AddField("itemSource", "string", false)
                child.AddField("itemSourceId", "string", false)
                child.AddField("itemTitle", "string", false)
                child.AddField("itemShowTitle", "string", false)
                child.AddField("itemSummary", "string", false)
                child.AddField("itemYear", "string", false)
                child.AddField("itemDuration", "string", false)
                child.AddField("itemBackdropUrl", "string", false)
                child.AddField("itemType", "string", false)
                child.itemSource = stringField(item, "source")
                child.itemSourceId = stringField(item, "sourceId")
                child.itemTitle = stringField(item, "title")
                child.itemShowTitle = stringField(item, "showTitle")
                child.itemSummary = stringField(item, "summary")
                child.itemYear = stringField(item, "year")
                child.itemDuration = stringField(item, "duration")
                child.itemType = stringField(item, "type")
                child.itemBackdropUrl = resolveBackdropUrl(item)
            end for
        end if
    end for

    m.rowList.content = rows
    m.rowList.visible = true
    m.status.visible = false
    m.rowList.setFocus(true)
end sub

' ─── Navigation ────────────────────────────────────────────────────

sub onRowItemSelected()
    sel = m.rowList.rowItemSelected
    if sel = invalid or sel.Count() < 2 then return
    rowIdx = sel[0]
    colIdx = sel[1]
    rows = m.rowList.content
    if rows = invalid then return
    row = rows.getChild(rowIdx)
    if row = invalid then return
    node = row.getChild(colIdx)
    if node = invalid then return

    populateDetail(node)
    showView("detail")
end sub

sub onBackFromDetail()
    showView("home")
end sub

' Override Scene's default key handler so the remote Back button walks
' our internal view stack instead of immediately exiting the channel.
function onKeyEvent(key as string, press as boolean) as boolean
    if not press then return false
    if key = "back"
        if m.currentView = "player"
            stopPlayback()
            showView("detail")
            return true
        end if
        if m.currentView = "detail"
            showView("home")
            return true
        end if
        ' currentView = "home" — let SceneGraph default fire (exits channel).
    end if
    return false
end function

sub showView(name as string)
    m.currentView = name
    m.homeView.visible = (name = "home")
    m.detailView.visible = (name = "detail")
    m.playerView.visible = (name = "player")
    if name = "home"
        m.rowList.setFocus(true)
    else if name = "detail"
        m.playButton.setFocus(true)
    else if name = "player"
        m.video.setFocus(true)
    end if
end sub

' ─── Detail view ───────────────────────────────────────────────────

sub populateDetail(node as object)
    m.selectedItem = node
    if node.itemBackdropUrl <> invalid and node.itemBackdropUrl <> ""
        m.detailBackdrop.uri = node.itemBackdropUrl
    else
        m.detailBackdrop.uri = ""
    end if

    title = node.itemShowTitle
    if title = invalid or title = "" then title = node.itemTitle
    m.detailTitle.text = title

    if node.itemShowTitle <> invalid and node.itemShowTitle <> "" and node.itemTitle <> invalid and node.itemTitle <> ""
        m.detailSubtitle.text = node.itemTitle
    else
        m.detailSubtitle.text = ""
    end if

    metaParts = []
    if node.itemYear <> invalid and node.itemYear <> "" and node.itemYear <> "0"
        metaParts.Push(node.itemYear)
    end if
    if node.itemDuration <> invalid and node.itemDuration <> "" and node.itemDuration <> "0"
        metaParts.Push(node.itemDuration + " min")
    end if
    if node.itemSource <> invalid and node.itemSource <> ""
        metaParts.Push(node.itemSource)
    end if
    m.detailMeta.text = joinStrings(metaParts, "  ·  ")

    if node.itemSummary <> invalid
        m.detailSummary.text = node.itemSummary
    else
        m.detailSummary.text = ""
    end if
end sub

' ─── Playback ──────────────────────────────────────────────────────

sub onPlayPressed()
    if m.selectedItem = invalid then return
    sourceId = m.selectedItem.itemSourceId
    src = m.selectedItem.itemSource
    if sourceId = invalid or sourceId = "" then return

    m.playbackTask = CreateObject("roSGNode", "ApiTask")
    m.playbackTask.observeField("response", "onPlaybackResponse")
    m.playbackTask.method = "GET"
    m.playbackTask.url = m.apiUrl + "/api/playback/" + sourceId + "?source=" + urlEncode(src)
    m.playbackTask.control = "RUN"

    print "[HomeScene] requesting playback for "; sourceId; " ("; src; ")"
end sub

sub onPlaybackResponse()
    response = m.playbackTask.response
    if response = invalid or response.success <> true
        msg = "Playback failed"
        if response <> invalid and response.error <> invalid then msg = response.error
        print "[HomeScene] playback request failed: "; msg
        return
    end if

    info = response.data
    m.playbackInfo = info
    m.lastReportedPositionTime = 0

    streamUrl = info.streamUrl
    if streamUrl = invalid or streamUrl = ""
        print "[HomeScene] playback response missing streamUrl"
        return
    end if

    content = CreateObject("roSGNode", "ContentNode")
    content.streamFormat = "hls"
    content.url = streamUrl
    if info.viewOffset <> invalid and info.viewOffset > 0
        content.playStart = Int(info.viewOffset / 1000)
    end if
    title = ""
    if info.title <> invalid then title = info.title
    content.title = title

    m.video.content = content
    m.video.control = "play"
    showView("player")
end sub

sub onVideoStateChanged()
    state = m.video.state
    print "[HomeScene] video state -> "; state
    if state = "finished" or state = "stopped" or state = "error"
        ' Save final position + tell server we're done. Then return to detail.
        reportProgress(true)
        sendStop()
        showView("detail")
    end if
end sub

sub onVideoPosition()
    ' Throttle to one POST /playback/progress every ~10 s while playing.
    posSeconds = m.video.position
    if posSeconds = invalid then return
    if (posSeconds - m.lastReportedPositionTime) >= 10
        reportProgress(false)
        m.lastReportedPositionTime = posSeconds
    end if
end sub

sub reportProgress(stopped as boolean)
    if m.playbackInfo = invalid or m.selectedItem = invalid then return
    posMs = 0
    if m.video.position <> invalid then posMs = Int(m.video.position * 1000)
    duration = 0
    if m.playbackInfo.duration <> invalid then duration = m.playbackInfo.duration
    state = "playing"
    if stopped then state = "stopped"

    body = {
        ratingKey: m.selectedItem.itemSourceId,
        time: posMs,
        duration: duration,
        state: state,
        sessionId: m.playbackInfo.sessionId,
        source: m.selectedItem.itemSource
    }

    progress = CreateObject("roSGNode", "ApiTask")
    progress.method = "POST"
    progress.url = m.apiUrl + "/api/playback/progress"
    progress.body = FormatJson(body)
    progress.control = "RUN"
end sub

sub sendStop()
    if m.playbackInfo = invalid or m.selectedItem = invalid then return
    body = {
        sessionId: m.playbackInfo.sessionId,
        source: m.selectedItem.itemSource
    }
    ' `stop` would shadow the BrightScript reserved word — use stopTask.
    stopTask = CreateObject("roSGNode", "ApiTask")
    stopTask.method = "POST"
    stopTask.url = m.apiUrl + "/api/playback/stop"
    stopTask.body = FormatJson(body)
    stopTask.control = "RUN"
end sub

sub stopPlayback()
    m.video.control = "stop"
end sub

' ─── Helpers ───────────────────────────────────────────────────────

function itemDisplayTitle(item as object) as string
    if item.showTitle <> invalid and item.showTitle <> "" then return item.showTitle
    if item.title <> invalid then return item.title
    return ""
end function

function itemDescription(item as object) as string
    if item.summary <> invalid then return item.summary
    return ""
end function

function stringField(item as object, name as string) as string
    v = item[name]
    if v = invalid then return ""
    if type(v) = "Integer" or type(v) = "roInteger" then return Str(v).Trim()
    return v.toStr()
end function

function joinStrings(arr as object, sep as string) as string
    out = ""
    for i = 0 to arr.Count() - 1
        if i > 0 then out = out + sep
        out = out + arr[i]
    end for
    return out
end function

function resolvePosterUrl(item as object) as string
    artwork = item.artwork
    if artwork = invalid then return ""
    poster = artwork.poster
    if poster = invalid or poster = "" then return ""
    if Left(poster, 4) = "http" then return poster
    if Left(poster, 1) = "/" then return m.apiUrl + poster
    return poster
end function

function resolveBackdropUrl(item as object) as string
    artwork = item.artwork
    if artwork = invalid then return ""
    bg = artwork.background
    if bg = invalid or bg = "" then bg = artwork.thumbnail
    if bg = invalid or bg = "" then return ""
    if Left(bg, 4) = "http" then return bg
    if Left(bg, 1) = "/" then return m.apiUrl + bg
    return bg
end function

' Defensive URL normalisation. Handles three forms users typo most.
function normalizeApiUrl(url as dynamic) as string
    if url = invalid then return ""
    s = url
    if s = "" then return ""

    if Instr(1, s, "://") = 0
        if Left(s, 6) = "https:" then s = Mid(s, 7)
        if Left(s, 5) = "http:" then s = Mid(s, 6)
        s = "http://" + s
    end if

    if Right(s, 1) = "/" then s = Left(s, Len(s) - 1)
    return s
end function

function urlEncode(s as dynamic) as string
    if s = invalid then return ""
    transfer = CreateObject("roUrlTransfer")
    return transfer.Escape(s)
end function
