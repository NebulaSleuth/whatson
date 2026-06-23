sub init()
    m.avatarBg = m.top.findNode("avatarBg")
    m.initialLabel = m.top.findNode("initialLabel")
    m.nameLabel = m.top.findNode("nameLabel")
    m.pinBadgeBg = m.top.findNode("pinBadgeBg")
    m.pinBadgeLabel = m.top.findNode("pinBadgeLabel")
    m.focusRingTop = m.top.findNode("focusRingTop")
    m.focusRingBottom = m.top.findNode("focusRingBottom")
    m.focusRingLeft = m.top.findNode("focusRingLeft")
    m.focusRingRight = m.top.findNode("focusRingRight")
    ' MarkupGrid has no per-row focus concept; default rowFocusPercent
    ' to 1.0 so the focus ring keys off focusPercent alone (same trick
    ' PosterItem uses when hosted in a MarkupGrid).
    m.top.rowFocusPercent = 1.0
end sub

sub onContentChanged()
    content = m.top.itemContent
    if content = invalid then return

    bgColor = stringOrEmpty(content.itemBgColor)
    if bgColor = "" then bgColor = "0x374151ff"
    m.avatarBg.color = bgColor

    initial = stringOrEmpty(content.itemInitial)
    if initial = "" then initial = "?"
    m.initialLabel.text = initial
    m.initialLabel.color = pickContrastColor(bgColor)

    m.nameLabel.text = stringOrEmpty(content.itemName)

    hasPin = (content.itemHasPin = true)
    m.pinBadgeBg.visible = hasPin
    m.pinBadgeLabel.visible = hasPin
end sub

sub onFocusChanged()
    pct = m.top.focusPercent
    rowPct = m.top.rowFocusPercent
    if pct = invalid then pct = 0
    if rowPct = invalid then rowPct = 0
    if pct >= 0.5 and rowPct >= 0.5
        m.nameLabel.color = "0xffffffff"
        setFocusRingColor("0xf5d87aff")
    else
        m.nameLabel.color = "0xc0c0c0ff"
        setFocusRingColor("0x00000000")
    end if
end sub

sub setFocusRingColor(c as string)
    m.focusRingTop.color = c
    m.focusRingBottom.color = c
    m.focusRingLeft.color = c
    m.focusRingRight.color = c
end sub

function stringOrEmpty(v as dynamic) as string
    if v = invalid then return ""
    return v
end function

' Compute a roughly contrast-appropriate text colour for an avatar bg.
' Bg arrives in Roku's "0xRRGGBBAA" format; falls back to white.
function pickContrastColor(hex as string) as string
    if hex = invalid or Len(hex) < 8 then return "0xffffffff"
    r = hexToInt(Mid(hex, 3, 2))
    g = hexToInt(Mid(hex, 5, 2))
    b = hexToInt(Mid(hex, 7, 2))
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    if lum >= 0.65 then return "0x111111ff"
    return "0xffffffff"
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
