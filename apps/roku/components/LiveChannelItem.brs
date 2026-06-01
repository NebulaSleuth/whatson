' Per-cell renderer for the Live TV channel grid. See LiveChannelItem.xml
' for layout. Reads itemContent fields populated by HomeScene.brs.

sub init()
    m.cellBg = m.top.findNode("cellBg")
    m.logo = m.top.findNode("logo")
    m.channelNumber = m.top.findNode("channelNumber")
    m.channelCallSign = m.top.findNode("channelCallSign")
    m.channelName = m.top.findNode("channelName")
    m.hdChipBg = m.top.findNode("hdChipBg")
    m.hdChipLabel = m.top.findNode("hdChipLabel")
    m.focusRingTop = m.top.findNode("focusRingTop")
    m.focusRingBottom = m.top.findNode("focusRingBottom")
    m.focusRingLeft = m.top.findNode("focusRingLeft")
    m.focusRingRight = m.top.findNode("focusRingRight")
    m.top.rowFocusPercent = 1.0
end sub

sub onContentChanged()
    content = m.top.itemContent
    if content = invalid then return

    number = ""
    if content.itemChannelNumber <> invalid then number = content.itemChannelNumber
    callSign = ""
    if content.itemChannelCallSign <> invalid and content.itemChannelCallSign <> ""
        callSign = content.itemChannelCallSign
    end if
    name = ""
    if content.itemChannelName <> invalid then name = content.itemChannelName

    m.channelNumber.text = number
    m.channelCallSign.text = callSign
    m.channelName.text = name

    logoUrl = ""
    if content.itemChannelLogoUrl <> invalid and content.itemChannelLogoUrl <> ""
        logoUrl = content.itemChannelLogoUrl
    end if
    if logoUrl <> ""
        m.logo.uri = logoUrl
        m.logo.visible = true
        ' When we have a logo, dim the fallback labels (still useful as
        ' a backstop if the logo image fails to load).
        m.channelNumber.visible = false
        m.channelCallSign.visible = false
    else
        m.logo.visible = false
        m.channelNumber.visible = true
        m.channelCallSign.visible = true
    end if

    hd = content.itemChannelHd = true
    m.hdChipBg.visible = hd
    m.hdChipLabel.visible = hd
end sub

sub onFocusChanged()
    fp = m.top.focusPercent
    rowFp = m.top.rowFocusPercent
    if fp = invalid then fp = 0
    if rowFp = invalid then rowFp = 0
    focused = fp >= 0.5 and rowFp >= 0.5
    m.focusRingTop.visible = focused
    m.focusRingBottom.visible = focused
    m.focusRingLeft.visible = focused
    m.focusRingRight.visible = focused
    if focused
        m.cellBg.color = "0x26262cff"
    else
        m.cellBg.color = "0x1a1a1aff"
    end if
end sub
