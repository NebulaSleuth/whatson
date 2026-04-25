' ──────────────────────────────────────────────────────────────────────────
' HomeScene — phase 0 spike.
'
' Resolves the API URL, kicks off ApiTask to GET /api/home, and on response
' builds a ContentNode tree of shelves → posters and feeds it to the
' RowList. No tab bar yet (phase 1).
'
' This is the only screen in the spike. As the channel grows, HomeScene
' becomes the parent that swaps in TV / Movies / Library / Search / Sports
' / Settings child scenes via a tab bar (see PLAN.md §7).
' ──────────────────────────────────────────────────────────────────────────

sub init()
    m.title = m.top.findNode("title")
    m.status = m.top.findNode("status")
    m.rowList = m.top.findNode("rowList")

    ' Resolve apiUrl: prefer the field set by main.brs, but fall back to
    ' reading the registry directly. The fallback matters because Scene
    ' init() fires synchronously inside CreateScene() — before main.brs
    ' has a chance to assign m.top.apiUrl from the registry — so without
    ' this we'd always show "not configured" on a cold boot.
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
    m.task = CreateObject("roSGNode", "ApiTask")
    m.task.observeField("response", "onResponse")
    m.task.method = "GET"
    m.task.url = apiUrl + "/api/home"
    m.task.control = "RUN"
end sub

' Defensive URL normalisation. Handles three forms users typo most:
'   "192.168.1.10:3001"        → "http://192.168.1.10:3001"
'   "http:192.168.1.10:3001"   → "http://192.168.1.10:3001"  (lost the //)
'   "http://1.2.3.4:3001/"     → "http://1.2.3.4:3001"       (trailing slash)
function normalizeApiUrl(url as dynamic) as string
    if url = invalid then return ""
    s = url
    if s = "" then return ""

    ' If there's no "://" anywhere, the user gave us bare host:port (or a
    ' scheme that's missing its slashes). Strip any partial "http:" /
    ' "https:" prefix, then prepend the canonical "http://".
    if Instr(1, s, "://") = 0
        if Left(s, 6) = "https:" then s = Mid(s, 7)
        if Left(s, 5) = "http:" then s = Mid(s, 6)
        s = "http://" + s
    end if

    if Right(s, 1) = "/" then s = Left(s, Len(s) - 1)
    return s
end function

sub onResponse()
    response = m.task.response
    if response = invalid
        m.status.text = "No response from API at " + m.top.apiUrl
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
                posterUrl = resolvePosterUrl(item)
                if posterUrl <> ""
                    child.HDPosterUrl = posterUrl
                    child.SDPosterUrl = posterUrl
                end if
            end for
        end if
    end for

    m.rowList.content = rows
    m.rowList.visible = true
    m.status.visible = false
    m.rowList.setFocus(true)
end sub

' ───── Helpers ─────

function itemDisplayTitle(item as object) as string
    if item.showTitle <> invalid and item.showTitle <> ""
        return item.showTitle
    end if
    if item.title <> invalid then return item.title
    return ""
end function

' Backend artwork URLs come back relative — `/api/artwork?url=…`. The
' Roku Poster node needs absolute URLs, so we prefix the configured API
' base on every relative path. Already-absolute URLs pass through.
function resolvePosterUrl(item as object) as string
    artwork = item.artwork
    if artwork = invalid then return ""
    poster = artwork.poster
    if poster = invalid or poster = "" then return ""
    if Left(poster, 4) = "http" then return poster
    if Left(poster, 1) = "/" then return m.apiUrl + poster
    return poster
end function
