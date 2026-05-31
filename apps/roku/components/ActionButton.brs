' Rectangular app-styled action button. See ActionButton.xml for the
' visual layout. Public surface:
'   text          - button label
'   buttonWidth   - width in px (defaults to 240)
'   actionSelected - boolean field that flips on every OK press;
'                    observers fire even when value doesn't change
'                    (`alwaysNotify="true"` on the interface)

sub init()
    m.bg = m.top.findNode("bg")
    m.borderTop = m.top.findNode("borderTop")
    m.borderBottom = m.top.findNode("borderBottom")
    m.borderLeft = m.top.findNode("borderLeft")
    m.borderRight = m.top.findNode("borderRight")
    m.label = m.top.findNode("label")
    m.top.observeField("focusedChild", "onFocusChanged")
    applyWidth(m.top.buttonWidth)
end sub

sub onTextChanged()
    m.label.text = m.top.text
end sub

sub onWidthChanged()
    applyWidth(m.top.buttonWidth)
end sub

sub applyWidth(w as integer)
    if w <= 0 then w = 240
    m.bg.width = w
    m.borderTop.width = w
    m.borderBottom.width = w
    m.borderLeft.height = 60
    m.borderRight.height = 60
    m.borderRight.translation = [w - 2, 0]
    m.label.width = w
end sub

sub onFocusChanged()
    focused = m.top.hasFocus() or m.top.isInFocusChain()
    m.borderTop.visible = focused
    m.borderBottom.visible = focused
    m.borderLeft.visible = focused
    m.borderRight.visible = focused
    if focused
        m.bg.color = "0x26262cff"
        m.label.color = "0xf5d87aff"
    else
        m.bg.color = "0x1a1a1aff"
        m.label.color = "0xffffffff"
    end if
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if not press then return false
    if key = "OK"
        m.top.actionSelected = not m.top.actionSelected
        return true
    end if
    return false
end function
