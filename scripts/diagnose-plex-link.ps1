<#
.SYNOPSIS
  Diagnose intermittent "connect ETIMEDOUT <plex>:32400" from the Whats On backend PC.

.DESCRIPTION
  Ping succeeding does not prove the Plex port is reachable: ICMP is answered by
  the Plex machine's kernel, while the backend needs a TCP handshake with the
  Plex process on port 32400. This script samples, side by side, every few
  seconds:

    * ICMP ping                       (is the host up?)
    * raw TCP connect to the port     (does Plex accept the connection?)
    * HTTP GET /identity              (does Plex answer a request?)
    * ARP MAC for the Plex IP         (does the MAC flip?  -> IP conflict)
    * route / source interface used   (does it flip?  -> Hyper-V vSwitch / multi-NIC)
    * TCP connections from THIS PC to Plex by state, and how many belong to the
      Whats On backend process        (connection bursts / SYN_SENT pile-up)

  It also runs a one-off burst test (N simultaneous TCP connects) to see whether
  Plex drops connections under concurrency the way a poster grid load would.

  Everything is logged to a CSV and a summary with hints is printed at the end
  (also on Ctrl+C).

  Run it ON THE BACKEND PC (192.168.1.181), in PowerShell, while the problem is
  happening. Let it run at least 10 minutes. Admin is not required.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\diagnose-plex-link.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\diagnose-plex-link.ps1 -Target 192.168.1.79 -Minutes 20 -Burst 100
#>
param(
  [string]$Target = '192.168.1.79',
  [int]$Port = 32400,
  [int]$Minutes = 15,
  [int]$IntervalSec = 2,
  [int]$TimeoutMs = 3000,
  [int]$Burst = 50,
  [string]$OutFile = (Join-Path ([Environment]::GetFolderPath('Desktop')) ("plex-link-{0:yyyyMMdd-HHmmss}.csv" -f (Get-Date)))
)

$ErrorActionPreference = 'Continue'

function Write-Section($text) { Write-Host ''; Write-Host "== $text ==" -ForegroundColor Cyan }

function Test-Ping {
  $p = New-Object System.Net.NetworkInformation.Ping
  try {
    $r = $p.Send($Target, 1000)
    if ($r.Status -eq 'Success') { return @{ ok = $true; ms = [int]$r.RoundtripTime; err = '' } }
    return @{ ok = $false; ms = -1; err = [string]$r.Status }
  } catch { return @{ ok = $false; ms = -1; err = $_.Exception.InnerException.Message } }
  finally { $p.Dispose() }
}

function Test-Tcp {
  $c = New-Object System.Net.Sockets.TcpClient
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $task = $c.ConnectAsync($Target, $Port)
    $done = $task.Wait($TimeoutMs)
    $sw.Stop()
    if ($done -and $c.Connected) { return @{ ok = $true; ms = [int]$sw.ElapsedMilliseconds; err = '' } }
    if (-not $done) { return @{ ok = $false; ms = [int]$sw.ElapsedMilliseconds; err = 'timeout (no SYN-ACK)' } }
    return @{ ok = $false; ms = [int]$sw.ElapsedMilliseconds; err = 'not connected' }
  } catch {
    $sw.Stop()
    $m = $_.Exception.Message
    if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
    if ($_.Exception.InnerException -and $_.Exception.InnerException.InnerException) { $m = $_.Exception.InnerException.InnerException.Message }
    return @{ ok = $false; ms = [int]$sw.ElapsedMilliseconds; err = $m }
  } finally { $c.Close() }
}

function Test-Http {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $req = [System.Net.HttpWebRequest]::Create("http://${Target}:${Port}/identity")
    $req.Timeout = $TimeoutMs + 2000
    $req.ReadWriteTimeout = $TimeoutMs + 2000
    $req.KeepAlive = $false
    $resp = $req.GetResponse()
    $code = [int]$resp.StatusCode
    $resp.Close()
    $sw.Stop()
    return @{ ok = ($code -eq 200); ms = [int]$sw.ElapsedMilliseconds; err = $(if ($code -eq 200) { '' } else { "HTTP $code" }) }
  } catch {
    $sw.Stop()
    return @{ ok = $false; ms = [int]$sw.ElapsedMilliseconds; err = $_.Exception.InnerException.Message }
  }
}

function Get-Mac {
  $n = Get-NetNeighbor -IPAddress $Target -ErrorAction SilentlyContinue | Where-Object { $_.LinkLayerAddress -and $_.LinkLayerAddress -ne '00-00-00-00-00-00' } | Select-Object -First 1
  if ($n) { return "$($n.LinkLayerAddress)/$($n.State)/$($n.InterfaceAlias)" }
  return 'none'
}

function Get-RouteInfo {
  try {
    $r = Find-NetRoute -RemoteIPAddress $Target -ErrorAction Stop
    $src = ($r | Where-Object { $_.IPAddress } | Select-Object -First 1).IPAddress
    $ifc = ($r | Where-Object { $_.InterfaceAlias } | Select-Object -First 1).InterfaceAlias
    return "$ifc via $src"
  } catch { return 'unknown' }
}

$backendPids = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'whatson' -or $_.ProcessName -eq 'node' } | ForEach-Object { $_.Id })

function Get-ConnCounts {
  $conns = @(Get-NetTCPConnection -RemoteAddress $Target -RemotePort $Port -ErrorAction SilentlyContinue)
  $by = @{}
  foreach ($c in $conns) { $k = [string]$c.State; if ($by.ContainsKey($k)) { $by[$k]++ } else { $by[$k] = 1 } }
  $mine = @($conns | Where-Object { $backendPids -contains $_.OwningProcess }).Count
  $syn = 0; if ($by.ContainsKey('SynSent')) { $syn = $by['SynSent'] }
  $est = 0; if ($by.ContainsKey('Established')) { $est = $by['Established'] }
  $tw = 0; if ($by.ContainsKey('TimeWait')) { $tw = $by['TimeWait'] }
  return @{ total = $conns.Count; syn = $syn; est = $est; tw = $tw; backend = $mine }
}

# ---------------------------------------------------------------------------
Write-Section "Environment on $env:COMPUTERNAME"
Write-Host "Target: ${Target}:${Port}   sampling every ${IntervalSec}s for ${Minutes} min   CSV: $OutFile"
Write-Host "Backend process ids watched: $(if ($backendPids.Count) { $backendPids -join ',' } else { 'none found (whatson*/node)' })"

$lanIps = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like '192.168.1.*' })
Write-Host "This PC's 192.168.1.x addresses:"
$lanIps | ForEach-Object { Write-Host ("   {0,-16} on {1}" -f $_.IPAddress, $_.InterfaceAlias) }
if ($lanIps.Count -gt 1) { Write-Host "   !! More than one interface on the LAN subnet - replies can come back on a different NIC than requests left on." -ForegroundColor Yellow }

$lanRoutes = @(Get-NetRoute -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.DestinationPrefix -like '192.168.1.*' -and $_.DestinationPrefix -notlike '*/32' })
Write-Host "Routes to the LAN subnet:"
$lanRoutes | ForEach-Object { Write-Host ("   {0,-18} if={1,-30} metric={2}" -f $_.DestinationPrefix, $_.InterfaceAlias, ($_.RouteMetric + $_.InterfaceMetric)) }
Write-Host "Route used for ${Target}: $(Get-RouteInfo)"
Write-Host "ARP for ${Target}: $(Get-Mac)"

if (Get-Command Get-VMSwitch -ErrorAction SilentlyContinue) {
  try {
    Get-VMSwitch -ErrorAction Stop | ForEach-Object { Write-Host ("Hyper-V switch: {0} ({1}) mgmt-OS-shared={2} NIC={3}" -f $_.Name, $_.SwitchType, $_.AllowManagementOS, $_.NetAdapterInterfaceDescription) }
  } catch { Write-Host "Hyper-V switches: (need admin to list)" }
}

$profiles = Get-NetConnectionProfile -ErrorAction SilentlyContinue
$profiles | ForEach-Object { Write-Host ("Network profile: {0} on {1}" -f $_.NetworkCategory, $_.InterfaceAlias) }

# ---------------------------------------------------------------------------
$burstResult = $null
if ($Burst -gt 0) {
  Write-Section "Burst test: $Burst simultaneous TCP connects"
  $clients = @(); $tasks = @()
  $sw = [Diagnostics.Stopwatch]::StartNew()
  for ($i = 0; $i -lt $Burst; $i++) {
    $c = New-Object System.Net.Sockets.TcpClient
    $clients += $c
    $tasks += $c.ConnectAsync($Target, $Port)
  }
  try { [void][System.Threading.Tasks.Task]::WaitAll($tasks, $TimeoutMs * 2) } catch {}
  $sw.Stop()
  $okCount = @($clients | Where-Object { $_.Connected }).Count
  $clients | ForEach-Object { $_.Close() }
  $burstResult = "$okCount/$Burst connected in $($sw.ElapsedMilliseconds) ms"
  $color = 'Green'; if ($okCount -lt $Burst) { $color = 'Red' }
  Write-Host "   $burstResult" -ForegroundColor $color
  if ($okCount -lt $Burst) { Write-Host "   !! Plex (or something in front of it) drops connections under concurrency." -ForegroundColor Yellow }
}

# ---------------------------------------------------------------------------
Write-Section "Sampling (Ctrl+C to stop early; summary still prints)"
Write-Host ("{0,-8} {1,-12} {2,-26} {3,-12} {4,-30} {5}" -f 'time', 'ping', 'tcp', 'http', 'arp', 'conns(total/syn/est/tw/backend)')

$rows = New-Object System.Collections.ArrayList
$end = (Get-Date).AddMinutes($Minutes)
$lastMac = $null; $lastRoute = $null
try {
  while ((Get-Date) -lt $end) {
    $now = Get-Date
    $ping = Test-Ping
    $tcp = Test-Tcp
    $httpR = Test-Http
    $mac = Get-Mac
    $route = Get-RouteInfo
    $cc = Get-ConnCounts

    $row = [pscustomobject]@{
      time = $now.ToString('o')
      ping_ok = $ping.ok; ping_ms = $ping.ms; ping_err = $ping.err
      tcp_ok = $tcp.ok; tcp_ms = $tcp.ms; tcp_err = $tcp.err
      http_ok = $httpR.ok; http_ms = $httpR.ms; http_err = $httpR.err
      arp = $mac; route = $route
      conns_total = $cc.total; conns_synsent = $cc.syn; conns_established = $cc.est; conns_timewait = $cc.tw; conns_backend = $cc.backend
    }
    [void]$rows.Add($row)
    $row | Export-Csv -Path $OutFile -NoTypeInformation -Append

    $pingTxt = $(if ($ping.ok) { "ok $($ping.ms)ms" } else { "FAIL" })
    $tcpTxt = $(if ($tcp.ok) { "ok $($tcp.ms)ms" } else { "FAIL $($tcp.err)" })
    $httpTxt = $(if ($httpR.ok) { "ok $($httpR.ms)ms" } else { "FAIL" })
    $line = "{0,-8} {1,-12} {2,-26} {3,-12} {4,-30} {5}/{6}/{7}/{8}/{9}" -f $now.ToString('HH:mm:ss'), $pingTxt, $tcpTxt, $httpTxt, $mac, $cc.total, $cc.syn, $cc.est, $cc.tw, $cc.backend
    $color = 'Gray'
    if (-not $tcp.ok -or -not $httpR.ok) { $color = 'Red' } elseif ($tcp.ms -gt 500 -or $httpR.ms -gt 1000) { $color = 'Yellow' }
    Write-Host $line -ForegroundColor $color

    if ($lastMac -and $mac -ne 'none' -and $lastMac -ne 'none' -and ($mac.Split('/')[0] -ne $lastMac.Split('/')[0])) {
      Write-Host "   !! ARP MAC for $Target changed: $lastMac -> $mac  (IP conflict?)" -ForegroundColor Yellow
    }
    if ($lastRoute -and $route -ne $lastRoute) { Write-Host "   !! Route changed: $lastRoute -> $route" -ForegroundColor Yellow }
    if ($mac -ne 'none') { $lastMac = $mac }
    $lastRoute = $route

    $sleep = $IntervalSec * 1000 - ((Get-Date) - $now).TotalMilliseconds
    if ($sleep -gt 0) { Start-Sleep -Milliseconds ([int]$sleep) }
  }
} finally {
  # -------------------------------------------------------------------------
  Write-Section "Summary"
  $n = $rows.Count
  if ($n -eq 0) { Write-Host "No samples." } else {
  $pingFail = @($rows | Where-Object { -not $_.ping_ok }).Count
  $tcpFail = @($rows | Where-Object { -not $_.tcp_ok }).Count
  $httpFail = @($rows | Where-Object { -not $_.http_ok }).Count
  $pingOkTcpFail = @($rows | Where-Object { $_.ping_ok -and -not $_.tcp_ok }).Count
  $tcpOkHttpFail = @($rows | Where-Object { $_.tcp_ok -and -not $_.http_ok }).Count
  $macs = @($rows | ForEach-Object { $_.arp.Split('/')[0] } | Where-Object { $_ -ne 'none' } | Sort-Object -Unique)
  $routes = @($rows | ForEach-Object { $_.route } | Sort-Object -Unique)
  $maxSyn = ($rows | Measure-Object conns_synsent -Maximum).Maximum
  $maxBackend = ($rows | Measure-Object conns_backend -Maximum).Maximum
  $maxTotal = ($rows | Measure-Object conns_total -Maximum).Maximum
  $tcpMsOk = @($rows | Where-Object { $_.tcp_ok } | ForEach-Object { $_.tcp_ms })
  $tcpAvg = 0; if ($tcpMsOk.Count) { $tcpAvg = [int](($tcpMsOk | Measure-Object -Average).Average) }

  Write-Host "Samples:                 $n over $([int](((Get-Date) - [datetime]$rows[0].time).TotalMinutes)) min"
  Write-Host "Ping failures:           $pingFail"
  Write-Host "TCP connect failures:    $tcpFail   (avg connect when ok: $tcpAvg ms)"
  Write-Host "HTTP /identity failures: $httpFail"
  Write-Host "Ping OK but TCP failed:  $pingOkTcpFail"
  Write-Host "TCP OK but HTTP failed:  $tcpOkHttpFail"
  Write-Host "Distinct ARP MACs:       $($macs -join ', ')"
  Write-Host "Distinct routes:         $($routes -join ' | ')"
  Write-Host "Max conns to Plex:       total=$maxTotal  syn_sent=$maxSyn  from backend=$maxBackend"
  if ($burstResult) { Write-Host "Burst test:              $burstResult" }
  Write-Host "CSV:                     $OutFile"

  Write-Section "What it points to"
  $hint = $false
  if ($macs.Count -gt 1) { $hint = $true; Write-Host "* Two MACs answered for $Target - an IP CONFLICT. Another device has $Target. Give Plex a DHCP reservation / find the other device." -ForegroundColor Yellow }
  if ($routes.Count -gt 1) { $hint = $true; Write-Host "* The route to $Target changed between interfaces - multi-NIC / Hyper-V vSwitch issue on this PC." -ForegroundColor Yellow }
  if ($pingFail -gt 0 -and $tcpFail -gt 0) { $hint = $true; Write-Host "* Ping ALSO fails at times - general link loss (Wi-Fi on the Plex machine, sleep, cable, switch port)." -ForegroundColor Yellow }
  if ($pingOkTcpFail -gt 0 -and $pingFail -eq 0) { $hint = $true; Write-Host "* Host stays up but port $Port stops accepting: Plex's accept queue is full or a firewall on the Plex machine drops new connections. Compare failure times with the conns column / backend activity." -ForegroundColor Yellow }
  if ($maxSyn -gt 5 -or $maxBackend -gt 30) { $hint = $true; Write-Host "* Large connection pile-ups from this PC (syn_sent=$maxSyn, backend=$maxBackend). The backend is opening many connections at once (poster bursts) - likely triggering the drops." -ForegroundColor Yellow }
  if ($tcpOkHttpFail -gt 0) { $hint = $true; Write-Host "* TCP connects but Plex doesn't answer HTTP - Plex itself is stalling (CPU/disk, scanning, transcoding)." -ForegroundColor Yellow }
  if (-not $hint -and $tcpFail -eq 0) { Write-Host "* No failures from this script. If the backend still logs ETIMEDOUT during this window, the problem is the backend's own connection pattern (bursts), not the network." -ForegroundColor Yellow }
  }
}
