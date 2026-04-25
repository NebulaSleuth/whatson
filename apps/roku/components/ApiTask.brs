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

    headers = {}
    headers["Accept"] = "application/json"
    if m.top.userId <> invalid and m.top.userId <> ""
        headers["X-Plex-User"] = m.top.userId
    end if
    if m.top.connectionType <> invalid and m.top.connectionType <> ""
        headers["X-Plex-Connection"] = m.top.connectionType
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

    text = ""
    if hasBody
        text = transfer.PostFromString(body)
    else
        text = transfer.GetToString()
    end if

    if text = invalid or text = ""
        m.top.response = { success: false, error: "No response from " + m.top.url }
        return
    end if

    parsed = ParseJson(text)
    if parsed = invalid
        m.top.response = { success: false, error: "Invalid JSON from " + m.top.url }
        return
    end if

    m.top.response = parsed
end sub
