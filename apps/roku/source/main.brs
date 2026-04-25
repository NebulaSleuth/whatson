' ──────────────────────────────────────────────────────────────────────────
' Whats On Roku channel entry point.
'
' Boots the SceneGraph screen, hands control to HomeScene, and pumps the
' main message loop until the user backs out of the channel. Any exit path
' from HomeScene closes the screen, which falls out of the loop and ends
' the channel.
' ──────────────────────────────────────────────────────────────────────────

sub Main()
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.setMessagePort(port)
    scene = screen.CreateScene("HomeScene")

    ' Read the configured API URL from the registry. First-run users land
    ' on the Settings flow before we attempt any network call.
    apiUrl = readRegistry("apiUrl")
    if apiUrl <> invalid and apiUrl <> ""
        scene.apiUrl = apiUrl
    end if

    screen.show()

    while true
        msg = wait(0, port)
        if type(msg) = "roSGScreenEvent"
            if msg.isScreenClosed() then return
        end if
    end while
end sub

' Tiny helper — the Settings scene will write the same key. Kept inline
' here so main.brs has no other dependencies (BrightScript can't import).
function readRegistry(key as string) as string
    section = CreateObject("roRegistrySection", "whatson")
    if section = invalid then return ""
    if section.Exists(key) then return section.Read(key)
    return ""
end function
