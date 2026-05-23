' ToggleRow — focusable settings row with a label and an iOS-style
' on/off pill. Pressing OK toggles `value` and fires `valueChanged`
' so the parent can persist the change.

sub init()
    m.bg = m.top.findNode("bg")
    m.rowLabel = m.top.findNode("rowLabel")
    m.toggleTrack = m.top.findNode("toggleTrack")
    m.toggleThumb = m.top.findNode("toggleThumb")
    m.focusRingTop = m.top.findNode("focusRingTop")
    m.focusRingBottom = m.top.findNode("focusRingBottom")
    m.focusRingLeft = m.top.findNode("focusRingLeft")
    m.focusRingRight = m.top.findNode("focusRingRight")

    m.top.observeField("focusedChild", "applyFocusStyle")

    if m.top.label <> invalid then m.rowLabel.text = m.top.label
    applyValueStyle()
    applyFocusStyle()
end sub

sub onLabelChanged()
    m.rowLabel.text = m.top.label
end sub

sub onValueChanged()
    applyValueStyle()
end sub

sub onRowWidthChanged()
    w = m.top.rowWidth
    if w = invalid or w <= 0 then w = 800
    m.bg.width = w
    m.focusRingTop.width = w
    m.focusRingBottom.width = w
    m.focusRingRight.translation = [w - 3, 3]
    ' Push the pill flush against the right edge regardless of width.
    m.toggleTrack.translation = [w - 76, 17]
    m.toggleThumb.translation = [w - 72, 21]
    ' Label takes the remaining horizontal room minus pill area.
    m.rowLabel.width = w - 100
end sub

sub applyValueStyle()
    on = (m.top.value = true)
    if on
        m.toggleTrack.color = "0xe5a00dff"
        ' Slide thumb to the right end of the 56-wide track.
        baseX = m.toggleTrack.translation[0]
        m.toggleThumb.translation = [baseX + 34, 21]
    else
        m.toggleTrack.color = "0x333333ff"
        baseX = m.toggleTrack.translation[0]
        m.toggleThumb.translation = [baseX + 4, 21]
    end if
end sub

sub applyFocusStyle()
    if m.top.isInFocusChain()
        m.focusRingTop.color = "0xe5a00dff"
        m.focusRingBottom.color = "0xe5a00dff"
        m.focusRingLeft.color = "0xe5a00dff"
        m.focusRingRight.color = "0xe5a00dff"
    else
        m.focusRingTop.color = "0x00000000"
        m.focusRingBottom.color = "0x00000000"
        m.focusRingLeft.color = "0x00000000"
        m.focusRingRight.color = "0x00000000"
    end if
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if not press then return false
    if key = "OK"
        m.top.value = not (m.top.value = true)
        m.top.valueChanged = true
        return true
    end if
    return false
end function
