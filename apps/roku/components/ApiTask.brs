' ──────────────────────────────────────────────────────────────────────────
' ApiTask — runs on a Task thread, performs one HTTP request, writes the
' parsed response to m.top.response.
'
' Caller pattern:
'
'   task = CreateObject("roSGNode", "ApiTask")
'   task.observeField("response", "onResponse")
'   task.method = "GET"
'   task.url = apiUrl + "/api/home"
'   task.userId = currentUserId            ' optional
'   task.connectionType = "local"          ' or "remote"
'   task.control = "RUN"
'
' We always emit { success, data?, error? } so callers can branch on
' .success without checking for transport-vs-API failure separately.
' ──────────────────────────────────────────────────────────────────────────

sub init()
    m.top.functionName = "fetch"
end sub

sub fetch()
    transfer = CreateObject("roUrlTransfer")
    transfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    transfer.InitClientCertificates()
    transfer.SetUrl(m.top.url)

    ' Critical: roUrlTransfer's default behaviour is to DISCARD the
    ' response body on any non-2xx status. The server can send a
    ' Content-Length: 62 JSON error and event.GetString() will still
    ' return "". RetainBodyOnError opts into keeping the body so
    ' our backend's `{success:false, error:"..."}` errors come
    ' through to the channel UI.
    transfer.RetainBodyOnError(true)

    ' Use a message port + the async transfer methods so we can read
    ' the response BODY *and* status code on every request, including
    ' non-2xx responses.
    port = CreateObject("roMessagePort")
    transfer.SetMessagePort(port)

    headers = {}
    headers["Accept"] = "application/json"
    if m.top.userId <> invalid and m.top.userId <> ""
        if m.top.userKind = "whatson"
            headers["X-Whatson-User"] = m.top.userId
        else
            headers["X-Plex-User"] = m.top.userId
        end if
    end if
    if m.top.connectionType <> invalid and m.top.connectionType <> ""
        headers["X-Plex-Connection"] = m.top.connectionType
    end if
    if m.top.authKey <> invalid and m.top.authKey <> ""
        headers["X-Whatson-Auth"] = m.top.authKey
    end if

    method = m.top.method
    if method = invalid or method = "" then method = "GET"

    body = ""
    hasBody = (method = "POST" or method = "PUT") and m.top.body <> invalid and m.top.body <> ""
    if hasBody
        headers["Content-Type"] = "application/json"
        body = m.top.body
    end if

    transfer.SetHeaders(headers)
    transfer.SetRequest(method)

    if hasBody
        ok = transfer.AsyncPostFromString(body)
    else
        ok = transfer.AsyncGetToString()
    end if

    if not ok
        m.top.response = { success: false, error: "Failed to start request to " + m.top.url }
        return
    end if

    ' 60s ceiling — matches the backend's ARR_TIMEOUT for Sonarr/Radarr
    ' lookups, which are the slowest leg of any of our calls.
    event = wait(60000, port)
    if type(event) <> "roUrlEvent"
        m.top.response = { success: false, error: "Timeout / no response from " + m.top.url }
        return
    end if

    statusCode = event.GetResponseCode()
    text = event.GetString()

    ' Diagnostic — log status + body + response headers on errors so
    ' we can tell whether the body is genuinely empty server-side or
    ' whether Roku's transfer is dropping it (the latter is solvable
    ' by reading from a different transfer field).
    if statusCode < 200 or statusCode >= 300
        bodyPreview = ""
        if text <> invalid then bodyPreview = Left(text, 400)
        print "[ApiTask] non-2xx status="; statusCode; " url="; m.top.url
        print "[ApiTask] body[len="; Len(bodyPreview); "]: "; bodyPreview
        respHeaders = event.GetResponseHeaders()
        if respHeaders <> invalid
            for each k in respHeaders
                print "[ApiTask] resp header "; k; ": "; respHeaders[k]
            end for
        end if
    end if

    ' Try to parse the body regardless of status — backends like ours
    ' return { success, error } even on 4xx/5xx, and we want to surface
    ' the real message instead of "HTTP 400".
    parsed = invalid
    if text <> invalid and text <> ""
        parsed = ParseJson(text)
    end if

    if statusCode < 200 or statusCode >= 300
        errMsg = "HTTP " + statusCode.toStr()
        if parsed <> invalid and parsed.error <> invalid then errMsg = parsed.error.toStr()
        m.top.response = { success: false, error: errMsg, status: statusCode }
        return
    end if

    if parsed = invalid
        ' Successful status but no JSON — fire-and-forget POSTs (scrobble,
        ' progress, stop) hit this path. Emit a bare success.
        m.top.response = { success: true }
        return
    end if

    m.top.response = parsed
end sub
