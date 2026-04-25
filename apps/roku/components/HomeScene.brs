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

    if m.top.apiUrl = invalid or m.top.apiUrl = ""
        m.status.text = "API URL not configured. Open Settings on the mobile app to configure."
        return
    end if

    m.task = CreateObject("roSGNode", "ApiTask")
    m.task.observeField("response", "onResponse")
    m.task.method = "GET"
    m.task.url = m.top.apiUrl + "/api/home"
    m.task.control = "RUN"
end sub

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
    if Left(poster, 1) = "/" then return m.top.apiUrl + poster
    return poster
end function
