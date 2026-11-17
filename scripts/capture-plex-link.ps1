<#
.SYNOPSIS
  Packet-level follow-up to diagnose-plex-link.ps1: find WHERE the backend PC's
  TCP connections to Plex are being lost.

.DESCRIPTION
  diagnose-plex-link.ps1 showed: ping to Plex always works, but most TCP
  connects to Plex:32400 get no SYN-ACK, and successful ones often needed a
  1-second SYN retransmit. This script captures those handshakes with Windows'
  built-in Packet Monitor (pktmon) at every layer of this PC's network stack
  (physical NIC -> Hyper-V virtual switch -> vEthernet host adapter -> TCP/IP)
  so we can see whether Plex's SYN-ACK:

    * never arrives at the physical NIC   -> lost on the Plex machine / network
    * arrives at the NIC but is dropped    -> Hyper-V vSwitch / NIC offload on THIS PC
      before reaching vEthernet

  It also records this PC's NIC / Hyper-V switch / offload settings (VMQ, RSC,
  LSO, checksum offload, teaming), the usual suspects for "ping works, some TCP
  connections vanish" on a Hyper-V host.

  Output goes to a folder on the Desktop; send the whole folder back.

  MUST be run as Administrator (pktmon requires it), ON THE BACKEND PC.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\capture-plex-link.ps1
#>
param(
  [string]$Target = '192.168.1.79',
  [int]$Port = 32400,
  [int]$Attempts = 40,
  [int]$TimeoutMs = 3000,
  [string]$OutDir = (Join-Path ([Environment]::GetFolderPath('Desktop')) ("plex-capture-{0:yyyyMMdd-HHmmss}" -f (Get-Date)))
)

$ErrorActionPreference = 'Continue'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "Run this from an elevated PowerShell (Run as Administrator) - pktmon needs it." -ForegroundColor Red
  exit 1
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
function Write-Section($text) { Write-Host ''; Write-Host "== $text ==" -ForegroundColor Cyan }
function Save($name, $obj) { $obj | Out-String -Width 250 | Out-File -FilePath (Join-Path $OutDir $name) -Encoding utf8 }

# ---------------------------------------------------------------------------
Write-Section "1. Network configuration on $env:COMPUTERNAME"
$cfg = New-Object System.Text.StringBuilder
function Add-Cfg($title, $block) {
  [void]$cfg.AppendLine("##### $title")
  try { [void]$cfg.AppendLine((& $block | Out-String -Width 250)) } catch { [void]$cfg.AppendLine("  (error: $($_.Exception.Message))") }
}
Add-Cfg 'Adapters' { Get-NetAdapter -IncludeHidden | Sort-Object Name | Format-Table Name, InterfaceDescription, Status, MacAddress, LinkSpeed, ifIndex -AutoSize }
Add-Cfg 'IPv4 addresses' { Get-NetIPAddress -AddressFamily IPv4 | Format-Table IPAddress, InterfaceAlias, PrefixLength, AddressState -AutoSize }
Add-Cfg 'Hyper-V switches' { Get-VMSwitch | Format-List Name, SwitchType, AllowManagementOS, NetAdapterInterfaceDescription, EmbeddedTeamingEnabled, IovEnabled, BandwidthReservationMode }
Add-Cfg 'Hyper-V switch teams (SET)' { Get-VMSwitchTeam | Format-List * }
Add-Cfg 'Host (management OS) vNICs' { Get-VMNetworkAdapter -ManagementOS | Format-Table Name, SwitchName, MacAddress, Status, VmqWeight, IsLegacy -AutoSize }
Add-Cfg 'VM vNICs' { Get-VMNetworkAdapter -VMName * | Format-Table VMName, SwitchName, MacAddress, MacAddressSpoofing, IPAddresses -AutoSize }
Add-Cfg 'LBFO teams' { Get-NetLbfoTeam | Format-List * }
Add-Cfg 'VMQ' { Get-NetAdapterVmq | Format-Table Name, InterfaceDescription, Enabled, BaseVmqProcessor, MaxProcessors, NumberOfReceiveQueues -AutoSize }
Add-Cfg 'RSC (receive segment coalescing)' { Get-NetAdapterRsc | Format-Table Name, IPv4Enabled, IPv6Enabled, IPv4OperationalState -AutoSize }
Add-Cfg 'vSwitch RSC' { Get-VMSwitch | Format-Table Name, SoftwareRscEnabled -AutoSize }
Add-Cfg 'LSO' { Get-NetAdapterLso | Format-Table Name, V1IPv4Enabled, IPv4Enabled, IPv6Enabled -AutoSize }
Add-Cfg 'Checksum offload' { Get-NetAdapterChecksumOffload | Format-Table Name, IpIPv4Enabled, TcpIPv4Enabled, UdpIPv4Enabled -AutoSize }
Add-Cfg 'RSS' { Get-NetAdapterRss | Format-Table Name, Enabled, Profile, NumberOfReceiveQueues -AutoSize }
Add-Cfg 'Physical NIC advanced properties' { Get-NetAdapter -Physical | ForEach-Object { Get-NetAdapterAdvancedProperty -Name $_.Name } | Format-Table Name, DisplayName, DisplayValue -AutoSize }
Add-Cfg 'Global TCP settings' { Get-NetTCPSetting -SettingName Internet, Datacenter -ErrorAction SilentlyContinue | Format-List SettingName, AutoTuningLevelLocal, EcnCapability, Timestamps, InitialRto }
Add-Cfg 'netsh tcp global' { netsh int tcp show global }
Add-Cfg 'Neighbor entry for target' { Get-NetNeighbor -IPAddress $Target | Format-Table IPAddress, LinkLayerAddress, State, InterfaceAlias -AutoSize }
Add-Cfg 'Route to target' { Find-NetRoute -RemoteIPAddress $Target | Format-List }
Add-Cfg 'Firewall profiles' { Get-NetFirewallProfile | Format-Table Name, Enabled, DefaultInboundAction, DefaultOutboundAction -AutoSize }
$cfg.ToString() | Out-File -FilePath (Join-Path $OutDir 'network-config.txt') -Encoding utf8
Write-Host "Saved network-config.txt"

$vmq = @(Get-NetAdapterVmq -ErrorAction SilentlyContinue | Where-Object { $_.Enabled })
if ($vmq.Count) { Write-Host ("VMQ ENABLED on: " + (($vmq | ForEach-Object { $_.Name }) -join ', ')) -ForegroundColor Yellow }
$rsc = @(Get-VMSwitch -ErrorAction SilentlyContinue | Where-Object { $_.SoftwareRscEnabled })
if ($rsc.Count) { Write-Host ("vSwitch software RSC ENABLED on: " + (($rsc | ForEach-Object { $_.Name }) -join ', ')) -ForegroundColor Yellow }

# ---------------------------------------------------------------------------
Write-Section "2. Packet capture of $Attempts TCP connects to ${Target}:${Port}"
$etl = Join-Path $OutDir 'capture.etl'
pktmon stop 2>&1 | Out-Null
pktmon filter remove 2>&1 | Out-Null
pktmon filter add PlexTCP -i $Target -t TCP -p $Port | Out-Null
pktmon filter add PlexICMP -i $Target -t ICMP | Out-Null
pktmon list 2>&1 | Out-File -FilePath (Join-Path $OutDir 'pktmon-components.txt') -Encoding utf8
pktmon start --capture --comp all --type all --pkt-size 128 --file-name $etl 2>&1 | Out-File -FilePath (Join-Path $OutDir 'pktmon-start.txt') -Encoding utf8

$attemptsLog = New-Object System.Collections.ArrayList
try {
  for ($i = 1; $i -le $Attempts; $i++) {
    $c = New-Object System.Net.Sockets.TcpClient
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $ok = $false; $err = ''
    try {
      $task = $c.ConnectAsync($Target, $Port)
      if ($task.Wait($TimeoutMs) -and $c.Connected) { $ok = $true } else { $err = 'timeout' }
    } catch { $err = 'error' }
    $sw.Stop()
    $localPort = 0
    try { if ($c.Client -and $c.Client.LocalEndPoint) { $localPort = $c.Client.LocalEndPoint.Port } } catch {}
    if ($localPort -eq 0) {
      # Pending (failed) connect - find our SYN_SENT socket's port
      $pending = Get-NetTCPConnection -RemoteAddress $Target -RemotePort $Port -State SynSent -OwningProcess $PID -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($pending) { $localPort = $pending.LocalPort }
    }
    $c.Close()
    [void]$attemptsLog.Add([pscustomobject]@{ n = $i; time = (Get-Date).ToString('HH:mm:ss.fff'); ok = $ok; ms = [int]$sw.ElapsedMilliseconds; localPort = $localPort; err = $err })
    $color = 'Green'; if (-not $ok) { $color = 'Red' } elseif ($sw.ElapsedMilliseconds -gt 500) { $color = 'Yellow' }
    Write-Host ("  #{0,-3} port {1,-6} {2,-6} {3} ms" -f $i, $localPort, $(if ($ok) { 'ok' } else { 'FAIL' }), $sw.ElapsedMilliseconds) -ForegroundColor $color
    [void](New-Object System.Net.NetworkInformation.Ping).Send($Target, 1000)
    Start-Sleep -Milliseconds 700
  }
} finally {
  pktmon counters 2>&1 | Out-File -FilePath (Join-Path $OutDir 'pktmon-counters.txt') -Encoding utf8
  pktmon stop 2>&1 | Out-File -FilePath (Join-Path $OutDir 'pktmon-stop.txt') -Encoding utf8
  pktmon filter remove 2>&1 | Out-Null
}
$attemptsLog | Export-Csv -Path (Join-Path $OutDir 'attempts.csv') -NoTypeInformation

# ---------------------------------------------------------------------------
Write-Section "3. Converting capture"
$txt = Join-Path $OutDir 'capture.txt'
$pcap = Join-Path $OutDir 'capture.pcapng'
pktmon format $etl -o $txt 2>&1 | Out-Null
if (-not (Test-Path $txt)) { pktmon etl2txt $etl -o $txt 2>&1 | Out-Null }
pktmon pcapng $etl -o $pcap 2>&1 | Out-Null
if (-not (Test-Path $pcap)) { pktmon etl2pcap $etl -o $pcap 2>&1 | Out-Null }
Write-Host "capture.txt: $(Test-Path $txt)   capture.pcapng (open in Wireshark): $(Test-Path $pcap)"

# ---------------------------------------------------------------------------
Write-Section "4. Analysis"
# Component id -> name, from `pktmon list`
$compNames = @{}
foreach ($line in (Get-Content (Join-Path $OutDir 'pktmon-components.txt'))) {
  if ($line -match '^\s*(\d+)\s+(?:[0-9A-Fa-f]{2}(?:-[0-9A-Fa-f]{2}){5}\s+)?(\S.*?)\s*$') { $compNames[[int]$Matches[1]] = $Matches[2] }
}
function CompName($id) { if ($compNames.ContainsKey([int]$id)) { return "$id $($compNames[[int]$id])" } return "$id" }

# pktmon text: a header line ("... Direction Rx , ... Component 12, ...") followed
# by a decoded line ("... 192.168.1.79.32400 > 192.168.1.181.51234: Flags [S.], ...").
# Drop events carry "Drop" in the header with a reason.
$events = New-Object System.Collections.ArrayList
$drops = New-Object System.Collections.ArrayList
if (Test-Path $txt) {
  $hdr = $null
  foreach ($line in (Get-Content $txt)) {
    if ($line -match 'Component (\d+)') {
      $dir = ''; if ($line -match 'Direction (\w+)') { $dir = $Matches[1] }
      $hdr = @{ comp = [int]$Matches[1]; dir = $dir; drop = ($line -match 'Drop'); raw = $line }
      if ($hdr.drop) { [void]$drops.Add($line.Trim()) }
      continue
    }
    if ($hdr -and $line -match '(\d+\.\d+\.\d+\.\d+)\.(\d+) > (\d+\.\d+\.\d+\.\d+)\.(\d+): Flags \[([^\]]+)\]') {
      [void]$events.Add([pscustomobject]@{ comp = $hdr.comp; dir = $hdr.dir; drop = $hdr.drop; src = $Matches[1]; sport = [int]$Matches[2]; dst = $Matches[3]; dport = [int]$Matches[4]; flags = $Matches[5] })
      $hdr = $null
    }
  }
}
Write-Host "Parsed $($events.Count) TCP packet sightings, $($drops.Count) drop events."

$report = New-Object System.Text.StringBuilder
function R($s) { [void]$report.AppendLine($s); Write-Host $s }

$failed = @($attemptsLog | Where-Object { -not $_.ok })
$slow = @($attemptsLog | Where-Object { $_.ok -and $_.ms -gt 500 })
R "Attempts: $($attemptsLog.Count)  failed: $($failed.Count)  slow (>500ms): $($slow.Count)"

$noSynAck = 0; $synAckDroppedLocally = 0
foreach ($a in ($failed + $slow)) {
  if (-not $a.localPort) { continue }
  $syn = @($events | Where-Object { $_.sport -eq $a.localPort -and $_.dport -eq $Port -and $_.flags -eq 'S' })
  $synack = @($events | Where-Object { $_.dport -eq $a.localPort -and $_.sport -eq $Port -and $_.flags -match '^S\.' })
  $synComps = ($syn | ForEach-Object { CompName $_.comp } | Sort-Object -Unique) -join '; '
  $ackComps = ($synack | ForEach-Object { CompName $_.comp } | Sort-Object -Unique) -join '; '
  $state = 'FAIL'; if ($a.ok) { $state = "SLOW $($a.ms)ms" }
  R ("  #{0} port {1} [{2}]  SYN sent x{3} seen at: {4}" -f $a.n, $a.localPort, $state, $syn.Count, $(if ($synComps) { $synComps } else { '(none)' }))
  R ("        SYN-ACK x{0} seen at: {1}" -f $synack.Count, $(if ($ackComps) { $ackComps } else { '(none - never reached this PC)' }))
  if ($synack.Count -eq 0) { $noSynAck++ } else { $synAckDroppedLocally++ }
}
R ''
if ($drops.Count) {
  R "Drop events reported by pktmon (first 20):"
  $drops | Select-Object -First 20 | ForEach-Object { R "  $_" }
  R ''
}
R "Verdict:"
if ($failed.Count -eq 0 -and $slow.Count -eq 0) {
  R "  No failures during this capture - re-run while the problem is active."
} elseif ($synAckDroppedLocally -gt 0 -or $drops.Count -gt 0) {
  R "  Plex's SYN-ACK DID reach this PC but was lost inside its network stack (see components / drop events)."
  R "  -> Hyper-V vSwitch / NIC offload problem on THIS PC. Usual fixes: disable VMQ on the physical NIC"
  R "     (Disable-NetAdapterVmq -Name '<physical NIC>'), disable vSwitch software RSC"
  R "     (Set-VMSwitch -Name '<switch>' -EnableSoftwareRsc `$false), update the NIC driver."
} else {
  R "  Plex's SYN-ACK NEVER reached this PC's physical NIC, though the SYNs left it."
  R "  -> Lost on the Plex machine or between it and the network: check the Mac's firewall /"
  R "     security or VPN software (anything filtering per source IP), and run"
  R "     'sudo tcpdump -ni en0 host 192.168.1.181 and port $Port' on the Mac while this runs"
  R "     to see whether the SYNs arrive there and whether it answers."
}
$report.ToString() | Out-File -FilePath (Join-Path $OutDir 'analysis.txt') -Encoding utf8

Write-Section "Done"
Write-Host "Folder: $OutDir"
Write-Host "Send back analysis.txt, network-config.txt, pktmon-counters.txt (and capture.pcapng if possible)."
