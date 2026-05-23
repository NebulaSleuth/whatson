' TabButton — single tab in the top navigation strip. Visual states
' mirror the mobile tab bar:
'   resting (neither focused nor selected) → muted text + icon, no
'     bottom border, transparent background
'   selected (current view) → gold text + icon + gold bottom border
'   focused (D-pad hover) → gold text + icon + gold-tinted bg + gold
'     bottom border
' Both selected and focused can be true at once (the active tab while
' the user is still inside the tab strip).

sub init()
    m.bg = m.top.findNode("bg")
    m.iconLabel = m.top.findNode("iconLabel")
    m.textLabel = m.top.findNode("textLabel")
    m.bottomBorder = m.top.findNode("bottomBorder")

    ' Roku surfaces focus state via the node's `focusedChild` field —
    ' when this node (or a descendant) enters the focus chain, the
    ' field updates. isInFocusChain() is the synchronous read.
    m.top.observeField("focusedChild", "onFocusedChildChanged")

    ' Paint the initial text + icon from interface fields. onChange
    ' handlers don't always fire for the first XML-attribute resolution,
    ' so do it explicitly here.
    if m.top.label <> invalid then m.textLabel.text = m.top.label
    applyIconFont()
    applyIconOffset()
    applyHideIcon()
    applyButtonWidth()
    applyStyle()
end sub

sub onHideIconChanged()
    applyHideIcon()
end sub

sub onButtonWidthChanged()
    applyButtonWidth()
end sub

sub applyButtonWidth()
    w = m.top.buttonWidth
    if w = invalid or w <= 0 then w = 220
    m.bg.width = w
    m.iconLabel.width = w
    m.textLabel.width = w
    m.bottomBorder.width = w
end sub

' When hideIcon=true the icon row is hidden and the text label
' is vertically centred in the 80-tall button. Toggle pills (e.g.
' Library TV / Movies) use this for tab-bar styling without a glyph.
sub applyHideIcon()
    hide = (m.top.hideIcon = true)
    m.iconLabel.visible = not hide
    if hide
        m.textLabel.translation = [0, 25]
    else
        m.textLabel.translation = [0, 42]
    end if
end sub

sub onIconFontChanged()
    applyIconFont()
end sub

sub onIconYOffsetChanged()
    applyIconOffset()
end sub

sub applyIconOffset()
    offset = 0
    if m.top.iconYOffset <> invalid then offset = m.top.iconYOffset
    m.iconLabel.translation = [0, 6 + offset]
end sub

' The Geometric Shapes most tabs use ship in Noto Sans Symbols 2.
' The Settings gear ⚙ (U+2699) only ships in Symbols 1. Each
' TabButton instance picks via the iconFontUri interface field.
sub applyIconFont()
    uri = m.top.iconFontUri
    if uri = invalid or uri = "" then uri = "pkg:/fonts/NotoSansSymbols2.ttf"
    font = CreateObject("roSGNode", "Font")
    font.uri = uri
    font.size = 30
    m.iconLabel.font = font
end sub

sub onLabelChanged()
    m.textLabel.text = m.top.label
end sub

sub onIconChanged()
    applyStyle()
end sub

sub onSelectedChanged()
    applyStyle()
end sub

sub onFocusedChildChanged()
    applyStyle()
end sub

sub applyStyle()
    focused = m.top.isInFocusChain()
    selected = m.top.selected = true

    gold = "0xe5a00dff"
    muted = "0x666666ff"

    if focused or selected
        m.iconLabel.color = gold
        m.textLabel.color = gold
        m.bottomBorder.color = gold
    else
        m.iconLabel.color = muted
        m.textLabel.color = muted
        m.bottomBorder.color = "0x00000000"
    end if

    ' Focus-only background tint — rgba(229,160,13,0.15) ≈ alpha 0x26.
    if focused
        m.bg.color = "0xe5a00d26"
    else
        m.bg.color = "0x00000000"
    end if

    ' Swap the icon glyph to the "filled" variant when active. Matches
    ' the mobile TabIcon focused/unfocused pair (e.g. ◉ vs ○).
    if focused or selected
        if m.top.iconFocused <> invalid then m.iconLabel.text = m.top.iconFocused
    else
        if m.top.iconUnfocused <> invalid then m.iconLabel.text = m.top.iconUnfocused
    end if
end sub

' OK on a focused TabButton toggles buttonSelected so the parent can
' observe it and switch views.
function onKeyEvent(key as string, press as boolean) as boolean
    if not press then return false
    if key = "OK"
        m.top.buttonSelected = true
        return true
    end if
    return false
end function
