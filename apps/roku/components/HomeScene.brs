' ──────────────────────────────────────────────────────────────────────────
' HomeScene — phase 1.
'
' Three views inside one Scene: home (RowList of shelves), detail (hero +
' metadata + Play), player (fullscreen Video). Visibility + focus toggle
' between them; no scene stack. The Roku remote Back button is intercepted
' in onKeyEvent so it walks the view stack instead of exiting the channel.
'
' Item metadata flows through ContentNode.metadata: when we build rows we
' stash the full source item dict on each child node so DetailView can
' read everything in one hop.
' ──────────────────────────────────────────────────────────────────────────

sub init()
    m.title = m.top.findNode("title")
    m.status = m.top.findNode("status")
    m.rowList = m.top.findNode("rowList")

    m.homeView = m.top.findNode("homeView")
    m.detailView = m.top.findNode("detailView")
    m.playerView = m.top.findNode("playerView")

    m.detailBackdrop = m.top.findNode("detailBackdrop")
    m.detailTitle = m.top.findNode("detailTitle")
    m.detailSubtitle = m.top.findNode("detailSubtitle")
    m.detailMeta = m.top.findNode("detailMeta")
    m.detailSummary = m.top.findNode("detailSummary")
    m.detailActions = m.top.findNode("detailActions")
    m.markWatchedButton = m.top.findNode("markWatchedButton")
    m.markUnwatchedButton = m.top.findNode("markUnwatchedButton")
    m.trackButton = m.top.findNode("trackButton")
    m.addSonarrButton = m.top.findNode("addSonarrButton")
    m.addRadarrButton = m.top.findNode("addRadarrButton")
    m.detailAddStatus = m.top.findNode("detailAddStatus")
    m.video = m.top.findNode("video")
    m.skipButton = m.top.findNode("skipButton")
    m.tracksView = m.top.findNode("tracksView")
    m.tracksAudioList = m.top.findNode("tracksAudioList")
    m.tracksSubtitleList = m.top.findNode("tracksSubtitleList")
    m.tracksCloseButton = m.top.findNode("tracksCloseButton")

    m.tabBar = m.top.findNode("tabBar")
    m.titleLabel = m.top.findNode("title")
    m.clockLabel = m.top.findNode("clockLabel")
    m.tvView = m.top.findNode("tvView")
    m.tvStatus = m.top.findNode("tvStatus")
    m.tvRowList = m.top.findNode("tvRowList")
    m.moviesView = m.top.findNode("moviesView")
    m.moviesStatus = m.top.findNode("moviesStatus")
    m.moviesRowList = m.top.findNode("moviesRowList")
    m.libraryView = m.top.findNode("libraryView")
    m.libraryTypeToggle = m.top.findNode("libraryTypeToggle")
    m.libraryStatus = m.top.findNode("libraryStatus")
    m.libraryGrid = m.top.findNode("libraryGrid")

    m.searchView = m.top.findNode("searchView")
    m.searchInputButton = m.top.findNode("searchInputButton")
    m.searchModeToggle = m.top.findNode("searchModeToggle")
    m.searchFilterToggle = m.top.findNode("searchFilterToggle")
    m.searchStatus = m.top.findNode("searchStatus")
    m.searchResultsGrid = m.top.findNode("searchResultsGrid")

    m.sportsView = m.top.findNode("sportsView")
    m.sportsStatus = m.top.findNode("sportsStatus")
    m.sportsRowList = m.top.findNode("sportsRowList")
    ' Cell renderer — RowList inherits ArrayGrid.itemComponentName
    ' (singular string), NOT the `rowItem*` 2D-array variant. The
    ' rowItem* form isn't a real settable field; setting it was
    ' silently ignored, which is why every custom-card attempt up
    ' to now produced empty / default-rendered cells.
    m.sportsRowList.itemComponentName = "SportsCard"

    ' Home / TV / Movies rowLists use PosterItem so Continue Watching
    ' cards get a progress bar and library cards get a source badge.
    ' PosterItem reads HDPosterUrl + title same as the default
    ' renderer, so non-library items (sports rows on home) still
    ' paint correctly even without their custom card component.
    m.rowList.itemComponentName = "PosterItem"
    m.tvRowList.itemComponentName = "PosterItem"
    m.moviesRowList.itemComponentName = "PosterItem"

    m.settingsView = m.top.findNode("settingsView")
    m.settingsApiUrlValue = m.top.findNode("settingsApiUrlValue")
    m.settingsUserValue = m.top.findNode("settingsUserValue")
    m.switchUserButton = m.top.findNode("switchUserButton")
    m.editApiUrlButton = m.top.findNode("editApiUrlButton")
    m.settingsConnectionValue = m.top.findNode("settingsConnectionValue")
    m.connectionToggle = m.top.findNode("connectionToggle")

    ' Server Updates section (settings view).
    m.settingsUpdateHeader = m.top.findNode("settingsUpdateHeader")
    m.settingsUpdateCurrentLabel = m.top.findNode("settingsUpdateCurrentLabel")
    m.settingsUpdateCurrentValue = m.top.findNode("settingsUpdateCurrentValue")
    m.settingsUpdateLatestLabel = m.top.findNode("settingsUpdateLatestLabel")
    m.settingsUpdateLatestValue = m.top.findNode("settingsUpdateLatestValue")
    m.settingsUpdateCheckedLabel = m.top.findNode("settingsUpdateCheckedLabel")
    m.settingsUpdateCheckedValue = m.top.findNode("settingsUpdateCheckedValue")
    m.settingsUpdateMessage = m.top.findNode("settingsUpdateMessage")
    m.checkUpdateButton = m.top.findNode("checkUpdateButton")
    m.installUpdateButton = m.top.findNode("installUpdateButton")
    m.updateStatus = invalid

    ' Live TV (What's on TV) — settings row + dedicated picker view.
    m.settingsLiveTvValue = m.top.findNode("settingsLiveTvValue")
    m.configureChannelsButton = m.top.findNode("configureChannelsButton")
    m.liveTvView = m.top.findNode("liveTvView")
    m.liveTvViewStatus = m.top.findNode("liveTvViewStatus")
    m.channelList = m.top.findNode("channelList")
    m.liveTvAvailable = invalid
    m.liveTvChannelsTask = invalid
    m.liveNowTask = invalid
    m.liveLaterTask = invalid

    m.userPickerView = m.top.findNode("userPickerView")
    m.userPickerStatus = m.top.findNode("userPickerStatus")
    m.userList = m.top.findNode("userList")
    m.usersData = invalid          ' cached /api/users response
    m.initialFetchDone = false     ' have we kicked off /api/home yet?

    ' Pair view nodes — populated by startPair() / poll handlers.
    m.pairView = m.top.findNode("pairView")
    m.pairCode = m.top.findNode("pairCode")
    m.pairStatus = m.top.findNode("pairStatus")
    m.pairSubtitle = m.top.findNode("pairSubtitle")
    m.pairPollTimer = invalid
    m.pairStartTask = invalid
    m.pairPollTask = invalid

    ' Library state: per-type cache so toggling between TV Shows and
    ' Movies after both have loaded is instant. Default type matches
    ' the mobile library tab default ("show").
    m.libraryType = "show"
    m.libraryCache = { show: invalid, movie: invalid }
    m.libraryFetchPending = 0
    m.libraryFetchResults = invalid

    ' TV Shows / Movies tab state. Each tab fetches four (TV) or three
    ' (Movies) endpoints in parallel on first visit, then renders from
    ' cache until invalidated. Mirrors mobile (tabs)/tv.tsx + movies.tsx.
    m.tvCache = invalid
    m.tvFetchPending = 0
    m.tvFetchData = invalid
    m.moviesCache = invalid
    m.moviesFetchPending = 0
    m.moviesFetchData = invalid

    ' Search tab state. Single in-flight task per query so we can drop
    ' results from a stale request if the user changed the filter mid-fetch.
    m.searchQuery = ""
    m.searchFilter = "all"        ' "all" | "tv" | "movie"
    m.searchMode = "library"      ' "library" | "discover"
    m.searchTask = invalid
    m.searchDialog = invalid
    m.searchResults = invalid     ' last successful results, used on detail return

    ' Sports tab state. Three endpoints fetched in parallel on first
    ' visit (now / later / prefs). prefs drives the empty-state copy:
    ' "no teams followed" vs "nothing on right now" — matches mobile.
    m.sportsCache = invalid
    m.sportsFetchPending = 0
    m.sportsFetchData = invalid

    m.currentView = "home"
    m.selectedItem = invalid
    m.playbackInfo = invalid
    m.lastReportedPositionTime = 0

    ' In-player Quality picker presets. Mirrors mobile's bitrate
    ' ladder; values are kbps and pass straight to the backend's
    ' /api/playback ?maxBitrate=<kbps> param. The * (Options) button
    ' on the remote opens the picker mid-playback.
    m.qualityPresets = [
        { label: "Original (20 Mbps)", maxBitrate: 20000 },
        { label: "12 Mbps 1080p", maxBitrate: 12000 },
        { label: "8 Mbps 1080p", maxBitrate: 8000 },
        { label: "4 Mbps 720p", maxBitrate: 4000 },
        { label: "3 Mbps 720p", maxBitrate: 3000 },
        { label: "2 Mbps 720p", maxBitrate: 2000 },
        { label: "1.5 Mbps 480p", maxBitrate: 1500 },
        { label: "720 kbps SD", maxBitrate: 720 }
    ]
    m.qualityDialog = invalid
    m.qualitySwapResumeMs = invalid

    ' Set true while a quality / track swap is mid-flight so the
    ' Video.state="stopped" observer doesn't bounce the user back to
    ' the detail view. Cleared once the new playback request returns.
    m.swapping = false

    ' Tracks picker (Audio + Subtitle), opened by the Down key in the
    ' player view. Custom multi-select overlay — user can change audio
    ' and subtitle without dismissing, presses Close to commit both as
    ' a single re-issue. m.currentXxxId is the player's actual stream;
    ' m.pendingXxxId is what the user has clicked in the open dialog.
    m.tracksOpen = false
    m.currentAudioId = -1
    m.pendingAudioId = -1
    m.currentSubtitleId = 0
    m.pendingSubtitleId = 0

    ' Skip Intro / Skip Credits state. m.activeMarker is set when
    ' Video.position enters a Plex marker range; Back dismisses the
    ' button for the remainder of that marker via dismissedUntilMs.
    m.activeMarker = invalid
    m.dismissedUntilMs = invalid
    ' Track the view we'd return to from detail so Back works whether
    ' the user reached detail from the home shelves or the library grid.
    m.detailReturnTo = "home"

    ' SceneGraph quirk: setFocus called in the same frame as a visibility
    ' toggle silently drops because the target node is still mid-rerender.
    ' We trigger focus from a Timer instead, giving the Scene one tick to
    ' apply the new visibility.
    m.focusTimer = CreateObject("roSGNode", "Timer")
    m.focusTimer.duration = 0.05
    m.focusTimer.repeat = false
    m.focusTimer.observeField("fire", "applyDeferredFocus")

    ' Real-time clock — ticks every 30 seconds (the display only shows
    ' minutes, so per-second updates would just burn cycles). updateClock
    ' is also called once now so the label isn't blank on first paint.
    m.clockTimer = CreateObject("roSGNode", "Timer")
    m.clockTimer.duration = 30
    m.clockTimer.repeat = true
    m.clockTimer.observeField("fire", "onClockTick")
    m.clockTimer.control = "start"
    updateClock()


    ' Resolve apiUrl. Three sources, in order:
    '   1. Field on the scene (set by main.brs from the registry).
    '   2. Registry directly — fallback because Scene init() runs inside
    '      CreateScene() before main.brs gets to assign the field.
    '   3. Build-time Config.brs::configApiUrl(), regenerated on every
    '      deploy from the ROKU_API_URL env var. Survives reinstalls and
    '      reboots since it ships inside the channel zip.
    apiUrl = m.top.apiUrl
    if apiUrl = invalid or apiUrl = ""
        section = CreateObject("roRegistrySection", "whatson")
        if section <> invalid and section.Exists("apiUrl")
            apiUrl = section.Read("apiUrl")
        end if
    end if
    if apiUrl = invalid or apiUrl = ""
        apiUrl = configApiUrl()
    end if
    apiUrl = normalizeApiUrl(apiUrl)
    print "[HomeScene] apiUrl resolved to: "; apiUrl

    if apiUrl = invalid or apiUrl = ""
        m.status.text = "API URL not configured. Set the 'apiUrl' value in registry section 'whatson' (see apps/roku/README.md)."
        return
    end if

    m.apiUrl = apiUrl

    ' Resolve Plex user id similarly: registry first, build-time config
    ' fallback. If neither has it, we'll show the user picker and stay
    ' on it until the user makes a selection (mobile's select-user.tsx
    ' flow).
    userId = ""
    section2 = CreateObject("roRegistrySection", "whatson")
    if section2 <> invalid and section2.Exists("plexUserId")
        userId = section2.Read("plexUserId")
    end if
    if userId = "" then userId = configPlexUserId()
    m.userId = userId
    print "[HomeScene] plexUserId resolved to: "; userId

    ' Connection type ("local" | "remote") — sent as X-Plex-Connection
    ' on every API request so the backend picks the right Plex link
    ' for the network this device is on. Default to "local" since the
    ' Roku is almost always on the same LAN as the Plex server.
    connType = ""
    if section2 <> invalid and section2.Exists("connectionType")
        connType = section2.Read("connectionType")
    end if
    if connType = "" then connType = "local"
    m.connectionType = connType
    print "[HomeScene] connectionType resolved to: "; connType

    ' Per-device auth key — populated by the first-run pair flow and
    ' sent as X-Whatson-Auth on every backend call when set. When the
    ' backend has no admin password configured, the middleware ignores
    ' the header entirely, so unset is fine for that case.
    '
    ' Roku's dev channel install ("Replace") wipes the registry section
    ' on every redeploy. Registry is still source-of-truth on a
    ' production install, but for dev we also fall back to the
    ' build-time configAuthKey() — set ROKU_AUTH_KEY before deploying
    ' to bake the key into Config.brs and skip the pair view across
    ' deploys.
    authKey = ""
    keyExists = false
    keySource = "(none)"
    if section2 <> invalid
        keyExists = section2.Exists("authKey")
        if keyExists
            authKey = section2.Read("authKey")
            keySource = "registry"
        end if
    end if
    if authKey = ""
        baked = configAuthKey()
        if baked <> "" then
            authKey = baked
            keySource = "config"
        end if
    end if
    m.authKey = authKey
    keyHead = ""
    if Len(authKey) >= 8 then keyHead = Left(authKey, 8) else keyHead = authKey
    print "[HomeScene] authKey: source="; keySource; " len="; Len(authKey); " head="; keyHead

    ' Live TV channels — comma-separated TVmaze network names. Empty
    ' by default; user picks them in Settings → Configure Channels.
    ' When non-empty, Home fires extra /api/live/now and /api/live/later
    ' fetches alongside the standard home + sports payloads.
    liveCsv = ""
    if section2 <> invalid and section2.Exists("liveTvChannels")
        liveCsv = section2.Read("liveTvChannels")
    end if
    m.liveTvChannels = []
    if liveCsv <> invalid and liveCsv <> ""
        parts = liveCsv.Split(",")
        for each p in parts
            t = trimString(p)
            if t <> "" then m.liveTvChannels.push(t)
        end for
    end if
    print "[HomeScene] liveTvChannels count="; m.liveTvChannels.Count()

    ' Wire row-list selection + button presses.
    m.rowList.observeField("rowItemSelected", "onRowItemSelected")
    m.tvRowList.observeField("rowItemSelected", "onTvRowItemSelected")
    m.moviesRowList.observeField("rowItemSelected", "onMoviesRowItemSelected")
    m.detailActions.observeField("buttonSelected", "onDetailButtonSelected")
    m.tabBar.observeField("buttonSelected", "onTabSelected")
    m.libraryTypeToggle.observeField("buttonSelected", "onLibraryTypeSelected")
    m.libraryGrid.observeField("itemSelected", "onLibraryItemSelected")
    m.searchInputButton.observeField("buttonSelected", "onSearchInputPressed")
    m.searchModeToggle.observeField("buttonSelected", "onSearchModeSelected")
    m.searchFilterToggle.observeField("buttonSelected", "onSearchFilterSelected")
    m.searchResultsGrid.observeField("itemSelected", "onSearchItemSelected")
    m.sportsRowList.observeField("rowItemSelected", "onSportsRowItemSelected")
    m.switchUserButton.observeField("buttonSelected", "onSwitchUserPressed")
    m.editApiUrlButton.observeField("buttonSelected", "onEditApiUrlPressed")
    m.connectionToggle.observeField("buttonSelected", "onConnectionTypeSelected")
    m.checkUpdateButton.observeField("buttonSelected", "onCheckUpdatePressed")
    m.installUpdateButton.observeField("buttonSelected", "onInstallUpdatePressed")
    m.configureChannelsButton.observeField("buttonSelected", "onConfigureChannelsPressed")
    m.channelList.observeField("itemSelected", "onChannelToggled")
    m.userList.observeField("itemSelected", "onUserPicked")
    m.video.observeField("state", "onVideoStateChanged")
    m.video.observeField("position", "onVideoPosition")
    m.skipButton.observeField("buttonSelected", "onSkipPressed")
    m.tracksAudioList.observeField("itemSelected", "onTracksAudioItemSelected")
    m.tracksSubtitleList.observeField("itemSelected", "onTracksSubtitleItemSelected")
    m.tracksCloseButton.observeField("buttonSelected", "onTracksClosePressed")

    ' D-pad navigation between tab bar and content is handled in
    ' onKeyEvent(). RowList / MarkupGrid / ButtonGroup don't honour
    ' the inherited nextFocusUp / nextFocusDown fields (Roku logs
    ' "nonexistent field" when you try to set them on these node
    ' types), so we route key events ourselves.

    ' Boot routing — match mobile's flow:
    '   apiUrl missing       → "API URL not configured" (existing branch above)
    '   admin password set + no authKey → pair view (NEW)
    '   plexUserId missing   → user picker scene (matches select-user.tsx)
    '   all set              → kick off home + sports fetches
    '
    ' admin-status is an open endpoint, so we can hit it before the
    ' rest of the API is unlocked. The result tells us whether to
    ' enter the pair flow or carry on as before.
    checkAdminStatus()
end sub

' Hits /api/auth/admin-status (open endpoint). The response decides
' whether boot continues straight to user picker / fetches OR detours
' through the pair view.
sub checkAdminStatus()
    task = CreateObject("roSGNode", "ApiTask")
    task.observeField("response", "onAdminStatusResponse")
    task.method = "GET"
    task.url = m.apiUrl + "/api/auth/admin-status"
    ' No setApiTaskAuth — it's an open endpoint and we don't have the
    ' key resolved yet on first run anyway.
    task.control = "RUN"
    m.adminStatusTask = task
end sub

sub onAdminStatusResponse()
    if m.adminStatusTask = invalid then return
    resp = m.adminStatusTask.response
    m.adminStatusTask = invalid

    hasAdminPassword = false
    if resp <> invalid and resp.success = true and resp.data <> invalid
        hasAdminPassword = (resp.data.hasAdminPassword = true)
    end if

    if hasAdminPassword and (m.authKey = invalid or m.authKey = "")
        ' Need to pair before doing anything else.
        showView("pair")
        startPair()
        return
    end if

    ' Either the backend has no admin password (open mode), or this
    ' device already holds an auth key from a previous pair. Carry on.
    if m.userId = invalid or m.userId = ""
        showView("userPicker")
        fetchUsers()
    else
        startInitialFetches()
    end if
end sub

' Fire /api/home + /api/sports/{now,later} (+ /api/live/{now,later} when
' the user has live channels selected) in parallel — mobile does the
' same on Home tab so sports/live shelves appear when configured. We
' wait for everything to finish before building the row list so the
' shelf order is stable: home sections, sports, live TV.
sub startInitialFetches()
    if m.initialFetchDone then return
    m.initialFetchDone = true
    fetchHomeShelves()
end sub

sub fetchHomeShelves()
    hasLive = (m.liveTvChannels <> invalid and m.liveTvChannels.Count() > 0)
    pending = 3
    if hasLive then pending = pending + 2
    m.homeFetchPending = pending
    m.homeData = { sections: invalid, sportsNow: invalid, sportsLater: invalid, liveNow: invalid, liveLater: invalid }
    print "[HomeScene] fetchHomeShelves pending="; pending; " hasLive="; hasLive

    m.task = CreateObject("roSGNode", "ApiTask")
    m.task.observeField("response", "onHomeResponse")
    m.task.method = "GET"
    m.task.url = m.apiUrl + "/api/home"
    setApiTaskAuth(m.task)
    m.task.control = "RUN"

    m.sportsNowTask = CreateObject("roSGNode", "ApiTask")
    m.sportsNowTask.observeField("response", "onSportsNowResponse")
    m.sportsNowTask.method = "GET"
    m.sportsNowTask.url = m.apiUrl + "/api/sports/now"
    setApiTaskAuth(m.sportsNowTask)
    m.sportsNowTask.control = "RUN"

    m.sportsLaterTask = CreateObject("roSGNode", "ApiTask")
    m.sportsLaterTask.observeField("response", "onSportsLaterResponse")
    m.sportsLaterTask.method = "GET"
    m.sportsLaterTask.url = m.apiUrl + "/api/sports/later"
    setApiTaskAuth(m.sportsLaterTask)
    m.sportsLaterTask.control = "RUN"

    if hasLive
        encChannels = urlEncodeQuery(joinStrings(m.liveTvChannels, ","))

        m.liveNowTask = CreateObject("roSGNode", "ApiTask")
        m.liveNowTask.observeField("response", "onLiveNowResponse")
        m.liveNowTask.method = "GET"
        m.liveNowTask.url = m.apiUrl + "/api/live/now?channels=" + encChannels
        setApiTaskAuth(m.liveNowTask)
        m.liveNowTask.control = "RUN"

        m.liveLaterTask = CreateObject("roSGNode", "ApiTask")
        m.liveLaterTask.observeField("response", "onLiveLaterResponse")
        m.liveLaterTask.method = "GET"
        m.liveLaterTask.url = m.apiUrl + "/api/live/later?channels=" + encChannels + "&hours=6"
        setApiTaskAuth(m.liveLaterTask)
        m.liveLaterTask.control = "RUN"
    end if
end sub

' ─── Home view ─────────────────────────────────────────────────────

sub onHomeResponse()
    response = m.task.response
    if response = invalid or response.success <> true
        errMsg = "No response from API"
        if response <> invalid and response.error <> invalid then errMsg = response.error
        m.status.text = errMsg
    else if response.data <> invalid and response.data.sections <> invalid
        m.homeData.sections = response.data.sections
    end if
    onHomeFetchComplete()
end sub

sub onSportsNowResponse()
    response = m.sportsNowTask.response
    if response <> invalid and response.success = true and response.data <> invalid
        m.homeData.sportsNow = response.data
    end if
    onHomeFetchComplete()
end sub

sub onSportsLaterResponse()
    response = m.sportsLaterTask.response
    if response <> invalid and response.success = true and response.data <> invalid
        m.homeData.sportsLater = response.data
    end if
    onHomeFetchComplete()
end sub

sub onLiveNowResponse()
    if m.liveNowTask = invalid then return
    response = m.liveNowTask.response
    if response <> invalid and response.success = true and response.data <> invalid
        m.homeData.liveNow = response.data
    end if
    onHomeFetchComplete()
end sub

sub onLiveLaterResponse()
    if m.liveLaterTask = invalid then return
    response = m.liveLaterTask.response
    if response <> invalid and response.success = true and response.data <> invalid
        m.homeData.liveLater = response.data
    end if
    onHomeFetchComplete()
end sub

sub onHomeFetchComplete()
    m.homeFetchPending = m.homeFetchPending - 1
    if m.homeFetchPending > 0 then return
    buildHomeRows()
end sub

sub buildHomeRows()
    sections = m.homeData.sections
    sportsNow = m.homeData.sportsNow
    sportsLater = m.homeData.sportsLater

    sectionCount = 0
    if sections <> invalid then sectionCount = sections.Count()
    nowCount = 0
    if sportsNow <> invalid then nowCount = sportsNow.Count()
    laterCount = 0
    if sportsLater <> invalid then laterCount = sportsLater.Count()
    liveNowPrecount = 0
    if m.homeData.liveNow <> invalid then liveNowPrecount = m.homeData.liveNow.Count()
    liveLaterPrecount = 0
    if m.homeData.liveLater <> invalid then liveLaterPrecount = m.homeData.liveLater.Count()

    print "[HomeScene] home shelves — sections="; sectionCount; " sportsNow="; nowCount; " sportsLater="; laterCount

    if sectionCount = 0 and nowCount = 0 and laterCount = 0 and liveNowPrecount = 0 and liveLaterPrecount = 0
        m.status.text = "Home is empty. Make sure your media servers are configured."
        return
    end if

    rows = CreateObject("roSGNode", "ContentNode")

    ' Standard /api/home shelves first.
    if sections <> invalid
        for each section in sections
            row = rows.createChild("ContentNode")
            row.title = section.title
            if section.items <> invalid
                for each item in section.items
                    child = row.createChild("ContentNode")
                    child.title = itemDisplayTitle(item)
                    child.description = itemDescription(item)
                    posterUrl = resolvePosterUrl(item)
                    if posterUrl <> ""
                        child.HDPosterUrl = posterUrl
                        child.SDPosterUrl = posterUrl
                    end if
                    attachItemFields(child, item)
                end for
            end if
        end for
    end if

    ' Sports shelves below — only when there's content. Mirrors mobile.
    if nowCount > 0
        row = rows.createChild("ContentNode")
        row.title = "Sports On Now"
        for each ev in sportsNow
            buildSportsChild(row, ev)
        end for
    end if
    if laterCount > 0
        row = rows.createChild("ContentNode")
        row.title = "Sports On Later"
        for each ev in sportsLater
            buildSportsChild(row, ev)
        end for
    end if

    ' Live TV shelves last — only when the user has channels selected
    ' AND the backend returned items for those channels in the current
    ' time window. Mirrors mobile (tabs)/index.tsx liveSections order.
    liveNow = m.homeData.liveNow
    liveLater = m.homeData.liveLater
    liveNowCount = 0
    if liveNow <> invalid then liveNowCount = liveNow.Count()
    liveLaterCount = 0
    if liveLater <> invalid then liveLaterCount = liveLater.Count()
    print "[HomeScene] live shelves — now="; liveNowCount; " later="; liveLaterCount
    if liveNowCount > 0
        row = rows.createChild("ContentNode")
        row.title = "What's on TV"
        for each item in liveNow
            child = row.createChild("ContentNode")
            child.title = itemDisplayTitle(item)
            child.description = itemDescription(item)
            posterUrl = resolvePosterUrl(item)
            if posterUrl <> ""
                child.HDPosterUrl = posterUrl
                child.SDPosterUrl = posterUrl
            end if
            attachItemFields(child, item)
        end for
    end if
    if liveLaterCount > 0
        row = rows.createChild("ContentNode")
        row.title = "What's on TV Later"
        for each item in liveLater
            child = row.createChild("ContentNode")
            child.title = itemDisplayTitle(item)
            child.description = itemDescription(item)
            posterUrl = resolvePosterUrl(item)
            if posterUrl <> ""
                child.HDPosterUrl = posterUrl
                child.SDPosterUrl = posterUrl
            end if
            attachItemFields(child, item)
        end for
    end if

    m.rowList.content = rows
    m.rowList.visible = true
    m.status.visible = false
    m.rowList.setFocus(true)
end sub

' Sports cards reuse the RowList default poster + label. Phase 1.6 will
' replace this with a custom SportsCard component (team logos + score
' + LIVE pill / broadcast pill) to match the mobile SportsCard. For
' now the home (or first) team's logo is the poster image.
sub buildSportsChild(row as object, ev as object)
    child = row.createChild("ContentNode")
    child.title = stringField(ev, "title")
    posterUrl = pickSportsLogo(ev)
    if posterUrl <> ""
        child.HDPosterUrl = posterUrl
        child.SDPosterUrl = posterUrl
    end if

    child.AddField("itemSource", "string", false)
    child.AddField("itemSourceId", "string", false)
    child.AddField("itemTitle", "string", false)
    child.AddField("itemShowTitle", "string", false)
    child.AddField("itemSummary", "string", false)
    child.AddField("itemYear", "string", false)
    child.AddField("itemDuration", "string", false)
    child.AddField("itemBackdropUrl", "string", false)
    child.AddField("itemType", "string", false)
    child.AddField("itemWatched", "boolean", false)
    child.itemSource = "sports"
    child.itemSourceId = stringField(ev, "id")
    child.itemTitle = stringField(ev, "title")
    child.itemSummary = stringField(ev, "statusDetail")
    child.itemType = "sports"
    child.itemWatched = false
end sub

' Pick the home team's logo (or first competitor with one) as the
' poster — matches mobile SportsCard's "primary team" fallback when
' the user follows neither side.
function pickSportsLogo(ev as object) as string
    if ev.competitors = invalid then return ""
    homeLogo = ""
    fallback = ""
    for each c in ev.competitors
        if c.logo <> invalid and c.logo <> ""
            if c.homeAway = "home" then homeLogo = c.logo
            if fallback = "" then fallback = c.logo
        end if
    end for
    if homeLogo <> "" then return homeLogo
    return fallback
end function

' ─── Navigation ────────────────────────────────────────────────────

sub onRowItemSelected()
    sel = m.rowList.rowItemSelected
    if sel = invalid or sel.Count() < 2 then return
    rowIdx = sel[0]
    colIdx = sel[1]
    rows = m.rowList.content
    if rows = invalid then return
    row = rows.getChild(rowIdx)
    if row = invalid then return
    node = row.getChild(colIdx)
    if node = invalid then return

    m.detailReturnTo = "home"
    populateDetail(node)
    showView("detail")
end sub

sub onTabSelected()
    idx = m.tabBar.buttonSelected
    print "[HomeScene] tab selected: "; idx
    ' Indices match XML order: 0=Home, 1=TV, 2=Movies, 3=Sports,
    ' 4=Library, 5=Search, 6=Settings.
    if idx = 0
        showView("home")
    else if idx = 1
        showView("tv")
    else if idx = 2
        showView("movies")
    else if idx = 3
        showView("sports")
    else if idx = 4
        showView("library")
    else if idx = 5
        showView("search")
    else if idx = 6
        showView("settings")
    end if
end sub

sub onLibraryItemSelected()
    idx = m.libraryGrid.itemSelected
    rootNode = m.libraryGrid.content
    if rootNode = invalid then return
    node = rootNode.getChild(idx)
    if node = invalid then return

    m.detailReturnTo = "library"
    populateDetail(node)
    showView("detail")
end sub

' Lazy load on first visit, then served from cache for the session.
sub ensureLibraryLoaded()
    if m.libraryCache[m.libraryType] <> invalid
        renderLibrary(m.libraryCache[m.libraryType])
        return
    end if
    ' Fetch already in flight — bail.
    if m.libraryFetchPending > 0 then return
    fetchLibraryAllSources(m.libraryType)
end sub

sub onLibraryTypeSelected()
    idx = m.libraryTypeToggle.buttonSelected
    newType = "show"
    if idx = 1 then newType = "movie"
    if newType = m.libraryType then return
    m.libraryType = newType
    print "[HomeScene] library type -> "; newType
    ensureLibraryLoaded()
end sub

' Fan out to every library-server source in parallel, mirroring how the
' mobile Library tab's `librarySources.map(...)` union works. We don't
' know which servers are configured, so we ask all three — unconfigured
' sources return 400 from the backend and we just drop them.
' `type` would shadow BrightScript's built-in Type() function — use mediaType.
sub fetchLibraryAllSources(mediaType as string)
    print "[HomeScene] library fetching all sources for type="; mediaType
    m.libraryStatus.text = "Loading library…"
    m.libraryStatus.visible = true
    m.libraryGrid.visible = false

    m.libraryFetchType = mediaType
    m.libraryFetchPending = 3
    m.libraryFetchResults = []

    sources = ["plex", "jellyfin", "emby"]
    for each src in sources
        task = CreateObject("roSGNode", "ApiTask")
        task.observeField("response", "onLibrarySourceResponse")
        task.method = "GET"
        task.url = m.apiUrl + "/api/library/" + mediaType + "?source=" + src
        setApiTaskAuth(task)
        task.control = "RUN"
    end for
end sub

sub onLibrarySourceResponse(event as object)
    task = event.GetRoSGNode()
    response = task.response

    if response <> invalid and response.success = true and response.data <> invalid
        for each item in response.data
            m.libraryFetchResults.Push(item)
        end for
    end if

    m.libraryFetchPending = m.libraryFetchPending - 1
    if m.libraryFetchPending > 0 then return

    ' All sources have replied — render and cache.
    m.libraryCache[m.libraryFetchType] = m.libraryFetchResults
    if m.libraryType = m.libraryFetchType then renderLibrary(m.libraryFetchResults)
end sub

sub renderLibrary(items as object)
    print "[HomeScene] library union: "; items.Count(); " items"

    if items.Count() = 0
        m.libraryStatus.text = "No items in your library."
        m.libraryStatus.visible = true
        m.libraryGrid.visible = false
        return
    end if

    ' Sort alphabetically by display title (showTitle for episodes,
    ' falling back to title) — matches the mobile library default sort.
    sortable = []
    for each it in items
        title = ""
        if it.showTitle <> invalid and it.showTitle <> "" then title = it.showTitle
        if title = "" and it.title <> invalid then title = it.title
        sortable.Push({ sortKey: lcase(title), data: it })
    end for
    sortable.SortBy("sortKey")

    rootNode = CreateObject("roSGNode", "ContentNode")
    for each entry in sortable
        item = entry.data
        child = rootNode.createChild("ContentNode")
        child.title = itemDisplayTitle(item)
        posterUrl = resolvePosterUrl(item)
        if posterUrl <> ""
            child.HDPosterUrl = posterUrl
            child.SDPosterUrl = posterUrl
        end if
        attachItemFields(child, item)
    end for

    m.libraryGrid.content = rootNode
    m.libraryGrid.visible = true
    m.libraryStatus.visible = false
    if m.currentView = "library" then m.libraryGrid.setFocus(true)
end sub

' ─── TV Shows tab ─────────────────────────────────────────────────
'
' Mirrors mobile (tabs)/tv.tsx — four shelves in this order:
'   1. Downloading        (/api/tv/downloading)
'   2. Ready to Watch     (/api/tv/recent, watched filtered out)
'   3. Coming Soon        (/api/tv/upcoming?days=7)
'   4. Tracked            (/api/tracked?all=true&type=tv)
' All four endpoints fire in parallel, build runs once they're all in.

sub ensureTvLoaded()
    if m.tvCache <> invalid
        buildTvRows()
        return
    end if
    if m.tvFetchPending > 0 then return
    fetchTvAll()
end sub

sub fetchTvAll()
    print "[HomeScene] fetching TV tab data"
    m.tvStatus.text = "Loading TV…"
    m.tvStatus.visible = true
    m.tvRowList.visible = false
    m.tvFetchPending = 4
    m.tvFetchData = { downloading: invalid, recent: invalid, upcoming: invalid, tracked: invalid }

    m.tvDownloadingTask = startTvFetch("/api/tv/downloading", "onTvFetchResponse")
    m.tvRecentTask = startTvFetch("/api/tv/recent", "onTvFetchResponse")
    m.tvUpcomingTask = startTvFetch("/api/tv/upcoming?days=7", "onTvFetchResponse")
    m.tvTrackedTask = startTvFetch("/api/tracked?all=true&type=tv", "onTvFetchResponse")
end sub

function startTvFetch(path as string, handler as string) as object
    task = CreateObject("roSGNode", "ApiTask")
    task.observeField("response", handler)
    task.method = "GET"
    task.url = m.apiUrl + path
    setApiTaskAuth(task)
    task.control = "RUN"
    return task
end function

sub onTvFetchResponse(event as object)
    task = event.GetRoSGNode()
    response = task.response
    data = invalid
    if response <> invalid and response.success = true and response.data <> invalid
        data = response.data
    end if

    ' Identify which endpoint replied via URL (unique per task) so we
    ' don't depend on roSGNode object-identity semantics.
    url = task.url
    if url = m.tvDownloadingTask.url then m.tvFetchData.downloading = data
    if url = m.tvRecentTask.url then m.tvFetchData.recent = data
    if url = m.tvUpcomingTask.url then m.tvFetchData.upcoming = data
    if url = m.tvTrackedTask.url then m.tvFetchData.tracked = data

    m.tvFetchPending = m.tvFetchPending - 1
    if m.tvFetchPending > 0 then return

    m.tvCache = m.tvFetchData
    if m.currentView = "tv" then buildTvRows()
end sub

sub buildTvRows()
    if m.tvCache = invalid then return

    ' Filter Ready to Watch to unwatched only — mirrors mobile's
    '   recent?.filter((i) => !i.progress.watched)
    readyItems = []
    if m.tvCache.recent <> invalid
        for each item in m.tvCache.recent
            watched = false
            if item.progress <> invalid and item.progress.watched <> invalid then watched = item.progress.watched
            if not watched then readyItems.Push(item)
        end for
    end if

    rows = CreateObject("roSGNode", "ContentNode")
    appendShelfIfNonEmpty(rows, "Downloading", m.tvCache.downloading, false)
    appendShelfIfNonEmpty(rows, "Ready to Watch", readyItems, false)
    appendShelfIfNonEmpty(rows, "Coming Soon", m.tvCache.upcoming, false)
    appendShelfIfNonEmpty(rows, "Tracked", m.tvCache.tracked, true)

    if rows.getChildCount() = 0
        m.tvStatus.text = "No TV shows to display."
        m.tvStatus.visible = true
        m.tvRowList.visible = false
        return
    end if

    m.tvRowList.content = rows
    m.tvRowList.visible = true
    m.tvStatus.visible = false
    if m.currentView = "tv" then m.tvRowList.setFocus(true)
end sub

sub onTvRowItemSelected()
    sel = m.tvRowList.rowItemSelected
    if sel = invalid or sel.Count() < 2 then return
    rows = m.tvRowList.content
    if rows = invalid then return
    row = rows.getChild(sel[0])
    if row = invalid then return
    node = row.getChild(sel[1])
    if node = invalid then return

    m.detailReturnTo = "tv"
    populateDetail(node)
    showView("detail")
end sub

' ─── Movies tab ───────────────────────────────────────────────────
'
' Mirrors mobile (tabs)/movies.tsx — three shelves:
'   1. Downloading      (/api/movies/downloading)
'   2. Ready to Watch   (/api/movies/recent, watched filtered out)
'   3. Coming Soon      (/api/movies/upcoming?days=30)

sub ensureMoviesLoaded()
    if m.moviesCache <> invalid
        buildMoviesRows()
        return
    end if
    if m.moviesFetchPending > 0 then return
    fetchMoviesAll()
end sub

sub fetchMoviesAll()
    print "[HomeScene] fetching Movies tab data"
    m.moviesStatus.text = "Loading movies…"
    m.moviesStatus.visible = true
    m.moviesRowList.visible = false
    m.moviesFetchPending = 3
    m.moviesFetchData = { downloading: invalid, recent: invalid, upcoming: invalid }

    m.moviesDownloadingTask = startMoviesFetch("/api/movies/downloading")
    m.moviesRecentTask = startMoviesFetch("/api/movies/recent")
    m.moviesUpcomingTask = startMoviesFetch("/api/movies/upcoming?days=30")
end sub

function startMoviesFetch(path as string) as object
    task = CreateObject("roSGNode", "ApiTask")
    task.observeField("response", "onMoviesFetchResponse")
    task.method = "GET"
    task.url = m.apiUrl + path
    setApiTaskAuth(task)
    task.control = "RUN"
    return task
end function

sub onMoviesFetchResponse(event as object)
    task = event.GetRoSGNode()
    response = task.response
    data = invalid
    if response <> invalid and response.success = true and response.data <> invalid
        data = response.data
    end if

    url = task.url
    if url = m.moviesDownloadingTask.url then m.moviesFetchData.downloading = data
    if url = m.moviesRecentTask.url then m.moviesFetchData.recent = data
    if url = m.moviesUpcomingTask.url then m.moviesFetchData.upcoming = data

    m.moviesFetchPending = m.moviesFetchPending - 1
    if m.moviesFetchPending > 0 then return

    m.moviesCache = m.moviesFetchData
    if m.currentView = "movies" then buildMoviesRows()
end sub

sub buildMoviesRows()
    if m.moviesCache = invalid then return

    readyItems = []
    if m.moviesCache.recent <> invalid
        for each item in m.moviesCache.recent
            watched = false
            if item.progress <> invalid and item.progress.watched <> invalid then watched = item.progress.watched
            if not watched then readyItems.Push(item)
        end for
    end if

    rows = CreateObject("roSGNode", "ContentNode")
    appendShelfIfNonEmpty(rows, "Downloading", m.moviesCache.downloading, false)
    appendShelfIfNonEmpty(rows, "Ready to Watch", readyItems, false)
    appendShelfIfNonEmpty(rows, "Coming Soon", m.moviesCache.upcoming, false)

    if rows.getChildCount() = 0
        m.moviesStatus.text = "No movies to display."
        m.moviesStatus.visible = true
        m.moviesRowList.visible = false
        return
    end if

    m.moviesRowList.content = rows
    m.moviesRowList.visible = true
    m.moviesStatus.visible = false
    if m.currentView = "movies" then m.moviesRowList.setFocus(true)
end sub

sub onMoviesRowItemSelected()
    sel = m.moviesRowList.rowItemSelected
    if sel = invalid or sel.Count() < 2 then return
    rows = m.moviesRowList.content
    if rows = invalid then return
    row = rows.getChild(sel[0])
    if row = invalid then return
    node = row.getChild(sel[1])
    if node = invalid then return

    m.detailReturnTo = "movies"
    populateDetail(node)
    showView("detail")
end sub

' ─── Sports tab ───────────────────────────────────────────────────
'
' Mirrors mobile (tabs)/sports.tsx — two horizontal SportsCard shelves
' ("Sports On Now" + "Sports On Later"). Three endpoints fire in
' parallel on first visit:
'   /api/sports/now             (live games, polled every 30s on mobile)
'   /api/sports/later?hours=168 (next 7 days)
'   /api/sports/prefs           (drives empty-state copy)
' First-visit-only fetch is OK for v1 — sports auto-refresh polling
' is a follow-up. Home tab still shows its own simpler sports shelves.

sub ensureSportsLoaded()
    if m.sportsCache <> invalid
        buildSportsTabRows()
        return
    end if
    if m.sportsFetchPending > 0 then return
    fetchSportsTabAll()
end sub

sub fetchSportsTabAll()
    print "[HomeScene] fetching Sports tab data"
    m.sportsStatus.text = "Loading sports…"
    m.sportsStatus.visible = true
    m.sportsRowList.visible = false
    m.sportsFetchPending = 3
    m.sportsFetchData = { now: invalid, later: invalid, prefs: invalid }

    m.sportsTabNowTask = startSportsTabFetch("/api/sports/now")
    m.sportsTabLaterTask = startSportsTabFetch("/api/sports/later?hours=168")
    m.sportsTabPrefsTask = startSportsTabFetch("/api/sports/prefs")
end sub

function startSportsTabFetch(path as string) as object
    task = CreateObject("roSGNode", "ApiTask")
    task.observeField("response", "onSportsTabFetchResponse")
    task.method = "GET"
    task.url = m.apiUrl + path
    setApiTaskAuth(task)
    task.control = "RUN"
    return task
end function

sub onSportsTabFetchResponse(event as object)
    task = event.GetRoSGNode()
    response = task.response
    data = invalid
    if response <> invalid and response.success = true and response.data <> invalid
        data = response.data
    end if

    url = task.url
    if url = m.sportsTabNowTask.url then m.sportsFetchData.now = data
    if url = m.sportsTabLaterTask.url then m.sportsFetchData.later = data
    if url = m.sportsTabPrefsTask.url then m.sportsFetchData.prefs = data

    m.sportsFetchPending = m.sportsFetchPending - 1
    if m.sportsFetchPending > 0 then return

    m.sportsCache = m.sportsFetchData
    if m.currentView = "sports" then buildSportsTabRows()
end sub

sub buildSportsTabRows()
    if m.sportsCache = invalid then return

    nowEvents = m.sportsCache.now
    laterEvents = m.sportsCache.later
    prefs = m.sportsCache.prefs

    nowCount = 0
    if nowEvents <> invalid then nowCount = nowEvents.Count()
    laterCount = 0
    if laterEvents <> invalid then laterCount = laterEvents.Count()

    noPrefs = true
    if prefs <> invalid and prefs.leagues <> invalid and prefs.leagues.Count() > 0 then noPrefs = false

    if nowCount = 0 and laterCount = 0
        if noPrefs
            m.sportsStatus.text = "No teams or sports followed yet. Open Settings → Sports on the mobile app to pick leagues and teams."
        else
            m.sportsStatus.text = "Nothing on right now. No games are live or starting in the next 7 days for your followed leagues."
        end if
        m.sportsStatus.visible = true
        m.sportsRowList.visible = false
        return
    end if

    rows = CreateObject("roSGNode", "ContentNode")
    if nowCount > 0
        row = rows.createChild("ContentNode")
        row.title = "Sports On Now"
        for each ev in nowEvents
            buildSportsCardChild(row, ev, true)
        end for
    end if
    if laterCount > 0
        row = rows.createChild("ContentNode")
        row.title = "Sports On Later"
        for each ev in laterEvents
            buildSportsCardChild(row, ev, false)
        end for
    end if

    ' Re-pin the cell component just before content assignment as a
    ' belt-and-suspenders. Uses the correct itemComponentName (string,
    ' inherited from ArrayGrid) — the rowItem* variant is bogus.
    m.sportsRowList.itemComponentName = "SportsCard"
    m.sportsRowList.content = rows
    m.sportsRowList.visible = true
    m.sportsStatus.visible = false
    print "[HomeScene] sports rows built — count="; rows.getChildCount()
    if m.currentView = "sports" then m.sportsRowList.setFocus(true)
end sub

' Build a single SportsCard ContentNode, pre-flattening every value the
' card needs. SportsCard.brs reads these fields directly. Standard
' HDPosterUrl + title are also populated so default RowList rendering
' has something to show if the rowItemComponentName binding ever fails
' to take effect — fail-soft instead of empty cards.
sub buildSportsCardChild(row as object, ev as object, isLive as boolean)
    child = row.createChild("ContentNode")

    ' Standard fields — fallback for default rendering. Title shows
    ' "MLB · Yankees vs Red Sox", poster shows the home team's logo.
    fallbackTitle = stringField(ev, "title")
    if fallbackTitle = "" then fallbackTitle = stringField(ev, "leagueLabel")
    child.title = fallbackTitle
    fallbackPoster = pickHomeOrFirstLogo(ev)
    if fallbackPoster <> ""
        child.HDPosterUrl = fallbackPoster
        child.SDPosterUrl = fallbackPoster
    end if

    child.AddField("isLive", "boolean", false)
    child.AddField("isUpcoming", "boolean", false)
    child.AddField("isTeamSport", "boolean", false)
    child.AddField("league", "string", false)
    child.AddField("statusText", "string", false)
    child.AddField("broadcast", "string", false)
    child.AddField("bgColor", "string", false)
    child.AddField("accentColor", "string", false)
    child.AddField("team1Name", "string", false)
    child.AddField("team1LogoUrl", "string", false)
    child.AddField("team1Score", "string", false)
    child.AddField("team2Name", "string", false)
    child.AddField("team2LogoUrl", "string", false)
    child.AddField("team2Score", "string", false)
    child.AddField("tournamentTitle", "string", false)
    ' Mirror the standard itemX fields so populateDetail (used by
    ' onSportsRowItemSelected → showView("detail")) doesn't crash on
    ' missing properties. Play / Mark buttons stay hidden because
    ' itemSource = "sports" is outside the library-item branch.
    child.AddField("itemSource", "string", false)
    child.AddField("itemSourceId", "string", false)
    child.AddField("itemTitle", "string", false)
    child.AddField("itemSummary", "string", false)
    child.AddField("itemType", "string", false)
    child.AddField("itemBackdropUrl", "string", false)
    child.AddField("itemWatched", "boolean", false)

    child.isLive = isLive
    child.isUpcoming = not isLive
    child.isTeamSport = ev.teamSport = true
    child.league = stringField(ev, "leagueLabel")
    child.broadcast = stringField(ev, "broadcast")

    if isLive
        child.statusText = stringField(ev, "statusDetail")
    else
        formatted = formatUpcomingTime(stringField(ev, "startsAt"))
        if formatted = "" then formatted = stringField(ev, "statusDetail")
        child.statusText = formatted
    end if

    bgHex = pickPrimaryColor(ev)
    if bgHex <> ""
        child.bgColor = "0x" + bgHex + "ff"
        child.accentColor = "0x" + bgHex + "ff"
    end if

    if child.isTeamSport and ev.competitors <> invalid and ev.competitors.Count() >= 2
        c1 = ev.competitors[0]
        c2 = ev.competitors[1]
        child.team1Name = sportsCompetitorName(c1, isLive)
        child.team1LogoUrl = stringField(c1, "logo")
        child.team1Score = stringField(c1, "score")
        child.team2Name = sportsCompetitorName(c2, isLive)
        child.team2LogoUrl = stringField(c2, "logo")
        child.team2Score = stringField(c2, "score")
    else
        child.tournamentTitle = stringField(ev, "title")
    end if

    child.itemSource = "sports"
    child.itemSourceId = stringField(ev, "id")
    child.itemTitle = stringField(ev, "title")
    child.itemType = "sports"
    child.itemSummary = stringField(ev, "statusDetail")
    child.itemWatched = false

    ' Diagnostic: verify the values made it onto the child node before
    ' RowList hands it to the SportsCard. If these print but the
    ' SportsCard reads them as empty, the issue is cross-component
    ' field visibility, not data assembly.
    print "[HomeScene] sportsChild league="; child.league; " team1="; child.team1Name; " isLive="; child.isLive
end sub

' Live cards show abbreviation, upcoming cards show the full name —
' matches mobile TeamRow.variant === 'upcoming' branch.
function sportsCompetitorName(c as object, isLive as boolean) as string
    if c = invalid then return ""
    if isLive
        if c.abbreviation <> invalid and c.abbreviation <> "" then return c.abbreviation
        if c.shortName <> invalid and c.shortName <> "" then return c.shortName
        if c.name <> invalid then return c.name
        return ""
    end if
    if c.name <> invalid and c.name <> "" then return c.name
    if c.shortName <> invalid and c.shortName <> "" then return c.shortName
    if c.abbreviation <> invalid then return c.abbreviation
    return ""
end function

' Home team logo if available, else first competitor with one. Used as
' the fallback poster when default RowList rendering is in play.
function pickHomeOrFirstLogo(ev as object) as string
    if ev.competitors = invalid then return ""
    homeLogo = ""
    fallback = ""
    for each c in ev.competitors
        if c.logo <> invalid and c.logo <> ""
            if c.homeAway = "home" then homeLogo = c.logo
            if fallback = "" then fallback = c.logo
        end if
    end for
    if homeLogo <> "" then return homeLogo
    return fallback
end function

' Followed team's primary > home team's primary > first available.
' Returns hex without "0x" prefix or alpha — caller wraps it.
function pickPrimaryColor(ev as object) as string
    if ev.competitors = invalid then return ""
    homeColor = ""
    fallback = ""
    for each c in ev.competitors
        if c.primaryColor <> invalid and c.primaryColor <> ""
            if c.isFollowed = true then return c.primaryColor
            if c.homeAway = "home" then homeColor = c.primaryColor
            if fallback = "" then fallback = c.primaryColor
        end if
    end for
    if homeColor <> "" then return homeColor
    return fallback
end function

' Format ISO 8601 → display string. Mirrors mobile formatUpcomingTime.
'   today           → "7:00 PM"
'   tomorrow        → "Tomorrow 7:00 PM"
'   later this week → "Fri 7:00 PM"
'   beyond a week   → "Mar 5 7:00 PM"
function formatUpcomingTime(iso as string) as string
    if iso = invalid or iso = "" then return ""
    dt = CreateObject("roDateTime")
    dt.FromISO8601String(iso)
    if dt.AsSeconds() = 0 then return ""
    dt.ToLocalTime()

    nowDt = CreateObject("roDateTime")
    nowDt.Mark()
    nowDt.ToLocalTime()

    dayDelta = (dayStartSeconds(dt) - dayStartSeconds(nowDt)) / 86400
    timeStr = formatTimeOfDay(dt)

    if dayDelta = 0 then return timeStr
    if dayDelta = 1 then return "Tomorrow " + timeStr
    if dayDelta > 1 and dayDelta < 7
        return weekdayShortName(dt) + " " + timeStr
    end if
    return monthShortName(dt) + " " + dt.GetDayOfMonth().toStr() + " " + timeStr
end function

function dayStartSeconds(dt as object) as integer
    return dt.AsSeconds() - (dt.GetHours() * 3600 + dt.GetMinutes() * 60 + dt.GetSeconds())
end function

' ─── Real-time clock ──────────────────────────────────────────────

sub onClockTick()
    updateClock()
end sub

sub updateClock()
    if m.clockLabel = invalid then return
    dt = CreateObject("roDateTime")
    dt.Mark()
    dt.ToLocalTime()
    m.clockLabel.text = formatTimeOfDay(dt)
end sub

function formatTimeOfDay(dt as object) as string
    ' Avoid `m` as a local — it shadows BrightScript's script-global
    ' "this" reference. Use `mins` instead.
    h = dt.GetHours()
    mins = dt.GetMinutes()
    suffix = "AM"
    if h >= 12 then suffix = "PM"
    if h = 0 then h = 12
    if h > 12 then h = h - 12
    mm = mins.toStr()
    if Len(mm) < 2 then mm = "0" + mm
    return h.toStr() + ":" + mm + " " + suffix
end function

function weekdayShortName(dt as object) as string
    days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    idx = dt.GetDayOfWeek()
    if idx < 0 or idx > 6 then return ""
    return days[idx]
end function

function monthShortName(dt as object) as string
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    idx = dt.GetMonth() - 1
    if idx < 0 or idx > 11 then return ""
    return months[idx]
end function

sub onSportsRowItemSelected()
    sel = m.sportsRowList.rowItemSelected
    if sel = invalid or sel.Count() < 2 then return
    rows = m.sportsRowList.content
    if rows = invalid then return
    row = rows.getChild(sel[0])
    if row = invalid then return
    node = row.getChild(sel[1])
    if node = invalid then return

    m.detailReturnTo = "sports"
    populateDetail(node)
    showView("detail")
end sub

' ─── Search tab ───────────────────────────────────────────────────
'
' Mirrors mobile (tabs)/search.tsx for the Library mode. Discover &
' Track is deferred — that flow needs Sonarr/Radarr add modals which
' are also missing from the detail view, and they belong in the same
' phase. Mobile filter chips become the searchFilterToggle ButtonGroup;
' mobile's TextInput becomes a Button-styled bar that opens Roku's
' KeyboardDialog modal on press.
'
' Why a modal keyboard instead of inline: Roku's on-screen Keyboard
' node is ~500px tall, which crowds the result grid out of frame.
' KeyboardDialog is the standard Roku idiom — accept that the user
' needs an OK to commit, in exchange for letting the grid fill the
' screen between searches.

sub onSearchInputPressed()
    print "[HomeScene] opening search keyboard, prefill="; m.searchQuery
    dlg = CreateObject("roSGNode", "KeyboardDialog")
    dlg.title = "Search your library"
    if m.searchQuery <> invalid then dlg.text = m.searchQuery
    dlg.buttons = ["Search", "Cancel"]
    dlg.observeField("buttonSelected", "onSearchKeyboardClosed")
    dlg.observeField("wasClosed", "onSearchKeyboardClosed")
    m.searchDialog = dlg
    m.top.dialog = dlg
end sub

sub onSearchKeyboardClosed()
    if m.searchDialog = invalid then return
    btn = m.searchDialog.buttonSelected
    text = m.searchDialog.text

    ' Always tear down — KeyboardDialog persists in m.top.dialog
    ' until explicitly cleared, and the dialog's inner state would
    ' bleed into the next open if we leave it.
    m.top.dialog = invalid
    m.searchDialog = invalid

    ' Restore focus to the input button. KeyboardDialog dismissal
    ' frequently leaves focus in a "no node" state — onKeyEvent then
    ' fires at Scene level with no hasFocus() match, and up/down
    ' silently no-op. Defer one tick (m.focusTimer routes to
    ' applyDeferredFocus, which knows the current view).
    m.focusTimer.control = "start"

    ' Cancel button or wasClosed-without-button → no-op.
    if btn <> 0 then return
    if text = invalid then text = ""
    text = trimString(text)

    m.searchQuery = text
    if text = ""
        updateSearchPlaceholder()
        m.searchStatus.visible = true
        m.searchResultsGrid.visible = false
        m.searchResultsGrid.content = invalid
        return
    end if
    ' Mirror the user's query in the bar so it works as both input and
    ' display. updateSearchPlaceholder also handles the mode-aware
    ' placeholder when query is empty.
    updateSearchPlaceholder()
    performSearch()
end sub

sub onSearchFilterSelected()
    idx = m.searchFilterToggle.buttonSelected
    newFilter = "all"
    if idx = 1 then newFilter = "tv"
    if idx = 2 then newFilter = "movie"
    if newFilter = m.searchFilter then return
    m.searchFilter = newFilter
    print "[HomeScene] search filter -> "; newFilter

    ' Re-run the current query with the new filter so results stay in
    ' sync with the chip selection — matches mobile's reactive query key.
    if m.searchQuery <> "" then performSearch()
end sub

' Library / Discover mode toggle. Library searches plex/jellyfin/emby
' and is filterable by type; Discover hits TMDB and only takes a query.
sub onSearchModeSelected()
    idx = m.searchModeToggle.buttonSelected
    newMode = "library"
    if idx = 1 then newMode = "discover"
    if newMode = m.searchMode then return
    m.searchMode = newMode
    print "[HomeScene] search mode -> "; newMode

    ' Filter chips only apply to library search — hide them in Discover.
    m.searchFilterToggle.visible = (newMode = "library")

    updateSearchPlaceholder()
    if m.searchQuery <> "" then performSearch()
end sub

sub updateSearchPlaceholder()
    if m.searchQuery <> ""
        m.searchInputButton.text = chr(34) + m.searchQuery + chr(34)
    else if m.searchMode = "discover"
        m.searchInputButton.text = "Tap to search shows & movies to track…"
    else
        m.searchInputButton.text = "Tap to search your library…"
    end if
    if m.searchQuery = ""
        if m.searchMode = "discover"
            m.searchStatus.text = "Search to find shows & movies to track."
        else
            m.searchStatus.text = "Type to search your library."
        end if
    end if
end sub

sub performSearch()
    if m.searchQuery = "" then return
    print "[HomeScene] searching ("; m.searchMode; "): "; m.searchQuery; " filter="; m.searchFilter
    m.searchStatus.text = "Searching…"
    m.searchStatus.visible = true

    if m.searchMode = "discover"
        url = m.apiUrl + "/api/discover/search?q=" + urlEncodeQuery(m.searchQuery)
    else
        url = m.apiUrl + "/api/search?q=" + urlEncodeQuery(m.searchQuery)
        if m.searchFilter <> "all"
            url = url + "&type=" + m.searchFilter
        end if
    end if

    task = CreateObject("roSGNode", "ApiTask")
    task.observeField("response", "onSearchResponse")
    task.method = "GET"
    task.url = url
    setApiTaskAuth(task)
    task.control = "RUN"
    m.searchTask = task
end sub

sub onSearchResponse(event as object)
    task = event.GetRoSGNode()
    ' Drop stale responses — if the user changed filter (or fired a
    ' new query) while one was in flight, the previous task's response
    ' must not overwrite the latest results.
    if m.searchTask = invalid or task.url <> m.searchTask.url then return
    response = task.response
    if response = invalid or response.success <> true
        msg = "Search failed"
        if response <> invalid and response.error <> invalid then msg = response.error
        m.searchStatus.text = msg
        m.searchStatus.visible = true
        m.searchResultsGrid.visible = false
        return
    end if

    ' Library search returns { results: ContentItem[] }; Discover
     ' returns a flat array of TmdbSearchResult-with-isTracked.
    results = invalid
    if m.searchMode = "discover"
        if response.data <> invalid then results = response.data
    else
        if response.data <> invalid and response.data.results <> invalid
            results = response.data.results
        end if
    end if
    if results = invalid then results = []
    m.searchResults = results
    renderSearchResults(results)
end sub

sub renderSearchResults(items as object)
    print "[HomeScene] search results ("; m.searchMode; "): "; items.Count()
    if items.Count() = 0
        m.searchStatus.text = "No results for " + chr(34) + m.searchQuery + chr(34) + "."
        m.searchStatus.visible = true
        m.searchResultsGrid.visible = false
        m.searchResultsGrid.content = invalid
        return
    end if

    rootNode = CreateObject("roSGNode", "ContentNode")
    for each item in items
        child = rootNode.createChild("ContentNode")
        if m.searchMode = "discover"
            attachDiscoverFields(child, item)
        else
            child.title = itemDisplayTitle(item)
            posterUrl = resolvePosterUrl(item)
            if posterUrl <> ""
                child.HDPosterUrl = posterUrl
                child.SDPosterUrl = posterUrl
            end if
            attachItemFields(child, item)
        end if
    end for

    m.searchResultsGrid.content = rootNode
    m.searchResultsGrid.visible = true
    m.searchStatus.visible = false
end sub

' Discover items come from /api/discover/search as TmdbSearchResult
' (poster/backdrop are absolute URLs, not artwork blocks). Map them
' onto the same itemX fields populateDetail expects.
sub attachDiscoverFields(child as object, item as object)
    poster = stringField(item, "poster")
    if poster <> ""
        child.HDPosterUrl = poster
        child.SDPosterUrl = poster
    end if
    title = stringField(item, "title")
    child.title = title

    child.AddField("itemSource", "string", false)
    child.AddField("itemSourceId", "string", false)
    child.AddField("itemTitle", "string", false)
    child.AddField("itemShowTitle", "string", false)
    child.AddField("itemSummary", "string", false)
    child.AddField("itemYear", "string", false)
    child.AddField("itemDuration", "string", false)
    child.AddField("itemBackdropUrl", "string", false)
    child.AddField("itemType", "string", false)
    child.AddField("itemWatched", "boolean", false)
    child.AddField("itemTmdbId", "string", false)
    ' Track state — populateDetail hides the Track button when this is
    ' true so the user can't double-track.
    child.AddField("itemTracked", "boolean", false)
    ' Streaming provider stamped after a successful Track POST (kept
    ' on the node so a re-tap shows the badge state without a refetch).
    child.AddField("itemProvider", "string", false)

    child.itemSource = "discover"
    child.itemSourceId = stringField(item, "id")
    child.itemTitle = title
    child.itemSummary = stringField(item, "overview")
    child.itemYear = stringField(item, "year")
    child.itemType = stringField(item, "type")
    child.itemTmdbId = stringField(item, "tmdbId")
    child.itemBackdropUrl = stringField(item, "backdrop")
    child.itemTracked = (item.isTracked = true)
    child.itemWatched = false
end sub

sub onSearchItemSelected()
    idx = m.searchResultsGrid.itemSelected
    rootNode = m.searchResultsGrid.content
    if rootNode = invalid then return
    node = rootNode.getChild(idx)
    if node = invalid then return

    m.detailReturnTo = "search"
    populateDetail(node)
    showView("detail")
end sub

' BrightScript URL encoder — only escapes the handful of characters
' that break a query string. roUrlTransfer's Escape() exists but
' belongs to a network object we can't allocate from the render thread.
' Library and TV/Movies endpoints get away without one because their
' values are alphanumeric; search free-text needs the real thing.
function urlEncodeQuery(s as string) as string
    out = ""
    for i = 1 to Len(s)
        c = Mid(s, i, 1)
        b = Asc(c)
        ' a-z A-Z 0-9 are safe; everything else gets percent-encoded.
        isSafe = (b >= 48 and b <= 57) or (b >= 65 and b <= 90) or (b >= 97 and b <= 122)
        if isSafe
            out = out + c
        else if c = " "
            out = out + "+"
        else
            ' Right(...,2) pads single-digit hex (e.g. tab = 0x09 → "09").
            out = out + "%" + Right("00" + toHex(b), 2)
        end if
    end for
    return out
end function

function toHex(n as integer) as string
    digits = "0123456789ABCDEF"
    if n = 0 then return "0"
    out = ""
    while n > 0
        out = Mid(digits, (n mod 16) + 1, 1) + out
        n = n \ 16
    end while
    return out
end function

function trimString(s as string) as string
    if s = invalid then return ""
    out = s
    while Len(out) > 0 and Left(out, 1) = " "
        out = Mid(out, 2)
    end while
    while Len(out) > 0 and Right(out, 1) = " "
        out = Left(out, Len(out) - 1)
    end while
    return out
end function

' Build a row from an array of items. The TV/Movies endpoints return
' standard ContentItem shapes — same field set as /api/home items —
' so attachItemFields handles every flavour. Tracked items (TrackedItem
' shape) are different: poster + title at the top level, no `artwork`
' / `progress` blocks. resolveTrackedPosterUrl + attachTrackedFields
' below keep that path tidy.
sub appendShelfIfNonEmpty(rows as object, title as string, items as object, isTracked as boolean)
    if items = invalid or items.Count() = 0 then return
    row = rows.createChild("ContentNode")
    row.title = title
    for each item in items
        child = row.createChild("ContentNode")
        if isTracked
            attachTrackedFields(child, item)
        else
            child.title = itemDisplayTitle(item)
            child.description = itemDescription(item)
            posterUrl = resolvePosterUrl(item)
            if posterUrl <> ""
                child.HDPosterUrl = posterUrl
                child.SDPosterUrl = posterUrl
            end if
            attachItemFields(child, item)
        end if
    end for
end sub

' Tracked items come from /api/tracked and have a different shape than
' library ContentItems. Map them onto the same itemSource/itemSourceId
' fields so populateDetail still does the right thing — Play / Mark
' buttons hide automatically because itemSource isn't plex/jellyfin/emby.
sub attachTrackedFields(child as object, item as object)
    poster = stringField(item, "poster")
    if poster <> ""
        if Left(poster, 4) = "http"
            poster = proxiedArtworkUrl(poster, 360)
        else if Left(poster, 1) = "/"
            poster = withAuthQuery(m.apiUrl + poster + "&w=360")
        end if
        child.HDPosterUrl = poster
        child.SDPosterUrl = poster
    end if
    title = stringField(item, "title")
    child.title = title
    child.description = stringField(item, "overview")

    child.AddField("itemSource", "string", false)
    child.AddField("itemSourceId", "string", false)
    child.AddField("itemTitle", "string", false)
    child.AddField("itemShowTitle", "string", false)
    child.AddField("itemSummary", "string", false)
    child.AddField("itemYear", "string", false)
    child.AddField("itemDuration", "string", false)
    child.AddField("itemBackdropUrl", "string", false)
    child.AddField("itemType", "string", false)
    child.AddField("itemWatched", "boolean", false)
    ' Tracked items carry their TMDB id, used by the Add to Sonarr /
    ' Radarr flow to look up series/movie metadata server-side.
    child.AddField("itemTmdbId", "string", false)

    child.itemSource = "tracked"
    child.itemSourceId = stringField(item, "id")
    child.itemTitle = title
    child.itemSummary = stringField(item, "overview")
    child.itemYear = stringField(item, "year")
    child.itemType = stringField(item, "type")
    child.itemTmdbId = stringField(item, "tmdbId")
    backdrop = stringField(item, "backdrop")
    if backdrop = "" then backdrop = poster
    if backdrop <> ""
        if Left(backdrop, 4) = "http"
            backdrop = proxiedArtworkUrl(backdrop, 1920)
        else if Left(backdrop, 1) = "/"
            backdrop = withAuthQuery(m.apiUrl + backdrop + "&w=1920")
        end if
    end if
    child.itemBackdropUrl = backdrop
    child.itemWatched = false
end sub

sub onDetailButtonSelected()
    idx = m.detailActions.buttonSelected
    print "[HomeScene] detail button selected: "; idx
    ' Indices map to XML order:
    '   0=Play, 1=Mark Watched, 2=Mark Unwatched, 3=Track,
    '   4=Add to Sonarr, 5=Add to Radarr, 6=Back
    if idx = 0
        onPlayPressed()
    else if idx = 1
        onMarkWatchedPressed()
    else if idx = 2
        onMarkUnwatchedPressed()
    else if idx = 3
        onTrackPressed()
    else if idx = 4
        onAddToSonarrPressed()
    else if idx = 5
        onAddToRadarrPressed()
    else if idx = 6
        returnToDetailOrigin()
    end if
end sub

' Single source of truth for "where did we come from when we entered
' detail" — used by both the Back button and the Back key.
sub returnToDetailOrigin()
    if m.detailReturnTo = "tv"
        showView("tv")
    else if m.detailReturnTo = "movies"
        showView("movies")
    else if m.detailReturnTo = "library"
        showView("library")
    else if m.detailReturnTo = "search"
        showView("search")
    else if m.detailReturnTo = "sports"
        showView("sports")
    else
        showView("home")
    end if
end sub

sub onMarkWatchedPressed()
    if m.selectedItem = invalid then return
    print "[HomeScene] mark watched: "; m.selectedItem.itemSourceId
    sendScrobble("/api/scrobble", true)
end sub

sub onMarkUnwatchedPressed()
    if m.selectedItem = invalid then return
    print "[HomeScene] mark unwatched: "; m.selectedItem.itemSourceId
    sendScrobble("/api/unscrobble", false)
end sub

sub sendScrobble(endpoint as string, newWatched as boolean)
    if m.selectedItem = invalid then return
    body = newPostBody()
    body["sourceId"] = m.selectedItem.itemSourceId
    body["source"] = m.selectedItem.itemSource
    task = CreateObject("roSGNode", "ApiTask")
    task.method = "POST"
    task.url = m.apiUrl + endpoint
    task.body = FormatJson(body)
    setApiTaskAuth(task)
    task.control = "RUN"

    ' Optimistic local update — flip the watched flag on the cached
    ' ContentNode and re-render the detail buttons. Backend confirms
    ' fire-and-forget; if it fails the next /api/home refresh will
    ' correct local state.
    m.selectedItem.itemWatched = newWatched
    populateDetail(m.selectedItem)

    ' Flag downstream views as stale so they refetch on next visit.
    m.homeStale = true
    m.tvStale = true
    m.moviesStale = true
    m.libraryCache = { show: invalid, movie: invalid }
end sub

' ─── Track (add to Live TV watchlist) ─────────────────────────────
'
' Mobile parity: the Track flow on mobile shows a streaming-provider
' picker before POSTing to /api/tracked. The Roku v1 keeps it simple
' and posts with provider="other" — users can re-pick the provider on
' the mobile app afterward. The Track button only shows for Discover-
' mode TV results (not movies, not already-tracked).

sub onTrackPressed()
    if m.selectedItem = invalid then return
    item = m.selectedItem

    titleStr = readNodeStr(item, "itemTitle")
    if titleStr = "" then titleStr = readNodeStr(item, "title")
    typeStr = readNodeStr(item, "itemType")
    tmdbStr = readNodeStr(item, "itemTmdbId")

    print "[HomeScene] Track pressed: title='"; titleStr; "' type='"; typeStr; "' tmdb='"; tmdbStr; "'"

    tmdbNum = 0
    if tmdbStr <> "" then tmdbNum = Int(Val(tmdbStr))
    if tmdbNum <= 0
        m.detailAddStatus.text = "Can't track — missing TMDB id."
        m.detailAddStatus.color = "0xff7777ff"
        m.detailAddStatus.visible = true
        return
    end if
    if titleStr = "" or typeStr = ""
        m.detailAddStatus.text = "Can't track — missing title or type."
        m.detailAddStatus.color = "0xff7777ff"
        m.detailAddStatus.visible = true
        return
    end if

    yearStr = readNodeStr(item, "itemYear")
    yearNum = 0
    if yearStr <> "" then yearNum = Int(Val(yearStr))

    body = newPostBody()
    body["tmdbId"] = tmdbNum
    body["title"] = titleStr
    body["type"] = typeStr
    body["year"] = yearNum
    body["overview"] = readNodeStr(item, "itemSummary")
    body["poster"] = readNodeStr(item, "HDPosterUrl")
    body["backdrop"] = readNodeStr(item, "itemBackdropUrl")
    body["rating"] = 0
    body["provider"] = "other"

    print "[HomeScene] Track body: "; FormatJson(body)
    m.detailAddStatus.text = "Tracking…"
    m.detailAddStatus.color = "0xe5a00dff"
    m.detailAddStatus.visible = true

    task = CreateObject("roSGNode", "ApiTask")
    task.observeField("response", "onTrackResponse")
    task.method = "POST"
    task.url = m.apiUrl + "/api/tracked"
    task.body = FormatJson(body)
    setApiTaskAuth(task)
    task.control = "RUN"
    m.trackTask = task
end sub

sub onTrackResponse()
    response = m.trackTask.response
    if response = invalid or response.success <> true
        msg = "Track failed"
        if response <> invalid and response.error <> invalid then msg = response.error
        m.detailAddStatus.text = msg
        m.detailAddStatus.color = "0xff7777ff"
        return
    end if
    m.detailAddStatus.text = "Tracking — appears on the TV tab."
    m.detailAddStatus.color = "0x77ff77ff"

    ' Mark TV cache stale so the new tracked entry shows on the TV
    ' tab's Tracked shelf next visit.
    m.tvStale = true
    ' Update the in-memory node so a return-from-detail without
    ' refetch still shows the Track button hidden.
    if m.selectedItem <> invalid
        m.selectedItem.itemTracked = true
        m.trackButton.visible = false
    end if
end sub

function stringOrInvalid(v as dynamic) as string
    if v = invalid then return ""
    return v
end function

' BrightScript's `{}` literal builds a case-INSENSITIVE roAssociativeArray.
' FormatJson then emits keys in their normalised lower-case form, which
' breaks every camelCase API contract — `tmdbId` ships as `tmdbid`,
' `qualityProfileId` ships as `qualityprofileid`, the backend's
' destructure misses them, and the request 400s. Build POST bodies
' through this helper instead — SetModeCaseSensitive locks the casing
' the way it was inserted.
function newPostBody() as object
    body = CreateObject("roAssociativeArray")
    body.SetModeCaseSensitive()
    return body
end function

' Defensive ContentNode field reader. Returns "" for invalid; coerces
' integer / non-string types to string. Used by Track / Add submit
' flows where a missing title/type triggers a 400 from the backend.
function readNodeStr(node as object, name as string) as string
    if node = invalid then return ""
    v = node[name]
    if v = invalid then return ""
    if type(v) = "String" or type(v) = "roString" then return v
    return v.toStr()
end function

' ─── Add to Sonarr / Radarr ───────────────────────────────────────
'
' v1 quick-add: fetches profiles + folders, picks the first of each,
' POSTs the add. No picker UI yet — that comes in a follow-up phase
' alongside the Search Discover & Track flow. Mobile parity for the
' picker requires a sheet with Quality Profile / Root Folder / Monitor
' chips; for now we trust the server's first-defined entries. If the
' user has multiple profiles/folders and wants to choose, they can do
' so on the mobile app and the Roku will follow.

sub onAddToSonarrPressed()
    if m.selectedItem = invalid then return
    print "[HomeScene] Add to Sonarr pressed"
    m.addArrType = "sonarr"
    showAddArrLoading()
    fetchAddArrConfig()
end sub

sub onAddToRadarrPressed()
    if m.selectedItem = invalid then return
    print "[HomeScene] Add to Radarr pressed"
    m.addArrType = "radarr"
    showAddArrLoading()
    fetchAddArrConfig()
end sub

sub showAddArrLoading()
    m.detailAddStatus.text = "Loading " + capitalizeFirst(m.addArrType) + " config…"
    m.detailAddStatus.color = "0xb0b0b0ff"
    m.detailAddStatus.visible = true
end sub

sub fetchAddArrConfig()
    m.addArrPending = 2
    m.addArrProfiles = invalid
    m.addArrFolders = invalid

    profilesTask = CreateObject("roSGNode", "ApiTask")
    profilesTask.observeField("response", "onAddArrProfilesResponse")
    profilesTask.method = "GET"
    profilesTask.url = m.apiUrl + "/api/" + m.addArrType + "/profiles"
    setApiTaskAuth(profilesTask)
    profilesTask.control = "RUN"
    m.addArrProfilesTask = profilesTask

    foldersTask = CreateObject("roSGNode", "ApiTask")
    foldersTask.observeField("response", "onAddArrFoldersResponse")
    foldersTask.method = "GET"
    foldersTask.url = m.apiUrl + "/api/" + m.addArrType + "/rootfolders"
    setApiTaskAuth(foldersTask)
    foldersTask.control = "RUN"
    m.addArrFoldersTask = foldersTask
end sub

sub onAddArrProfilesResponse()
    response = m.addArrProfilesTask.response
    if response <> invalid and response.success = true and response.data <> invalid
        m.addArrProfiles = response.data
    end if
    onAddArrConfigComplete()
end sub

sub onAddArrFoldersResponse()
    response = m.addArrFoldersTask.response
    if response <> invalid and response.success = true and response.data <> invalid
        m.addArrFolders = response.data
    end if
    onAddArrConfigComplete()
end sub

sub onAddArrConfigComplete()
    m.addArrPending = m.addArrPending - 1
    if m.addArrPending > 0 then return

    if m.addArrProfiles = invalid or m.addArrProfiles.Count() = 0
        m.detailAddStatus.text = "No quality profiles available. Configure " + capitalizeFirst(m.addArrType) + " on the backend first."
        m.detailAddStatus.color = "0xff7777ff"
        return
    end if
    if m.addArrFolders = invalid or m.addArrFolders.Count() = 0
        m.detailAddStatus.text = "No root folders configured."
        m.detailAddStatus.color = "0xff7777ff"
        return
    end if

    submitAddArr(m.addArrProfiles[0], m.addArrFolders[0])
end sub

sub submitAddArr(profile as object, folder as object)
    item = m.selectedItem
    if item = invalid then return

    ' Try the custom itemTitle first, fall back to the standard title
    ' field — both are populated by attachDiscoverFields/attachTrackedFields,
    ' but custom AddField'd fields seem to occasionally come back invalid
    ' on some Roku devices when read after MarkupGrid renders the cell.
    titleStr = readNodeStr(item, "itemTitle")
    if titleStr = "" then titleStr = readNodeStr(item, "title")
    tmdbStr = readNodeStr(item, "itemTmdbId")

    print "[HomeScene] Add submit: type="; m.addArrType; " title='"; titleStr; "' tmdb='"; tmdbStr; "' profile.id="; profile.id; " folder.path="; folder.path

    if titleStr = ""
        m.detailAddStatus.text = "Can't add — title not set on the selected item."
        m.detailAddStatus.color = "0xff7777ff"
        return
    end if

    body = newPostBody()
    body["title"] = titleStr
    body["qualityProfileId"] = profile.id
    body["rootFolderPath"] = folder.path
    ' Send tmdbId as integer when present so the backend's strict
    ' identity match against Sonarr/Radarr lookup candidates works.
    ' Radarr requires it; Sonarr uses it as a hint when set.
    if tmdbStr <> ""
        tmdbNum = Int(Val(tmdbStr))
        if tmdbNum > 0 then body["tmdbId"] = tmdbNum
    end if

    print "[HomeScene] Add body: "; FormatJson(body)
    m.detailAddStatus.text = "Adding to " + capitalizeFirst(m.addArrType) + "…"
    m.detailAddStatus.color = "0xe5a00dff"

    task = CreateObject("roSGNode", "ApiTask")
    task.observeField("response", "onAddArrSubmitResponse")
    task.method = "POST"
    task.url = m.apiUrl + "/api/" + m.addArrType + "/add"
    task.body = FormatJson(body)
    setApiTaskAuth(task)
    task.control = "RUN"
    m.addArrSubmitTask = task
end sub

sub onAddArrSubmitResponse()
    response = m.addArrSubmitTask.response
    if response = invalid or response.success <> true
        msg = "Add failed"
        if response <> invalid and response.error <> invalid then msg = response.error
        m.detailAddStatus.text = msg
        m.detailAddStatus.color = "0xff7777ff"
        return
    end if
    m.detailAddStatus.text = "Added to " + capitalizeFirst(m.addArrType) + "."
    m.detailAddStatus.color = "0x77ff77ff"

    ' New download will appear on the home / TV / movies "Downloading"
    ' shelves on next visit — invalidate so the user sees it.
    m.homeStale = true
    m.tvStale = true
    m.moviesStale = true
end sub

function capitalizeFirst(s as string) as string
    if s = invalid or s = "" then return ""
    return Ucase(Left(s, 1)) + Mid(s, 2)
end function

' Override Scene's default key handler so the remote Back button walks
' our internal view stack instead of immediately exiting the channel.
function onKeyEvent(key as string, press as boolean) as boolean
    print "[HomeScene] onKeyEvent key="; key; " press="; press; " view="; m.currentView
    if not press then return false

    ' On the player view, every OK / direction press re-shows Roku's
    ' standard transport overlay. Track the timestamp so the Back-key
    ' handler below can tell whether the overlay is likely still
    ' visible (and absorb the first Back).
    if m.currentView = "player" and (key = "OK" or key = "up" or key = "down" or key = "left" or key = "right" or key = "play" or key = "fastforward" or key = "rewind")
        m.lastPlayerKeyAt = Uptime(0)
    end if

    ' Pair view shortcuts: OK requests a fresh code, * opens the API URL
    ' editor (in case the user typed the wrong URL). Both useful when
    ' the admin is fumbling through /setup on another device.
    if m.currentView = "pair"
        if key = "OK"
            startPair()
            return true
        end if
        if key = "options"
            onEditApiUrlPressed()
            return true
        end if
    end if

    ' Tracks overlay open: route Up/Down between the two LabelLists
    ' and the Close button. LabelList only bubbles directional keys
    ' when it can't navigate further (so within-list nav still works),
    ' which means our handler only fires at the boundaries.
    if m.tracksOpen = true
        if key = "down"
            if m.tracksAudioList.isInFocusChain()
                m.tracksSubtitleList.setFocus(true)
                return true
            end if
            if m.tracksSubtitleList.isInFocusChain()
                m.tracksCloseButton.setFocus(true)
                return true
            end if
        else if key = "up"
            if m.tracksCloseButton.isInFocusChain()
                m.tracksSubtitleList.setFocus(true)
                return true
            end if
            if m.tracksSubtitleList.isInFocusChain()
                m.tracksAudioList.setFocus(true)
                return true
            end if
        end if
    end if

    ' Up arrow during playback opens the Quality picker. Down opens
    ' the Tracks picker. Guarded against firing while the Tracks
    ' overlay itself is already open — otherwise Down on the close
    ' button would re-open the picker on top of itself.
    if key = "up" and m.currentView = "player" and m.tracksOpen <> true
        openQualityPicker()
        return true
    end if
    if key = "down" and m.currentView = "player" and m.tracksOpen <> true
        openTracksPicker()
        return true
    end if

    ' Vertical focus chain:
    '   tabBar  ↔  rowList                            (home view)
    '   tabBar  ↔  libraryTypeToggle  ↔  libraryGrid  (library view)
    ' RowList / MarkupGrid / ButtonGroup don't honour nextFocusUp /
    ' nextFocusDown reliably, so route the directional keys ourselves.
    if key = "up"
        if m.currentView = "home"
            sel = m.rowList.rowItemFocused
            if sel <> invalid and sel.Count() >= 2 and sel[0] = 0
                m.tabBar.setFocus(true)
                return true
            end if
        else if m.currentView = "tv"
            sel = m.tvRowList.rowItemFocused
            if sel <> invalid and sel.Count() >= 2 and sel[0] = 0
                m.tabBar.setFocus(true)
                return true
            end if
        else if m.currentView = "movies"
            sel = m.moviesRowList.rowItemFocused
            if sel <> invalid and sel.Count() >= 2 and sel[0] = 0
                m.tabBar.setFocus(true)
                return true
            end if
        else if m.currentView = "sports"
            sel = m.sportsRowList.rowItemFocused
            if sel <> invalid and sel.Count() >= 2 and sel[0] = 0
                m.tabBar.setFocus(true)
                return true
            end if
        else if m.currentView = "library"
            if m.libraryTypeToggle.isInFocusChain()
                m.tabBar.setFocus(true)
                return true
            end if
            ' Grid handles row 1+ → row 0 internally; the up event
            ' only reaches us at the top boundary. itemFocused can
            ' come back invalid before the user has moved within the
            ' grid — treat that as "top row" and lift unconditionally.
            if m.libraryGrid.isInFocusChain()
                idx = m.libraryGrid.itemFocused
                if idx = invalid or idx < 9
                    m.libraryTypeToggle.setFocus(true)
                    return true
                end if
            end if
        else if m.currentView = "search"
            ' Up chain on Search: grid → filter (library only) → mode → input → tabBar
            if m.searchInputButton.isInFocusChain()
                m.tabBar.setFocus(true)
                return true
            end if
            if m.searchModeToggle.isInFocusChain()
                m.searchInputButton.setFocus(true)
                return true
            end if
            if m.searchFilterToggle.isInFocusChain()
                m.searchModeToggle.setFocus(true)
                return true
            end if
            if m.searchResultsGrid.isInFocusChain()
                sIdx = m.searchResultsGrid.itemFocused
                if sIdx = invalid or sIdx < 9
                    if m.searchMode = "library"
                        m.searchFilterToggle.setFocus(true)
                    else
                        m.searchModeToggle.setFocus(true)
                    end if
                    return true
                end if
            end if
        else if m.currentView = "settings"
            ' Up chain on Settings:
            '   configureChannels ↑ updateButtons (when visible) ↑ connection
            '   ↑ switchUser ↑ editUrl ↑ tabBar
            if m.configureChannelsButton.isInFocusChain()
                if m.checkUpdateButton.visible
                    m.checkUpdateButton.setFocus(true)
                else
                    m.connectionToggle.setFocus(true)
                end if
                return true
            end if
            if m.checkUpdateButton.isInFocusChain() or m.installUpdateButton.isInFocusChain()
                m.connectionToggle.setFocus(true)
                return true
            end if
            if m.connectionToggle.isInFocusChain()
                m.switchUserButton.setFocus(true)
                return true
            end if
            if m.switchUserButton.isInFocusChain()
                m.editApiUrlButton.setFocus(true)
                return true
            end if
            if m.editApiUrlButton.isInFocusChain()
                m.tabBar.setFocus(true)
                return true
            end if
        end if
    end if

    if key = "down"
        if m.tabBar.isInFocusChain()
            if m.currentView = "home"
                m.rowList.setFocus(true)
                return true
            else if m.currentView = "tv"
                m.tvRowList.setFocus(true)
                return true
            else if m.currentView = "movies"
                m.moviesRowList.setFocus(true)
                return true
            else if m.currentView = "library"
                m.libraryTypeToggle.setFocus(true)
                return true
            else if m.currentView = "search"
                m.searchInputButton.setFocus(true)
                return true
            else if m.currentView = "sports"
                m.sportsRowList.setFocus(true)
                return true
            else if m.currentView = "settings"
                m.editApiUrlButton.setFocus(true)
                return true
            end if
        end if
        if m.currentView = "settings"
            ' Down chain on Settings:
            '   editUrl ↓ switchUser ↓ connection ↓ checkUpdate (when visible)
            '   ↓ configureChannels
            if m.editApiUrlButton.isInFocusChain()
                m.switchUserButton.setFocus(true)
                return true
            end if
            if m.switchUserButton.isInFocusChain()
                m.connectionToggle.setFocus(true)
                return true
            end if
            if m.connectionToggle.isInFocusChain()
                if m.checkUpdateButton.visible
                    m.checkUpdateButton.setFocus(true)
                else
                    m.configureChannelsButton.setFocus(true)
                end if
                return true
            end if
            if m.checkUpdateButton.isInFocusChain() or m.installUpdateButton.isInFocusChain()
                m.configureChannelsButton.setFocus(true)
                return true
            end if
        end if
        if m.libraryTypeToggle.isInFocusChain()
            m.libraryGrid.setFocus(true)
            return true
        end if
        if m.currentView = "search"
            ' Down chain: input → mode → filter (library only) → grid
            if m.searchInputButton.isInFocusChain()
                m.searchModeToggle.setFocus(true)
                return true
            end if
            if m.searchModeToggle.isInFocusChain()
                if m.searchMode = "library"
                    m.searchFilterToggle.setFocus(true)
                else if m.searchResultsGrid.content <> invalid and m.searchResultsGrid.content.getChildCount() > 0
                    m.searchResultsGrid.setFocus(true)
                end if
                return true
            end if
            if m.searchFilterToggle.isInFocusChain()
                if m.searchResultsGrid.content <> invalid and m.searchResultsGrid.content.getChildCount() > 0
                    m.searchResultsGrid.setFocus(true)
                end if
                return true
            end if
        end if
    end if

    ' Settings → Server Updates: Check and Install buttons sit side by
    ' side. Roku's auto-cursor doesn't reliably bridge two freestanding
    ' Buttons horizontally, so handle left/right ourselves.
    if m.currentView = "settings" and (key = "right" or key = "left")
        if key = "right" and m.checkUpdateButton.isInFocusChain() and m.installUpdateButton.visible
            m.installUpdateButton.setFocus(true)
            return true
        end if
        if key = "left" and m.installUpdateButton.isInFocusChain()
            m.checkUpdateButton.setFocus(true)
            return true
        end if
    end if

    if key = "back"
        if m.currentView = "player"
            ' Back while the Tracks overlay is open: cancel without
            ' applying any pending selections, keep playing.
            if m.tracksOpen = true
                cancelTracksView()
                return true
            end if
            ' Back while the Skip Intro/Credits button is up: dismiss
            ' the button for the rest of this marker only (so it
            ' doesn't immediately re-show on the next position tick),
            ' return focus to the Video. Doesn't exit playback.
            if m.activeMarker <> invalid and m.skipButton.visible = true
                m.dismissedUntilMs = m.activeMarker.endMs
                m.skipButton.visible = false
                m.activeMarker = invalid
                m.video.setFocus(true)
                return true
            end if
            ' First Back while the transport overlay is (likely) still
            ' visible: absorb it. Second Back: actually stop. The
            ' overlay tracking is heuristic — we mark the time of the
            ' last player key (OK / Up / Down / Left / Right) since
            ' Roku auto-hides the overlay after a few seconds of
            ' inactivity. m.lastPlayerKeyAt = 0 means "no recent
            ' activity, overlay is hidden, Back exits".
            if m.lastPlayerKeyAt <> invalid and m.lastPlayerKeyAt > 0
                elapsed = Uptime(0) - m.lastPlayerKeyAt
                if elapsed < 5
                    m.lastPlayerKeyAt = 0
                    return true
                end if
            end if
            stopPlayback()
            showView("detail")
            return true
        end if
        if m.currentView = "detail"
            ' Return to whichever shelf the user came from.
            returnToDetailOrigin()
            return true
        end if
        ' Back from any tab returns to home AT the first card of the
        ' first shelf, not wherever the home view was last scrolled to.
        if m.currentView = "tv" or m.currentView = "movies" or m.currentView = "library" or m.currentView = "search" or m.currentView = "sports" or m.currentView = "settings"
            goHome()
            return true
        end if
        if m.currentView = "userPicker"
            ' Boot path (no user yet): Back here would leave the user
            ' stranded — eat it. They MUST pick someone.
            if not m.initialFetchDone then return true
            ' Re-pick path (Settings → Switch User): cancel back to settings.
            showView("settings")
            return true
        end if
        if m.currentView = "liveTv"
            ' Channel picker — selections were saved as they were
            ' toggled, so just return to Settings. Home will refetch on
            ' next visit because saveLiveTvChannels marked it stale.
            showView("settings")
            return true
        end if
        if m.currentView = "pair"
            ' First-run pair view — there's nothing to go back to.
            ' Eat the key so the channel doesn't exit.
            return true
        end if
        ' Home is the root view — Back never exits the channel from
        ' here. Users press the Roku Home key to exit instead. Reset
        ' the home shelf focus to row 0 item 0 on Back so the user
        ' lands at a predictable spot regardless of where they were
        ' before.
        if m.currentView = "home"
            jumpHomeToTop()
            return true
        end if
    end if
    return false
end function

' Single entry point for "go back to the home view at the top". Used
' by Back from every tab/detail/etc. so the user always lands at the
' first card of the first shelf with focus on it.
sub goHome()
    showView("home")
    jumpHomeToTop()
end sub

sub jumpHomeToTop()
    if m.rowList = invalid then return
    if m.rowList.content <> invalid and m.rowList.content.getChildCount() > 0
        m.rowList.jumpToRowItem = [0, 0]
        m.rowList.setFocus(true)
    end if
end sub

sub showView(name as string)
    print "[HomeScene] showView -> "; name
    m.currentView = name
    m.homeView.visible = (name = "home")
    m.tvView.visible = (name = "tv")
    m.moviesView.visible = (name = "movies")
    m.libraryView.visible = (name = "library")
    m.searchView.visible = (name = "search")
    m.sportsView.visible = (name = "sports")
    m.settingsView.visible = (name = "settings")
    m.userPickerView.visible = (name = "userPicker")
    m.pairView.visible = (name = "pair")
    m.liveTvView.visible = (name = "liveTv")
    m.detailView.visible = (name = "detail")
    m.playerView.visible = (name = "player")
    ' Tab bar + brand mark are top-level chrome — visible on the tab
    ' surfaces, hidden during fullscreen detail / player / userPicker / pair views.
    showChrome = (name = "home" or name = "tv" or name = "movies" or name = "library" or name = "search" or name = "sports" or name = "settings")
    m.tabBar.visible = showChrome
    m.titleLabel.visible = showChrome

    ' Refetch tabs whose data was invalidated by a scrobble or user
    ' switch. Each tab maintains its own stale flag so we only refetch
    ' the ones the user actually visits.
    if name = "home" and m.homeStale = true
        m.homeStale = false
        refetchHome()
    end if
    if name = "tv"
        if m.tvStale = true
            m.tvStale = false
            m.tvCache = invalid
        end if
        ensureTvLoaded()
    end if
    if name = "movies"
        if m.moviesStale = true
            m.moviesStale = false
            m.moviesCache = invalid
        end if
        ensureMoviesLoaded()
    end if
    if name = "library"
        ensureLibraryLoaded()
    end if
    if name = "sports"
        if m.sportsStale = true
            m.sportsStale = false
            m.sportsCache = invalid
        end if
        ensureSportsLoaded()
    end if
    if name = "settings"
        populateSettings()
    end if
    if name = "liveTv"
        ensureChannelsLoaded()
    end if

    ' Defer setFocus by one tick — see init() for why.
    m.focusTimer.control = "start"
end sub

sub refetchHome()
    print "[HomeScene] refetching home shelves"
    fetchHomeShelves()
end sub

sub applyDeferredFocus()
    print "[HomeScene] applyDeferredFocus -> "; m.currentView
    if m.currentView = "home"
        m.rowList.setFocus(true)
    else if m.currentView = "tv"
        if m.tvRowList.content <> invalid and m.tvRowList.content.getChildCount() > 0
            m.tvRowList.setFocus(true)
        else
            m.tabBar.setFocus(true)
        end if
    else if m.currentView = "movies"
        if m.moviesRowList.content <> invalid and m.moviesRowList.content.getChildCount() > 0
            m.moviesRowList.setFocus(true)
        else
            m.tabBar.setFocus(true)
        end if
    else if m.currentView = "library"
        ' Fall back to tab bar if grid hasn't loaded yet — empty grids
        ' silently reject setFocus.
        if m.libraryGrid.content <> invalid and m.libraryGrid.content.getChildCount() > 0
            m.libraryGrid.setFocus(true)
        else
            m.tabBar.setFocus(true)
        end if
    else if m.currentView = "search"
        ' Land on the input button so the user's first OK press opens
        ' the keyboard. After a search runs we keep focus there too —
        ' the user can scroll down via D-pad to results when ready.
        m.searchInputButton.setFocus(true)
    else if m.currentView = "sports"
        if m.sportsRowList.content <> invalid and m.sportsRowList.content.getChildCount() > 0
            m.sportsRowList.setFocus(true)
        else
            m.tabBar.setFocus(true)
        end if
    else if m.currentView = "settings"
        ' Land on Edit URL — first interactive control on the page.
        m.editApiUrlButton.setFocus(true)
    else if m.currentView = "userPicker"
        if m.userList.visible then m.userList.setFocus(true)
    else if m.currentView = "liveTv"
        ' Land on the channel list when it's already rendered. Before
        ' the /api/live/channels call returns the list is still hidden,
        ' so there's nothing to focus — eat the deferred focus.
        if m.channelList.visible then m.channelList.setFocus(true)
    else if m.currentView = "detail"
        m.detailActions.setFocus(true)
    else if m.currentView = "player"
        ' Focus the Video node so Roku's built-in transport overlay
        ' (enableUI=true) receives OK / Up / Down to show + interact.
        ' First Back press hides the overlay; second Back bubbles up
        ' to onKeyEvent which returns to detail.
        m.video.setFocus(true)
    end if
end sub

' ─── Detail view ───────────────────────────────────────────────────

sub populateDetail(node as object)
    m.selectedItem = node
    print "[populateDetail] source='"; node.itemSource; "' type='"; node.itemType; "' title='"; node.itemTitle; "' standardTitle='"; node.title; "' tmdb='"; node.itemTmdbId; "'"
    if node.itemBackdropUrl <> invalid and node.itemBackdropUrl <> ""
        m.detailBackdrop.uri = node.itemBackdropUrl
    else
        m.detailBackdrop.uri = ""
    end if

    title = node.itemShowTitle
    if title = invalid or title = "" then title = node.itemTitle
    m.detailTitle.text = title

    if node.itemShowTitle <> invalid and node.itemShowTitle <> "" and node.itemTitle <> invalid and node.itemTitle <> ""
        m.detailSubtitle.text = node.itemTitle
    else
        m.detailSubtitle.text = ""
    end if

    metaParts = []
    if node.itemYear <> invalid and node.itemYear <> "" and node.itemYear <> "0"
        metaParts.Push(node.itemYear)
    end if
    if node.itemDuration <> invalid and node.itemDuration <> "" and node.itemDuration <> "0"
        metaParts.Push(node.itemDuration + " min")
    end if
    if node.itemSource <> invalid and node.itemSource <> ""
        metaParts.Push(node.itemSource)
    end if
    m.detailMeta.text = joinStrings(metaParts, "  ·  ")

    if node.itemSummary <> invalid
        m.detailSummary.text = node.itemSummary
    else
        m.detailSummary.text = ""
    end if

    ' Library items (Plex/Jellyfin/Emby) are the only ones we can play
    ' or scrobble against — hide Play + Mark buttons for everything
    ' else (sports, sonarr, radarr, tracked).
    isLibraryItem = node.itemSource = "plex" or node.itemSource = "jellyfin" or node.itemSource = "emby"
    watched = node.itemWatched = true
    playButton = m.top.findNode("playButton")
    if playButton <> invalid then playButton.visible = isLibraryItem
    m.markWatchedButton.visible = isLibraryItem and not watched
    m.markUnwatchedButton.visible = isLibraryItem and watched

    ' Tracked items (TMDB-discovered, not yet downloaded) and Discover
    ' items (live TMDB search results) both get Add buttons routing to
    ' Sonarr (TV) or Radarr (Movie). Mirrors mobile's Discover & Track
    ' action sheet — same backend endpoints.
    isTrackedTv = node.itemSource = "tracked" and node.itemType = "tv"
    isTrackedMovie = node.itemSource = "tracked" and node.itemType = "movie"
    isDiscoverTv = node.itemSource = "discover" and node.itemType = "tv"
    isDiscoverMovie = node.itemSource = "discover" and node.itemType = "movie"
    alreadyTracked = node.itemTracked = true

    m.addSonarrButton.visible = isTrackedTv or isDiscoverTv
    m.addRadarrButton.visible = isTrackedMovie or isDiscoverMovie
    ' Track button: only Discover-mode TV results that aren't already
    ' tracked. Mobile parity — movies skip Track and go straight to
    ' Radarr; tracked items don't show Track since they're tracked
    ' already.
    m.trackButton.visible = isDiscoverTv and not alreadyTracked

    ' Reset the status row whenever we re-populate detail — clears any
    ' "Added to Sonarr" / error from a previous item.
    m.detailAddStatus.visible = false
    m.detailAddStatus.text = ""
end sub

' ─── Playback ──────────────────────────────────────────────────────

sub onPlayPressed()
    if m.selectedItem = invalid then return
    sourceId = m.selectedItem.itemSourceId
    src = m.selectedItem.itemSource
    if sourceId = invalid or sourceId = "" then return

    ' Source is always one of "plex" / "jellyfin" / "emby" — no encoding
    ' needed and we can't create an roUrlTransfer here anyway (the render
    ' thread isn't allowed to allocate one; CreateObject returns invalid).
    m.playbackTask = CreateObject("roSGNode", "ApiTask")
    m.playbackTask.observeField("response", "onPlaybackResponse")
    m.playbackTask.method = "GET"
    m.playbackTask.url = m.apiUrl + "/api/playback/" + sourceId + "?source=" + src
    setApiTaskAuth(m.playbackTask)
    m.playbackTask.control = "RUN"

    print "[HomeScene] requesting playback for "; sourceId; " ("; src; ")"
end sub

sub onPlaybackResponse()
    response = m.playbackTask.response
    if response = invalid or response.success <> true
        msg = "Playback failed"
        if response <> invalid and response.error <> invalid then msg = response.error
        print "[HomeScene] playback request failed: "; msg
        return
    end if

    info = response.data
    m.playbackInfo = info
    m.lastReportedPositionTime = 0
    ' Swap completed — restore normal Video.state="stopped" handling.
    m.swapping = false
    ' Reset marker state — new stream may have shifted timestamps
    ' relative to the old one, and we don't want a half-active skip
    ' button hanging around across a track swap.
    m.activeMarker = invalid
    m.dismissedUntilMs = invalid
    if m.skipButton <> invalid then m.skipButton.visible = false

    streamUrl = info.streamUrl
    if streamUrl = invalid or streamUrl = ""
        print "[HomeScene] playback response missing streamUrl"
        return
    end if

    content = CreateObject("roSGNode", "ContentNode")
    content.streamFormat = "hls"
    content.url = streamUrl

    ' contentType drives the Video node's transport UI. Without it
    ' Roku falls back to a minimal scrub-only overlay; with it we get
    ' the full play/pause + time codes + episode info layout that
    ' shows on play, hides after a few seconds, and re-shows on
    ' OK / Up / Down.
    titleStr = ""
    if info.title <> invalid then titleStr = info.title
    isEpisode = info.seasonNumber <> invalid and info.episodeNumber <> invalid
    if isEpisode
        content.contentType = "episode"
        if info.showTitle <> invalid then content.titleSeason = info.showTitle
        content.titleEpisode = titleStr
    else
        content.contentType = "movie"
    end if
    content.title = titleStr

    ' Duration in seconds — Roku shows a total-time readout on the
    ' transport bar when this is set.
    if info.duration <> invalid then content.length = Int(info.duration / 1000)

    ' Description in the info panel — falls back to the item's
    ' summary on the detail view.
    descStr = ""
    if info.summary <> invalid and info.summary <> "" then descStr = info.summary
    if descStr = "" and m.selectedItem <> invalid and m.selectedItem.itemSummary <> invalid
        descStr = m.selectedItem.itemSummary
    end if
    if descStr <> "" then content.description = descStr

    ' Resume position. Quality-swap takes priority — the local
    ' Video.position at swap time is more accurate than viewOffset
    ' (which only reflects the last reportProgress, up to 10s stale).
    resumeMs = invalid
    if m.qualitySwapResumeMs <> invalid and m.qualitySwapResumeMs > 0
        resumeMs = m.qualitySwapResumeMs
        m.qualitySwapResumeMs = invalid
    else if info.viewOffset <> invalid and info.viewOffset > 0
        resumeMs = info.viewOffset
    end if
    if resumeMs <> invalid then content.playStart = Int(resumeMs / 1000)

    m.video.content = content
    m.video.control = "play"

    ' Roku auto-shows the standard transport overlay when playback
    ' starts. Prime the "last player key" timestamp so the first Back
    ' press inside the auto-show window gets absorbed instead of
    ' exiting straight to detail.
    m.lastPlayerKeyAt = Uptime(0)
    showView("player")
end sub

sub onVideoStateChanged()
    state = m.video.state
    print "[HomeScene] video state -> "; state

    if state = "finished" or state = "stopped" or state = "error"
        ' Mid-swap — Video.control="stop" is part of a quality/track
        ' switch, NOT the user backing out. Skip the detail-return so
        ' the new playback can take over once the API call returns.
        ' onPlaybackResponse clears m.swapping after the new stream
        ' starts.
        if m.swapping = true then return

        ' Real stop — save final position + tell Plex we're done.
        reportProgress(true)
        sendStop()
        showView("detail")
    end if
end sub

sub onVideoPosition()
    posSeconds = m.video.position
    if posSeconds = invalid then return

    ' Throttle to one POST /playback/progress every ~10s while playing.
    if (posSeconds - m.lastReportedPositionTime) >= 10
        reportProgress(false)
        m.lastReportedPositionTime = posSeconds
    end if

    updateSkipButton(posSeconds)
end sub

sub reportProgress(stopped as boolean)
    if m.playbackInfo = invalid or m.selectedItem = invalid then return
    posMs = 0
    if m.video.position <> invalid then posMs = Int(m.video.position * 1000)
    duration = 0
    if m.playbackInfo.duration <> invalid then duration = m.playbackInfo.duration
    state = "playing"
    if stopped then state = "stopped"

    body = newPostBody()
    body["ratingKey"] = m.selectedItem.itemSourceId
    body["time"] = posMs
    body["duration"] = duration
    body["state"] = state
    body["sessionId"] = m.playbackInfo.sessionId
    body["source"] = m.selectedItem.itemSource

    progress = CreateObject("roSGNode", "ApiTask")
    progress.method = "POST"
    progress.url = m.apiUrl + "/api/playback/progress"
    progress.body = FormatJson(body)
    setApiTaskAuth(progress)
    progress.control = "RUN"
end sub

sub sendStop()
    if m.playbackInfo = invalid or m.selectedItem = invalid then return
    body = newPostBody()
    body["sessionId"] = m.playbackInfo.sessionId
    body["source"] = m.selectedItem.itemSource
    ' `stop` would shadow the BrightScript reserved word — use stopTask.
    stopTask = CreateObject("roSGNode", "ApiTask")
    stopTask.method = "POST"
    stopTask.url = m.apiUrl + "/api/playback/stop"
    stopTask.body = FormatJson(body)
    setApiTaskAuth(stopTask)
    stopTask.control = "RUN"
end sub

sub stopPlayback()
    m.video.control = "stop"
end sub

' ─── Quality picker ───────────────────────────────────────────────
'
' Mid-playback bitrate switch. Triggered by the "*" / Options key on
' the remote, drives a Roku Dialog with the preset list. On selection
' we save the local position, stop the current stream, re-issue
' /api/playback with ?maxBitrate=<kbps>, and onPlaybackResponse picks
' up m.qualitySwapResumeMs to start the new stream at the same spot.

sub openQualityPicker()
    if m.qualityDialog <> invalid then return
    if m.video.state = "playing" then m.video.control = "pause"

    dlg = CreateObject("roSGNode", "Dialog")
    dlg.title = "Video Quality"
    labels = []
    for each preset in m.qualityPresets
        labels.Push(preset.label)
    end for
    dlg.buttons = labels
    dlg.observeField("buttonSelected", "onQualityPicked")
    dlg.observeField("wasClosed", "onQualityPicked")
    m.qualityDialog = dlg
    m.top.dialog = dlg
end sub

sub onQualityPicked()
    if m.qualityDialog = invalid then return
    idx = m.qualityDialog.buttonSelected
    m.top.dialog = invalid
    m.qualityDialog = invalid

    ' Cancelled (Back-key dismiss) or out-of-range selection — resume
    ' the original stream at its current spot, no re-issue.
    if idx = invalid or idx < 0 or idx >= m.qualityPresets.Count()
        if m.video.state = "paused" then m.video.control = "resume"
        return
    end if

    preset = m.qualityPresets[idx]
    swapQuality(preset.maxBitrate)
end sub

sub swapQuality(maxBitrate as integer)
    if m.selectedItem = invalid then return
    sourceId = m.selectedItem.itemSourceId
    src = m.selectedItem.itemSource
    if sourceId = invalid or sourceId = "" then return

    ' Save local position so the re-issued stream resumes at the
    ' same spot — server's viewOffset can lag by up to 10s.
    resumeMs = 0
    if m.video.position <> invalid then resumeMs = Int(m.video.position * 1000)
    m.qualitySwapResumeMs = resumeMs

    ' Tell Plex to terminate the previous transcode session BEFORE
    ' starting a new one — without this Plex appears to inherit
    ' state (e.g. burned-in subtitles) from the still-active session.
    ' Mobile does this same step in its swap flow.
    m.swapping = true
    sendStop()

    m.video.control = "stop"
    print "[HomeScene] quality swap: maxBitrate="; maxBitrate; " resumeMs="; resumeMs

    m.playbackTask = CreateObject("roSGNode", "ApiTask")
    m.playbackTask.observeField("response", "onPlaybackResponse")
    m.playbackTask.method = "GET"
    m.playbackTask.url = m.apiUrl + "/api/playback/" + sourceId + "?source=" + src + "&maxBitrate=" + maxBitrate.toStr()
    setApiTaskAuth(m.playbackTask)
    m.playbackTask.control = "RUN"
end sub

' ─── Tracks picker (Audio + Subtitle), multi-select ──────────────
'
' Down key during playback opens a custom overlay with two LabelLists
' (Audio + Subtitle, including an "Off" entry for subtitles) and a
' Close button at the bottom. The user can change one or both
' selections without dismissing — current pending selections are
' marked with "★ " in the label text. Pressing Close commits BOTH
' pending changes as a single /api/playback re-issue. Pressing Back
' cancels without applying.

sub openTracksPicker()
    if m.tracksOpen = true then return
    if m.playbackInfo = invalid then return

    audios = m.playbackInfo.audioTracks
    subs = m.playbackInfo.subtitles
    audioCount = 0
    subCount = 0
    if audios <> invalid then audioCount = audios.Count()
    if subs <> invalid then subCount = subs.Count()
    if audioCount <= 1 and subCount = 0 then return

    if m.video.state = "playing" then m.video.control = "pause"

    ' Capture the player's current selections so Close can decide
    ' whether to re-issue (only when user actually changed something).
    m.currentAudioId = -1
    if audios <> invalid
        for each audio in audios
            if audio.selected = true then m.currentAudioId = Int(audio.id)
        end for
    end if
    m.pendingAudioId = m.currentAudioId

    m.currentSubtitleId = 0
    if subs <> invalid
        for each subTrack in subs
            if subTrack.selected = true then m.currentSubtitleId = Int(subTrack.id)
        end for
    end if
    m.pendingSubtitleId = m.currentSubtitleId

    renderTracksAudioList()
    renderTracksSubtitleList()

    m.tracksOpen = true
    m.tracksView.visible = true
    m.tracksAudioList.setFocus(true)
end sub

sub renderTracksAudioList()
    audios = m.playbackInfo.audioTracks
    rootNode = CreateObject("roSGNode", "ContentNode")
    if audios <> invalid
        for each audio in audios
            child = rootNode.createChild("ContentNode")
            prefix = "    "
            if Int(audio.id) = m.pendingAudioId then prefix = "★  "
            child.title = prefix + stringField(audio, "title")
            child.AddField("audioId", "integer", false)
            child.audioId = Int(audio.id)
        end for
    end if
    m.tracksAudioList.content = rootNode
end sub

sub renderTracksSubtitleList()
    subs = m.playbackInfo.subtitles
    rootNode = CreateObject("roSGNode", "ContentNode")

    ' "Off" entry first so users can quickly toggle subs off.
    offChild = rootNode.createChild("ContentNode")
    offPrefix = "    "
    if m.pendingSubtitleId = 0 then offPrefix = "★  "
    offChild.title = offPrefix + "Off"
    offChild.AddField("subtitleId", "integer", false)
    offChild.subtitleId = 0

    if subs <> invalid
        for each subTrack in subs
            child = rootNode.createChild("ContentNode")
            prefix = "    "
            if Int(subTrack.id) = m.pendingSubtitleId then prefix = "★  "
            child.title = prefix + stringField(subTrack, "title")
            child.AddField("subtitleId", "integer", false)
            child.subtitleId = Int(subTrack.id)
        end for
    end if
    m.tracksSubtitleList.content = rootNode
end sub

sub onTracksAudioItemSelected()
    idx = m.tracksAudioList.itemSelected
    rootNode = m.tracksAudioList.content
    if rootNode = invalid then return
    item = rootNode.getChild(idx)
    if item = invalid then return
    m.pendingAudioId = item.audioId
    renderTracksAudioList()
end sub

sub onTracksSubtitleItemSelected()
    idx = m.tracksSubtitleList.itemSelected
    rootNode = m.tracksSubtitleList.content
    if rootNode = invalid then return
    item = rootNode.getChild(idx)
    if item = invalid then return
    m.pendingSubtitleId = item.subtitleId
    renderTracksSubtitleList()
end sub

sub onTracksClosePressed()
    audioChanged = m.currentAudioId <> m.pendingAudioId
    subtitleChanged = m.currentSubtitleId <> m.pendingSubtitleId

    m.tracksOpen = false
    m.tracksView.visible = false

    if not audioChanged and not subtitleChanged
        ' No-op close — just resume the paused video.
        if m.video.state = "paused" then m.video.control = "resume"
        m.video.setFocus(true)
        return
    end if

    swapTracks(audioChanged, subtitleChanged)
end sub

sub cancelTracksView()
    m.tracksOpen = false
    m.tracksView.visible = false
    if m.video.state = "paused" then m.video.control = "resume"
    m.video.setFocus(true)
end sub

sub swapTracks(applyAudio as boolean, applySubtitle as boolean)
    if m.selectedItem = invalid then return
    sourceId = m.selectedItem.itemSourceId
    src = m.selectedItem.itemSource
    if sourceId = invalid or sourceId = "" then return

    resumeMs = 0
    if m.video.position <> invalid then resumeMs = Int(m.video.position * 1000)
    m.qualitySwapResumeMs = resumeMs

    ' Tell Plex to terminate the previous transcode session BEFORE
    ' starting a new one — without this the new transcode appears to
    ' inherit state (notably burned-in subtitles) from the still-
    ' active old session, which is exactly what's been blocking
    ' Subtitle: Off. Mobile does this same step.
    m.swapping = true
    sendStop()

    m.video.control = "stop"

    url = m.apiUrl + "/api/playback/" + sourceId + "?source=" + src
    if applyAudio then url = url + "&audioStreamID=" + m.pendingAudioId.toStr()
    if applySubtitle then url = url + "&subtitleStreamID=" + m.pendingSubtitleId.toStr()
    print "[HomeScene] tracks swap: "; url; " resumeMs="; resumeMs

    m.playbackTask = CreateObject("roSGNode", "ApiTask")
    m.playbackTask.observeField("response", "onPlaybackResponse")
    m.playbackTask.method = "GET"
    m.playbackTask.url = url
    setApiTaskAuth(m.playbackTask)
    m.playbackTask.control = "RUN"
end sub

' ─── Skip Intro / Skip Credits ────────────────────────────────────
'
' Plex returns intro / credits markers in the playback info. We watch
' Video.position via the existing onVideoPosition observer and show
' a focused "Skip Intro" / "Skip Credits" button while inside one.
' OK on the button seeks to the marker end. Back dismisses the button
' for the rest of that marker so users who want to watch the opening
' aren't pestered.

sub updateSkipButton(posSeconds as float)
    if m.skipButton = invalid then return
    if m.playbackInfo = invalid or m.playbackInfo.markers = invalid or m.playbackInfo.markers.Count() = 0
        if m.skipButton.visible = true then m.skipButton.visible = false
        m.activeMarker = invalid
        return
    end if

    posMs = posSeconds * 1000

    ' Honour user dismissal: don't re-show until we're past the
    ' marker the user dismissed.
    if m.dismissedUntilMs <> invalid
        if posMs >= m.dismissedUntilMs
            m.dismissedUntilMs = invalid
        end if
    end if

    foundMarker = invalid
    for each marker in m.playbackInfo.markers
        startMs = marker.startMs
        endMs = marker.endMs
        if startMs <> invalid and endMs <> invalid
            if posMs >= startMs and posMs < endMs
                foundMarker = marker
                exit for
            end if
        end if
    end for

    ' Skip if user has dismissed THIS marker.
    if foundMarker <> invalid and m.dismissedUntilMs <> invalid and m.dismissedUntilMs = foundMarker.endMs
        return
    end if

    if foundMarker <> invalid
        if m.activeMarker = invalid
            label = "Skip Intro"
            mtype = lcase(stringField(foundMarker, "type"))
            if mtype = "credits" then label = "Skip Credits"
            m.skipButton.text = label
            m.skipButton.visible = true
            m.skipButton.setFocus(true)
            m.activeMarker = foundMarker
        end if
    else
        if m.activeMarker <> invalid
            m.skipButton.visible = false
            m.activeMarker = invalid
            m.video.setFocus(true)
        end if
    end if
end sub

sub onSkipPressed()
    if m.activeMarker = invalid then return
    endSec = m.activeMarker.endMs / 1000.0
    print "[HomeScene] skip marker -> "; endSec
    m.video.seek = endSec
    m.skipButton.visible = false
    m.activeMarker = invalid
    m.video.setFocus(true)
end sub

' ─── Settings view ────────────────────────────────────────────────

sub populateSettings()
    m.settingsApiUrlValue.text = m.apiUrl
    m.settingsUserValue.text = displayUserName(m.userId, m.usersData)
    m.settingsConnectionValue.text = connectionDisplayName(m.connectionType)
    updateLiveTvSettingsLabel()
    if m.usersData = invalid then fetchUsers()

    ' Re-fetch update status every visit — the backend's poller
    ' refreshes lastCheckedAt asynchronously, so the user sees the
    ' current view rather than stale numbers from the last open.
    fetchUpdateStatus()
end sub

' ─── Server Updates section ───────────────────────────────────────
'
' Mirrors the mobile settings.tsx ServerUpdatesSection: read /api/update/status
' on view, "Check for Updates" hits POST /update/check, "Install Update"
' hits POST /update/apply. Hidden when platformSupported=false (non-Windows
' backend has no in-process updater).

sub fetchUpdateStatus()
    setUpdateStatusLoading()
    task = CreateObject("roSGNode", "ApiTask")
    task.observeField("response", "onUpdateStatusResponse")
    task.method = "GET"
    task.url = m.apiUrl + "/api/update/status"
    setApiTaskAuth(task)
    task.control = "RUN"
    m.updateStatusTask = task
end sub

sub onUpdateStatusResponse()
    if m.updateStatusTask = invalid then return
    resp = m.updateStatusTask.response
    m.updateStatusTask = invalid

    if resp = invalid or resp.success <> true or resp.data = invalid
        msg = "Couldn't load update status."
        if resp <> invalid and resp.error <> invalid then msg = msg + " " + resp.error.toStr()
        setUpdateStatusError(msg)
        return
    end if

    m.updateStatus = resp.data
    renderUpdateStatus()
end sub

sub setUpdateStatusLoading()
    m.settingsUpdateCurrentValue.text = "Loading…"
    m.settingsUpdateLatestValue.text = ""
    m.settingsUpdateCheckedValue.text = ""
    m.settingsUpdateMessage.text = ""
    m.installUpdateButton.visible = false
    setUpdateRowsVisible(true)
end sub

sub setUpdateStatusError(msg as string)
    m.settingsUpdateCurrentValue.text = "—"
    m.settingsUpdateLatestValue.text = ""
    m.settingsUpdateCheckedValue.text = ""
    m.settingsUpdateMessage.text = msg
    m.installUpdateButton.visible = false
    setUpdateRowsVisible(true)
end sub

sub setUpdateRowsVisible(show as boolean)
    m.settingsUpdateHeader.visible = show
    m.settingsUpdateCurrentLabel.visible = show
    m.settingsUpdateCurrentValue.visible = show
    m.settingsUpdateLatestLabel.visible = show
    m.settingsUpdateLatestValue.visible = show
    m.settingsUpdateCheckedLabel.visible = show
    m.settingsUpdateCheckedValue.visible = show
    m.checkUpdateButton.visible = show
end sub

sub renderUpdateStatus()
    s = m.updateStatus
    if s = invalid then return

    ' Linux/macOS backends report platformSupported=false. Hide the
    ' whole section in that case — there's nothing actionable to show.
    if s.platformSupported = false
        setUpdateRowsVisible(false)
        m.settingsUpdateMessage.text = ""
        m.installUpdateButton.visible = false
        return
    end if
    setUpdateRowsVisible(true)

    current = ""
    if s.currentVersion <> invalid then current = s.currentVersion.toStr()
    if current = "" then current = "—"
    m.settingsUpdateCurrentValue.text = current

    latestText = "—"
    if s.latestVersion <> invalid and s.latestVersion <> ""
        latestText = s.latestVersion.toStr()
        if s.updateAvailable = true then latestText = latestText + " (new)"
    end if
    m.settingsUpdateLatestValue.text = latestText

    checked = "Never"
    if s.lastCheckedAt <> invalid and s.lastCheckedAt <> "" then checked = formatLastChecked(s.lastCheckedAt.toStr())
    m.settingsUpdateCheckedValue.text = checked

    if s.lastError <> invalid and s.lastError <> ""
        m.settingsUpdateMessage.text = s.lastError.toStr()
    else
        m.settingsUpdateMessage.text = ""
    end if

    m.installUpdateButton.visible = (s.updateAvailable = true)
end sub

' ISO timestamp → "Apr 26, 11:42 PM" style. Roku has no Intl.DateTimeFormat,
' so we hand-roll a roDateTime conversion that the user can scan at a glance.
function formatLastChecked(iso as string) as string
    dt = CreateObject("roDateTime")
    dt.FromISO8601String(iso)
    if dt.AsSeconds() = 0 then return iso
    dt.ToLocalTime()

    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    monthIdx = dt.GetMonth() - 1
    if monthIdx < 0 or monthIdx > 11 then monthIdx = 0

    hours24 = dt.GetHours()
    suffix = "AM"
    hours12 = hours24
    if hours24 = 0
        hours12 = 12
    else if hours24 = 12
        suffix = "PM"
    else if hours24 > 12
        hours12 = hours24 - 12
        suffix = "PM"
    end if

    minutes = dt.GetMinutes().toStr()
    if Len(minutes) = 1 then minutes = "0" + minutes

    return months[monthIdx] + " " + dt.GetDayOfMonth().toStr() + ", " + hours12.toStr() + ":" + minutes + " " + suffix
end function

sub onCheckUpdatePressed()
    m.checkUpdateButton.text = "Checking…"
    m.settingsUpdateMessage.text = ""

    task = CreateObject("roSGNode", "ApiTask")
    task.observeField("response", "onCheckUpdateResponse")
    task.method = "POST"
    task.url = m.apiUrl + "/api/update/check"
    task.body = "{}"
    setApiTaskAuth(task)
    task.control = "RUN"
    m.checkUpdateTask = task
end sub

sub onCheckUpdateResponse()
    if m.checkUpdateTask = invalid then return
    resp = m.checkUpdateTask.response
    m.checkUpdateTask = invalid
    m.checkUpdateButton.text = "Check for Updates"

    if resp = invalid or resp.success <> true or resp.data = invalid
        msg = "Update check failed."
        if resp <> invalid and resp.error <> invalid then msg = msg + " " + resp.error.toStr()
        m.settingsUpdateMessage.text = msg
        return
    end if

    m.updateStatus = resp.data
    renderUpdateStatus()
end sub

sub onInstallUpdatePressed()
    m.installUpdateButton.text = "Starting…"
    m.settingsUpdateMessage.text = "Installer launching — server will restart in ~30 seconds."

    task = CreateObject("roSGNode", "ApiTask")
    task.observeField("response", "onInstallUpdateResponse")
    task.method = "POST"
    task.url = m.apiUrl + "/api/update/apply"
    task.body = "{}"
    setApiTaskAuth(task)
    task.control = "RUN"
    m.installUpdateTask = task
end sub

sub onInstallUpdateResponse()
    if m.installUpdateTask = invalid then return
    resp = m.installUpdateTask.response
    m.installUpdateTask = invalid
    m.installUpdateButton.text = "Install Update"

    if resp = invalid or resp.success <> true
        msg = "Couldn't start installer."
        if resp <> invalid and resp.error <> invalid then msg = msg + " " + resp.error.toStr()
        m.settingsUpdateMessage.text = msg
        return
    end if
    ' Success: leave the "installer launching" message up. Backend will
    ' restart shortly; subsequent API calls will fail until it's back.
end sub

function connectionDisplayName(t as string) as string
    if t = "remote" then return "Remote (via plex.tv relay)"
    return "Local (direct LAN)"
end function

sub onEditApiUrlPressed()
    print "[HomeScene] opening API URL keyboard, prefill="; m.apiUrl
    dlg = CreateObject("roSGNode", "KeyboardDialog")
    dlg.title = "Edit API URL"
    dlg.text = m.apiUrl
    dlg.buttons = ["Save", "Cancel"]
    dlg.observeField("buttonSelected", "onApiUrlKeyboardClosed")
    dlg.observeField("wasClosed", "onApiUrlKeyboardClosed")
    m.apiUrlDialog = dlg
    m.top.dialog = dlg
end sub

sub onApiUrlKeyboardClosed()
    if m.apiUrlDialog = invalid then return
    btn = m.apiUrlDialog.buttonSelected
    text = m.apiUrlDialog.text

    m.top.dialog = invalid
    m.apiUrlDialog = invalid
    ' Hand focus back to the Edit button via deferred focus.
    m.focusTimer.control = "start"

    if btn <> 0 then return
    if text = invalid then text = ""
    text = trimString(text)
    if text = "" then return

    newUrl = normalizeApiUrl(text)
    if newUrl = m.apiUrl then return
    print "[HomeScene] saving API URL: "; newUrl

    m.apiUrl = newUrl
    section = CreateObject("roRegistrySection", "whatson")
    if section <> invalid
        section.Write("apiUrl", newUrl)
        section.Flush()
    end if

    ' Every cached payload is now from the wrong server — wipe and
    ' refetch lazily as the user revisits each tab.
    if m.settingsApiUrlValue <> invalid then m.settingsApiUrlValue.text = newUrl
    m.homeStale = true
    m.tvStale = true
    m.moviesStale = true
    m.sportsStale = true
    m.libraryCache = { show: invalid, movie: invalid }
    m.usersData = invalid

    ' If we're stuck on the pair view, the URL change may unblock
    ' the flow — re-run the admin-status probe against the new server.
    if m.currentView = "pair"
        if m.pairPollTimer <> invalid then m.pairPollTimer.control = "stop"
        m.pairCode.text = ""
        m.pairStatus.text = "Checking " + m.apiUrl + "…"
        checkAdminStatus()
    end if
end sub

sub onConnectionTypeSelected()
    idx = m.connectionToggle.buttonSelected
    newType = "local"
    if idx = 1 then newType = "remote"
    if newType = m.connectionType then return
    print "[HomeScene] connectionType -> "; newType

    m.connectionType = newType
    section = CreateObject("roRegistrySection", "whatson")
    if section <> invalid
        section.Write("connectionType", newType)
        section.Flush()
    end if

    m.settingsConnectionValue.text = connectionDisplayName(newType)

    ' Plex picks a different connection now — invalidate library /
    ' home / playback caches. Sports/search are server-agnostic.
    m.homeStale = true
    m.tvStale = true
    m.moviesStale = true
    m.libraryCache = { show: invalid, movie: invalid }
end sub

' Switch User on Settings just navigates to the dedicated user picker
' view — same scene the boot flow shows when no Plex user is saved.
sub onSwitchUserPressed()
    showView("userPicker")
    if m.usersData = invalid then fetchUsers() else renderUserPickerList()
end sub

' ─── Live TV channel picker ───────────────────────────────────────
'
' Mirrors the mobile Settings → "Configure Channels" flow:
'   1. GET /api/live/channels → flat array of TVmaze network names.
'   2. Render a LabelList where each row shows "[X] Name" or "[ ] Name".
'   3. OK on a row toggles inclusion, rewrites the row's title in place,
'      and saves the updated CSV to the whatson registry section.
'   4. Mark home stale so the next Home visit refetches /api/live/now
'      and /api/live/later with the new channel set.

sub onConfigureChannelsPressed()
    showView("liveTv")
end sub

sub ensureChannelsLoaded()
    if m.liveTvAvailable <> invalid
        renderChannelList()
        return
    end if
    fetchChannels()
end sub

sub fetchChannels()
    m.liveTvViewStatus.visible = true
    m.liveTvViewStatus.text = "Loading channels…"
    m.channelList.visible = false

    task = CreateObject("roSGNode", "ApiTask")
    task.observeField("response", "onChannelsResponse")
    task.method = "GET"
    task.url = m.apiUrl + "/api/live/channels"
    setApiTaskAuth(task)
    task.control = "RUN"
    m.liveTvChannelsTask = task
end sub

sub onChannelsResponse()
    if m.liveTvChannelsTask = invalid then return
    resp = m.liveTvChannelsTask.response
    m.liveTvChannelsTask = invalid

    if resp = invalid or resp.success <> true or resp.data = invalid
        msg = "Couldn't load channels."
        if resp <> invalid and resp.error <> invalid then msg = msg + " " + resp.error.toStr()
        m.liveTvViewStatus.text = msg
        return
    end if

    m.liveTvAvailable = resp.data
    renderChannelList()
end sub

sub renderChannelList()
    if m.liveTvAvailable = invalid then return

    if m.liveTvAvailable.Count() = 0
        m.liveTvViewStatus.visible = true
        m.liveTvViewStatus.text = "No channels available. The backend hasn't seen any TVmaze schedule data yet."
        m.channelList.visible = false
        return
    end if

    rows = CreateObject("roSGNode", "ContentNode")
    for each channel in m.liveTvAvailable
        node = rows.createChild("ContentNode")
        enabled = false
        for each sel in m.liveTvChannels
            if sel = channel then enabled = true
        end for
        prefix = "[ ]  "
        if enabled then prefix = "[X]  "
        node.title = prefix + channel
    end for
    m.channelList.content = rows
    m.liveTvViewStatus.visible = false
    m.channelList.visible = true
    m.channelList.setFocus(true)
end sub

sub onChannelToggled()
    idx = m.channelList.itemSelected
    if idx < 0 or m.liveTvAvailable = invalid or idx >= m.liveTvAvailable.Count() then return
    channel = m.liveTvAvailable[idx]

    found = -1
    for i = 0 to m.liveTvChannels.Count() - 1
        if m.liveTvChannels[i] = channel then found = i
    end for

    if found >= 0
        m.liveTvChannels.Delete(found)
    else
        m.liveTvChannels.push(channel)
    end if

    ' Repaint the row in place so the checkbox flips without losing
    ' focus / scroll position. LabelList rows are plain strings — we
    ' just rewrite the title field on the corresponding ContentNode.
    rows = m.channelList.content
    if rows <> invalid and idx < rows.getChildCount()
        node = rows.getChild(idx)
        prefix = "[ ]  "
        if found < 0 then prefix = "[X]  "
        node.title = prefix + channel
    end if

    saveLiveTvChannels()
end sub

sub saveLiveTvChannels()
    csv = joinStrings(m.liveTvChannels, ",")
    section = CreateObject("roRegistrySection", "whatson")
    if section <> invalid
        section.Write("liveTvChannels", csv)
        section.Flush()
    end if
    updateLiveTvSettingsLabel()
    ' Home aggregator + live shelves are now out of date. Mark stale
    ' so the next Home visit refetches with the new channel set.
    m.homeStale = true
    print "[HomeScene] liveTvChannels saved: "; csv
end sub

sub updateLiveTvSettingsLabel()
    if m.settingsLiveTvValue = invalid then return
    count = 0
    if m.liveTvChannels <> invalid then count = m.liveTvChannels.Count()
    if count = 0
        m.settingsLiveTvValue.text = "No channels selected"
    else if count = 1
        m.settingsLiveTvValue.text = "1 channel selected"
    else
        m.settingsLiveTvValue.text = count.toStr() + " channels selected"
    end if
end sub

' ─── Pair view ────────────────────────────────────────────────────
'
' First-run flow when the backend has an admin password set:
'   1. POST /api/auth/pair/start → backend mints a 6-digit code (10m TTL)
'   2. Show the code on screen with the server URL the admin should
'      log into.
'   3. Poll GET /api/auth/pair/poll?code=XXXXXX every 3 seconds.
'   4. When the admin enters the code in /setup, the next poll returns
'      the auth key. Save it to registry, set m.authKey, dismiss the
'      pair view, continue boot.
'
' Code expires after 10 minutes; if poll comes back 410 we re-issue
' a fresh code automatically. OK on the remote forces a refresh too.

sub startPair()
    if m.pairPollTimer <> invalid then m.pairPollTimer.control = "stop"
    m.pairCode.text = ""
    m.pairStatus.text = "Connecting to " + m.apiUrl + "…"
    m.pairSubtitle.text = "Open " + m.apiUrl + "/setup in a browser, sign in as admin, then enter the code below under Security & Devices → Pair a new device."

    task = CreateObject("roSGNode", "ApiTask")
    task.observeField("response", "onPairStartResponse")
    task.method = "POST"
    task.url = m.apiUrl + "/api/auth/pair/start"
    task.body = FormatJson({ deviceLabel: deviceLabelString() })
    task.control = "RUN"
    m.pairStartTask = task
end sub

sub onPairStartResponse()
    if m.pairStartTask = invalid then return
    resp = m.pairStartTask.response
    m.pairStartTask = invalid

    if resp = invalid or resp.success <> true or resp.data = invalid or resp.data.code = invalid
        msg = "Couldn't request a pair code."
        if resp <> invalid and resp.error <> invalid then msg = msg + " " + resp.error.toStr()
        m.pairStatus.text = msg
        return
    end if

    m.pairCode.text = resp.data.code.toStr()
    m.pairStatus.text = "Waiting for the admin to enter this code…"

    ' 3-second poll. roSG Timer durations are seconds (float).
    if m.pairPollTimer = invalid
        m.pairPollTimer = CreateObject("roSGNode", "Timer")
        m.pairPollTimer.duration = 3
        m.pairPollTimer.repeat = true
        m.pairPollTimer.observeField("fire", "onPairPollTick")
    end if
    m.pairPollTimer.control = "start"
end sub

sub onPairPollTick()
    code = ""
    if m.pairCode <> invalid and m.pairCode.text <> invalid then code = m.pairCode.text
    if code = ""
        ' Nothing to poll for — wait for startPair to finish.
        return
    end if
    ' If a poll is already in flight, skip this tick.
    if m.pairPollTask <> invalid then return

    task = CreateObject("roSGNode", "ApiTask")
    task.observeField("response", "onPairPollResponse")
    task.method = "GET"
    task.url = m.apiUrl + "/api/auth/pair/poll?code=" + code
    task.control = "RUN"
    m.pairPollTask = task
end sub

sub onPairPollResponse()
    if m.pairPollTask = invalid then return
    resp = m.pairPollTask.response
    m.pairPollTask = invalid

    if resp = invalid then return

    ' Backend returns 410 with { data: { status: "expired" } } when the
    ' code has expired. ApiTask coerces non-2xx into success=false; we
    ' detect via the parsed data.status when present.
    expired = false
    if resp.data <> invalid and resp.data.status = "expired" then expired = true
    if resp.success <> true and resp.status = 410 then expired = true

    if expired
        if m.pairPollTimer <> invalid then m.pairPollTimer.control = "stop"
        m.pairStatus.text = "Code expired — requesting a new one…"
        startPair()
        return
    end if

    if resp.success = true and resp.data <> invalid and resp.data.status = "completed" and resp.data.key <> invalid
        finishPair(resp.data.key.toStr())
        return
    end if

    ' Pending — leave UI as-is, next tick will re-poll.
end sub

sub finishPair(authKey as string)
    if m.pairPollTimer <> invalid then m.pairPollTimer.control = "stop"

    m.authKey = authKey
    writeOk = false
    flushOk = false
    verifyExists = false
    verifyHead = ""
    section = CreateObject("roRegistrySection", "whatson")
    if section <> invalid
        writeOk = section.Write("authKey", authKey)
        flushOk = section.Flush()
        ' Read back through a brand-new section object so we're not just
        ' hitting an in-memory cache on the section we just wrote to.
        verifySection = CreateObject("roRegistrySection", "whatson")
        if verifySection <> invalid and verifySection.Exists("authKey")
            verifyExists = true
            v = verifySection.Read("authKey")
            if Len(v) >= 8 then verifyHead = Left(v, 8) else verifyHead = v
        end if
    end if
    m.pairStatus.text = "Paired! Continuing…"
    head = ""
    if Len(authKey) >= 8 then head = Left(authKey, 8) else head = authKey
    print "[HomeScene] paired write="; writeOk; " flush="; flushOk; " verifyExists="; verifyExists
    print "[HomeScene] paired key head="; head; " verifyHead="; verifyHead
    ' Dev convenience: full cleartext key. Roku dev installs wipe
    ' registry on redeploy, so add this to setroku.ps1 as
    ' $env:ROKU_AUTH_KEY and the channel will skip the pair view next
    ' time. Production installs don't lose registry — this print is
    ' harmless either way (only the device owner sees telnet logs).
    print "[HomeScene] paired FULL KEY (copy into setroku.ps1 ROKU_AUTH_KEY): "; authKey

    ' Resume the boot flow that was deferred while the pair view was up.
    ' Always go through showView so the pair view actually hides — the
    ' home / userPicker views were toggled OFF when we entered "pair",
    ' so direct calls to startInitialFetches alone leave the pair
    ' overlay still on screen.
    if m.userId = invalid or m.userId = ""
        showView("userPicker")
        fetchUsers()
    else
        showView("home")
        startInitialFetches()
    end if
end sub

' Friendly device label so the admin knows which device they're approving
' when multiple Rokus pair against the same backend.
function deviceLabelString() as string
    di = CreateObject("roDeviceInfo")
    name = di.GetFriendlyName()
    model = di.GetModelDisplayName()
    if name <> invalid and name <> ""
        if model <> invalid and model <> "" then return name + " (" + model + ")"
        return name
    end if
    if model <> invalid and model <> "" then return "Roku " + model
    return "Roku"
end function

' ─── User picker view ─────────────────────────────────────────────
'
' Boot flow: shown automatically when no plexUserId is saved.
' Switch User flow: invoked from Settings → Switch User.
' Either way, picking a user persists to registry and routes to home.

sub fetchUsers()
    m.userPickerStatus.text = "Loading users…"
    m.userPickerStatus.visible = true
    m.userList.visible = false

    task = CreateObject("roSGNode", "ApiTask")
    task.observeField("response", "onUsersResponse")
    task.method = "GET"
    task.url = m.apiUrl + "/api/users"
    setApiTaskAuth(task)
    task.control = "RUN"
    m.usersTask = task
end sub

sub onUsersResponse()
    response = m.usersTask.response
    if response = invalid or response.success <> true or response.data = invalid
        m.userPickerStatus.text = "Couldn't load users from " + m.apiUrl
        return
    end if
    m.usersData = response.data

    ' Refresh Settings label if visible — display name may have just
    ' become known.
    if m.currentView = "settings" then m.settingsUserValue.text = displayUserName(m.userId, m.usersData)

    ' If we're sitting on the picker, populate it now.
    if m.currentView = "userPicker" then renderUserPickerList()
end sub

sub renderUserPickerList()
    rootNode = CreateObject("roSGNode", "ContentNode")
    for each user in m.usersData
        item = rootNode.createChild("ContentNode")
        item.title = stringField(user, "title")
        item.AddField("userId", "string", false)
        item.userId = stringField(user, "id")
    end for
    m.userList.content = rootNode
    m.userPickerStatus.visible = false
    m.userList.visible = true
    m.userList.setFocus(true)
end sub

sub onUserPicked()
    idx = m.userList.itemSelected
    rootNode = m.userList.content
    if rootNode = invalid then return
    item = rootNode.getChild(idx)
    if item = invalid then return

    newUserId = item.userId
    if newUserId = "" then return

    print "[HomeScene] user picked: "; newUserId
    sameUser = (newUserId = m.userId)
    m.userId = newUserId

    ' Persist for next launch.
    section = CreateObject("roRegistrySection", "whatson")
    if section <> invalid
        section.Write("plexUserId", newUserId)
        section.Flush()
    end if

    ' Update Settings labels in case the user lands there next.
    m.settingsUserValue.text = displayUserName(newUserId, m.usersData)

    ' First-time pick: kick off home/sports fetches that were deferred
    ' during boot. Subsequent re-pick: just invalidate caches so the
    ' next visit to each tab reflects the new user.
    if not m.initialFetchDone
        startInitialFetches()
    else if not sameUser
        m.homeStale = true
        m.tvStale = true
        m.moviesStale = true
        m.libraryCache = { show: invalid, movie: invalid }
    end if

    showView("home")
end sub

function displayUserName(userId as string, users as object) as string
    if userId = invalid or userId = "" then return "(none)"
    if users <> invalid
        for each u in users
            if stringField(u, "id") = userId then return stringField(u, "title")
        end for
    end if
    return userId
end function

' ─── Helpers ───────────────────────────────────────────────────────

function itemDisplayTitle(item as object) as string
    if item.showTitle <> invalid and item.showTitle <> "" then return item.showTitle
    if item.title <> invalid then return item.title
    return ""
end function

function itemDescription(item as object) as string
    if item.summary <> invalid then return item.summary
    return ""
end function

' Pull every field DetailScene cares about off the JSON `item` and stamp
' it on the ContentNode `child`. Single helper used by both home and
' library content-tree builders so we never miss a field on one side.
sub attachItemFields(child as object, item as object)
    child.AddField("itemSource", "string", false)
    child.AddField("itemSourceId", "string", false)
    child.AddField("itemTitle", "string", false)
    child.AddField("itemShowTitle", "string", false)
    child.AddField("itemSummary", "string", false)
    child.AddField("itemYear", "string", false)
    child.AddField("itemDuration", "string", false)
    child.AddField("itemBackdropUrl", "string", false)
    child.AddField("itemType", "string", false)
    child.AddField("itemWatched", "boolean", false)
    ' Progress percentage 0..100, drives the PosterItem progress bar
    ' on Continue Watching cards. Plex/Jellyfin/Emby items report this
    ' directly; non-library items leave it at 0 → no bar rendered.
    child.AddField("itemProgress", "float", false)

    child.itemSource = stringField(item, "source")
    child.itemSourceId = stringField(item, "sourceId")
    child.itemTitle = stringField(item, "title")
    child.itemShowTitle = stringField(item, "showTitle")
    child.itemSummary = stringField(item, "summary")
    child.itemYear = stringField(item, "year")
    child.itemDuration = stringField(item, "duration")
    child.itemType = stringField(item, "type")
    child.itemBackdropUrl = resolveBackdropUrl(item)

    watched = false
    progress = 0
    if item.progress <> invalid
        if item.progress.watched <> invalid then watched = item.progress.watched
        if item.progress.percentage <> invalid then progress = item.progress.percentage
    end if
    child.itemWatched = watched
    child.itemProgress = progress
end sub

function stringField(item as object, name as string) as string
    v = item[name]
    if v = invalid then return ""
    if type(v) = "Integer" or type(v) = "roInteger" then return Str(v).Trim()
    return v.toStr()
end function

function joinStrings(arr as object, sep as string) as string
    out = ""
    for i = 0 to arr.Count() - 1
        if i > 0 then out = out + sep
        out = out + arr[i]
    end for
    return out
end function

' Poster cells render at 160×240 (well, 180×240 in some contexts) —
' add `&w=360` so the proxy serves a 2× retina-ish resize instead of
' the upstream's 2000×3000 originals. Cuts texture-cache pressure
' so much that scroll-back posters stop going blank on the Express.
'
' Absolute http(s) URLs (TMDB direct from sports / recommendations)
' get rewritten through /api/artwork too — otherwise Roku would load
' the 2000×3000 master and evict cached posters under memory pressure.
function resolvePosterUrl(item as object) as string
    artwork = item.artwork
    if artwork = invalid then return ""
    poster = artwork.poster
    if poster = invalid or poster = "" then return ""
    if Left(poster, 4) = "http" then return proxiedArtworkUrl(poster, 360)
    if Left(poster, 1) = "/" then return withAuthQuery(m.apiUrl + poster + "&w=360")
    return poster
end function

' Detail-view backdrop is a fullscreen 1920×1080 image. Pass the same
' width hint so we don't pay the cost of downloading a 3840×2160
' upstream master only to scale it down on the device.
function resolveBackdropUrl(item as object) as string
    artwork = item.artwork
    if artwork = invalid then return ""
    bg = artwork.background
    if bg = invalid or bg = "" then bg = artwork.thumbnail
    if bg = invalid or bg = "" then return ""
    if Left(bg, 4) = "http" then return proxiedArtworkUrl(bg, 1920)
    if Left(bg, 1) = "/" then return withAuthQuery(m.apiUrl + bg + "&w=1920")
    return bg
end function

' Wrap an absolute upstream URL in the backend's resize proxy + auth
' query. Used for sports / recommendation cards whose backend payload
' includes raw https://image.tmdb.org/.../original/... URLs that would
' otherwise hammer the Roku texture cache at 2000×3000.
function proxiedArtworkUrl(absoluteUrl as string, width as integer) as string
    if absoluteUrl = "" or m.apiUrl = "" then return absoluteUrl
    return withAuthQuery(m.apiUrl + "/api/artwork?url=" + urlEncodeQuery(absoluteUrl) + "&w=" + width.toStr())
end function

' Roku Poster nodes fetch images via the platform image loader, which
' doesn't let us attach an X-Whatson-Auth header. Append the key as a
' query parameter so the backend's apiAuth middleware can authenticate
' the request through its query-fallback path.
function withAuthQuery(url as string) as string
    if m.authKey = invalid or m.authKey = "" then return url
    sep = "&"
    if Instr(1, url, "?") = 0 then sep = "?"
    return url + sep + "auth=" + m.authKey
end function

' Stamp the per-user + per-connection auth headers onto an ApiTask.
' Centralises the values so the connection-type toggle in Settings
' takes effect on every subsequent API call without having to rewire
' every task creation site.
sub setApiTaskAuth(task as object)
    if task = invalid then return
    task.userId = m.userId
    task.connectionType = m.connectionType
    if m.authKey <> invalid then task.authKey = m.authKey
end sub

' Defensive URL normalisation. Handles three forms users typo most.
function normalizeApiUrl(url as dynamic) as string
    if url = invalid then return ""
    s = url
    if s = "" then return ""

    if Instr(1, s, "://") = 0
        if Left(s, 6) = "https:" then s = Mid(s, 7)
        if Left(s, 5) = "http:" then s = Mid(s, 6)
        s = "http://" + s
    end if

    if Right(s, 1) = "/" then s = Left(s, Len(s) - 1)
    return s
end function

