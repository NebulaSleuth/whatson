' Per-cell renderer for the Sports tab's RowList. Reads the plain-string
' fields HomeScene stamps onto each ContentNode (see buildSportsRow) and
' paints the SportsCard layout — bg colour, LIVE pill, team rows or
' tournament title, footer.
'
' Why such flat fields: ContentNode dynamic fields work cleanly with
' strings/booleans but custom dicts/arrays don't survive the SceneGraph
' marshalling reliably. Pre-flattening on the home-thread side keeps
' this component's contract narrow.

sub init()
    print "[SportsCard] init"
    m.bg = m.top.findNode("bg")
    m.focusRing = m.top.findNode("focusRing")
    m.accentBar = m.top.findNode("accentBar")
    m.scrim = m.top.findNode("scrim")

    m.leagueLabel = m.top.findNode("leagueLabel")
    m.liveBadge = m.top.findNode("liveBadge")

    m.team1Logo = m.top.findNode("team1Logo")
    m.team1Name = m.top.findNode("team1Name")
    m.team1Score = m.top.findNode("team1Score")
    m.team2Logo = m.top.findNode("team2Logo")
    m.team2Name = m.top.findNode("team2Name")
    m.team2Score = m.top.findNode("team2Score")

    m.tournamentTitle = m.top.findNode("tournamentTitle")
    m.statusLabel = m.top.findNode("statusLabel")
    m.broadcastPill = m.top.findNode("broadcastPill")
    m.broadcastBg = m.top.findNode("broadcastBg")
    m.broadcastLabel = m.top.findNode("broadcastLabel")
end sub

sub onContentChanged()
    content = m.top.itemContent
    if content = invalid then
        print "[SportsCard] content invalid"
        return
    end if
    print "[SportsCard] content league="; content.league; " team1="; content.team1Name; " isLive="; content.isLive

    isLive = content.isLive = true
    isUpcoming = content.isUpcoming = true
    isCompleted = content.isCompleted = true
    isTeamSport = content.isTeamSport = true

    ' Background colour — live + completed cards stay surface dark,
    ' upcoming cards adopt the followed/home team's primary colour.
    ' bgColor arrives as "0xRRGGBBff" (or empty when no usable colour
    ' was found).
    bgColor = content.bgColor
    if isLive or isCompleted or bgColor = invalid or bgColor = ""
        m.bg.color = "0x1a1a1aff"
    else
        m.bg.color = bgColor
    end if

    ' Top accent strip — only on live cards, only when an accent colour
    ' is available.
    accentColor = content.accentColor
    if isLive and accentColor <> invalid and accentColor <> ""
        m.accentBar.color = accentColor
        m.accentBar.visible = true
    else
        m.accentBar.visible = false
    end if

    ' Dark scrim under the footer on coloured upcoming cards.
    m.scrim.visible = isUpcoming and isTeamSport and bgColor <> "" and bgColor <> invalid

    ' League label + LIVE pill (live only; completed cards show "Final"
    ' in the footer status text instead).
    m.leagueLabel.text = content.league
    m.liveBadge.visible = isLive

    ' Text colour — black-on-light vs white-on-dark for upcoming cards.
    ' Live + completed cards always use white over the surface dark.
    textColor = "0xffffffff"
    mutedColor = "0xc0c0c0ff"
    if isUpcoming and isTeamSport and bgColor <> "" and bgColor <> invalid
        if isLightBgColor(bgColor)
            textColor = "0x000000ff"
            mutedColor = "0x202020ff"
        end if
    end if

    ' League label always uses the muted tone for hierarchy.
    m.leagueLabel.color = mutedColor

    ' Team rows vs tournament title. Mobile uses the same condition
    ' (teamSport && competitors >= 2) — replicate it.
    showTeams = isTeamSport and content.team1Name <> invalid and content.team1Name <> "" and content.team2Name <> invalid and content.team2Name <> ""
    ' Scores show for live + completed cards (final score is part of
    ' the recap). Upcoming cards omit scores — ESPN sometimes returns
    ' "0" for pre-game state which is misleading.
    showScores = showTeams and (isLive or isCompleted)

    m.team1Logo.visible = showTeams
    m.team1Name.visible = showTeams
    m.team1Score.visible = showScores
    m.team2Logo.visible = showTeams
    m.team2Name.visible = showTeams
    m.team2Score.visible = showScores
    m.tournamentTitle.visible = not showTeams

    if showTeams
        ' Winner / loser highlighting on completed cards: winning side
        ' picks up the gold accent, losing side dims to muted grey. Live
        ' cards use plain white for both teams (winner unknown).
        winnerColor = "0xe5a00dff"
        loserColor = "0x808080ff"
        t1Color = textColor
        t2Color = textColor
        if isCompleted
            if content.team1Winner = true
                t1Color = winnerColor
                t2Color = loserColor
            else if content.team2Winner = true
                t1Color = loserColor
                t2Color = winnerColor
            end if
        end if

        m.team1Logo.uri = stringOrEmpty(content.team1LogoUrl)
        m.team1Name.text = stringOrEmpty(content.team1Name)
        m.team1Name.color = t1Color
        m.team1Score.text = stringOrEmpty(content.team1Score)
        m.team1Score.color = t1Color

        m.team2Logo.uri = stringOrEmpty(content.team2LogoUrl)
        m.team2Name.text = stringOrEmpty(content.team2Name)
        m.team2Name.color = t2Color
        m.team2Score.text = stringOrEmpty(content.team2Score)
        m.team2Score.color = t2Color
    else
        m.tournamentTitle.text = stringOrEmpty(content.tournamentTitle)
        m.tournamentTitle.color = textColor
    end if

    ' Footer: status text + broadcast pill.
    m.statusLabel.text = stringOrEmpty(content.statusText)
    m.statusLabel.color = textColor

    ' Broadcast pill — live + upcoming only. Completed cards rely on
    ' the status text ("Final" / "Final/OT") for the right-side affordance.
    broadcast = stringOrEmpty(content.broadcast)
    if broadcast <> "" and not isCompleted
        m.broadcastLabel.text = broadcast
        m.broadcastPill.visible = true
        ' On coloured upcoming cards, give the pill an opaque white
        ' background with brand-text — matches mobile's broadcastPillUpcoming.
        if isUpcoming and isTeamSport and bgColor <> "" and bgColor <> invalid
            m.broadcastBg.color = "0xffffffff"
            m.broadcastLabel.color = "0x111111ff"
        else
            m.broadcastBg.color = "0xe5a00d33"
            m.broadcastLabel.color = "0xe5a00dff"
        end if
    else
        m.broadcastPill.visible = false
    end if
end sub

sub onFocusChanged()
    pct = m.top.focusPercent
    if pct = invalid then pct = 0
    if pct >= 0.5
        m.focusRing.color = "0xe5a00dff"
    else
        m.focusRing.color = "0xe5a00d00"
    end if
end sub

' Luminance check — return true when the bg colour is light enough to
' need black text. Same formula mobile uses (Rec. 601 luma ≈ 0.6 cutoff).
' Input format: "0xRRGGBBAA".
function isLightBgColor(hex as string) as boolean
    if hex = invalid or Len(hex) < 8 then return false
    rPart = Mid(hex, 3, 2)
    gPart = Mid(hex, 5, 2)
    bPart = Mid(hex, 7, 2)
    r = hexToInt(rPart)
    g = hexToInt(gPart)
    b = hexToInt(bPart)
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    return lum >= 0.6
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

function stringOrEmpty(v as dynamic) as string
    if v = invalid then return ""
    return v
end function
