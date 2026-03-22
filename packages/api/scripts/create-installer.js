#!/usr/bin/env node

/**
 * Create platform-specific installers for the Whats On API.
 *
 * Prerequisites:
 *   - Run build-standalone.js first to create the executable
 *
 * Creates:
 *   Windows: NSIS installer (.exe) or portable .zip
 *   macOS:   .pkg installer with launchd service
 *   Linux:   .deb and .rpm packages with systemd service (requires fpm)
 *
 * Usage:
 *   node scripts/create-installer.js
 */

const { execSync } = require('child_process');
const { writeFileSync, existsSync, mkdirSync, copyFileSync, readFileSync } = require('fs');
const { join, resolve } = require('path');
const { platform } = require('os');

const ROOT = resolve(__dirname, '..');
const STANDALONE = join(ROOT, 'standalone');
const INSTALLERS = join(ROOT, 'installers');
const os = platform();
const exeName = os === 'win32' ? 'whatson-api.exe' : 'whatson-api';
const EXE = join(STANDALONE, exeName);
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version || '0.1.0';

if (!existsSync(EXE)) {
  console.error(`❌ Standalone executable not found: ${EXE}`);
  console.error('   Run: node scripts/build-standalone.js');
  process.exit(1);
}

mkdirSync(INSTALLERS, { recursive: true });

// ── Shared: .env.example ──
const envExample = join(ROOT, '.env.example');

// ── Windows Installer (NSIS script or portable zip) ──
if (os === 'win32') {
  createWindowsInstaller();
}

// ── macOS Installer (.pkg) ──
if (os === 'darwin') {
  createMacInstaller();
}

// ── Linux Installer (.deb / .rpm) ──
if (os === 'linux') {
  createLinuxInstaller();
}

// Also create a portable zip on all platforms
createPortableZip();

// ────────────────────────────────────────

function createWindowsInstaller() {
  console.log('\n🪟 Creating Windows installer...\n');

  // Check for NSSM — needed for proper Windows Service support
  const nssmExe = join(ROOT, 'tools', 'nssm.exe');
  const hasNssm = existsSync(nssmExe);
  if (!hasNssm) {
    console.log('⚠ NSSM not found at tools/nssm.exe — service install will use sc.exe fallback');
    console.log('  For proper service support, run: npm run service:install (downloads NSSM)');
  }

  // Create NSIS script
  const nssmFileDirective = hasNssm ? `File "${nssmExe.replace(/\\/g, '\\\\')}"` : '';
  const nssmInstallCmd = hasNssm
    ? `
  ; Create ProgramData directory for config and logs
  CreateDirectory "$COMMONFILES\\\\..\\\\..\\\\ProgramData\\\\WhatsOn"

  ; Copy .env to ProgramData if it doesn't exist there
  IfFileExists "$COMMONFILES\\\\..\\\\..\\\\ProgramData\\\\WhatsOn\\\\.env" +2
    CopyFiles "$INSTDIR\\\\.env.example" "$COMMONFILES\\\\..\\\\..\\\\ProgramData\\\\WhatsOn\\\\.env"

  ; Install as Windows Service using NSSM
  nsExec::ExecToLog '"$INSTDIR\\\\nssm.exe" install whatson-api "$INSTDIR\\\\${exeName}"'
  nsExec::ExecToLog '"$INSTDIR\\\\nssm.exe" set whatson-api AppDirectory "$INSTDIR"'
  nsExec::ExecToLog '"$INSTDIR\\\\nssm.exe" set whatson-api DisplayName "Whats On API"'
  nsExec::ExecToLog '"$INSTDIR\\\\nssm.exe" set whatson-api Description "Whats On media aggregation backend API"'
  nsExec::ExecToLog '"$INSTDIR\\\\nssm.exe" set whatson-api Start SERVICE_AUTO_START'
  nsExec::ExecToLog '"$INSTDIR\\\\nssm.exe" set whatson-api AppEnvironmentExtra DATA_DIR=$COMMONFILES\\\\..\\\\..\\\\ProgramData\\\\WhatsOn LOG_FILE=$COMMONFILES\\\\..\\\\..\\\\ProgramData\\\\WhatsOn\\\\whatson-api.log'
  nsExec::ExecToLog '"$INSTDIR\\\\nssm.exe" start whatson-api'`
    : `
  ; Fallback: basic sc.exe service (may not work for all executables)
  nsExec::ExecToLog 'sc create whatson-api binPath= "$INSTDIR\\\\${exeName}" start= auto DisplayName= "Whats On API"'
  nsExec::ExecToLog 'sc start whatson-api'`;

  const nssmUninstallCmd = hasNssm
    ? `
  nsExec::ExecToLog '"$INSTDIR\\\\nssm.exe" stop whatson-api'
  nsExec::ExecToLog '"$INSTDIR\\\\nssm.exe" remove whatson-api confirm'`
    : `
  nsExec::ExecToLog 'sc stop whatson-api'
  nsExec::ExecToLog 'sc delete whatson-api'`;

  const nsisScript = `
!include "MUI2.nsh"

Name "Whats On API"
OutFile "${join(INSTALLERS, `whatson-api-${VERSION}-setup.exe`).replace(/\\/g, '\\\\')}"
InstallDir "$PROGRAMFILES\\\\WhatsOn"
RequestExecutionLevel admin

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File "${EXE.replace(/\\/g, '\\\\')}"
  File "${envExample.replace(/\\/g, '\\\\')}"
  ${nssmFileDirective}

  ; Create .env from example if it doesn't exist
  IfFileExists "$INSTDIR\\\\.env" +2
    CopyFiles "$INSTDIR\\\\.env.example" "$INSTDIR\\\\.env"
  ${nssmInstallCmd}

  ; Create uninstaller
  WriteUninstaller "$INSTDIR\\\\uninstall.exe"

  ; Add to Add/Remove Programs
  WriteRegStr HKLM "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\WhatsOnAPI" "DisplayName" "Whats On API"
  WriteRegStr HKLM "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\WhatsOnAPI" "UninstallString" "$INSTDIR\\\\uninstall.exe"
  WriteRegStr HKLM "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\WhatsOnAPI" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\WhatsOnAPI" "Publisher" "Whats On"
SectionEnd

Section "Uninstall"
  ; Stop and remove service
  ${nssmUninstallCmd}

  Delete "$INSTDIR\\\\${exeName}"
  Delete "$INSTDIR\\\\.env.example"
  Delete "$INSTDIR\\\\.env"
  Delete "$INSTDIR\\\\nssm.exe"
  Delete "$INSTDIR\\\\whatson-api.log"
  Delete "$INSTDIR\\\\uninstall.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKLM "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\WhatsOnAPI"
SectionEnd
`;

  const nsisPath = join(INSTALLERS, 'whatson-api.nsi');
  writeFileSync(nsisPath, nsisScript, 'utf-8');

  // Try to build with NSIS
  try {
    execSync(`makensis "${nsisPath}"`, { stdio: 'inherit' });
    console.log(`✅ Windows installer: ${join(INSTALLERS, `whatson-api-${VERSION}-setup.exe`)}`);
  } catch {
    console.log('⚠ NSIS not found. Install from https://nsis.sourceforge.io/');
    console.log(`  NSIS script saved to: ${nsisPath}`);
    console.log('  Build manually: makensis whatson-api.nsi');
  }
}

function createMacInstaller() {
  console.log('\n🍎 Creating macOS installer...\n');

  const pkgRoot = join(INSTALLERS, 'macos-pkg');
  const payloadDir = join(pkgRoot, 'payload', 'usr', 'local', 'bin');
  const scriptsDir = join(pkgRoot, 'scripts');
  const launchdDir = join(pkgRoot, 'payload', 'Library', 'LaunchDaemons');

  mkdirSync(payloadDir, { recursive: true });
  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(launchdDir, { recursive: true });

  // Copy executable
  copyFileSync(EXE, join(payloadDir, 'whatson-api'));

  // Create launchd plist
  writeFileSync(join(launchdDir, 'com.whatson.api.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.whatson.api</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/whatson-api</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/usr/local/etc/whatson</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/usr/local/var/log/whatson-api.log</string>
    <key>StandardErrorPath</key>
    <string>/usr/local/var/log/whatson-api.log</string>
</dict>
</plist>`, 'utf-8');

  // Create postinstall script
  writeFileSync(join(scriptsDir, 'postinstall'), `#!/bin/bash
mkdir -p /usr/local/etc/whatson
if [ ! -f /usr/local/etc/whatson/.env ]; then
  cp /usr/local/etc/whatson/.env.example /usr/local/etc/whatson/.env 2>/dev/null || true
fi
chmod 755 /usr/local/bin/whatson-api
launchctl load -w /Library/LaunchDaemons/com.whatson.api.plist
`, 'utf-8');
  execSync(`chmod +x "${join(scriptsDir, 'postinstall')}"`, { stdio: 'pipe' });

  // Create preremove script
  writeFileSync(join(scriptsDir, 'preinstall'), `#!/bin/bash
launchctl unload /Library/LaunchDaemons/com.whatson.api.plist 2>/dev/null || true
`, 'utf-8');
  execSync(`chmod +x "${join(scriptsDir, 'preinstall')}"`, { stdio: 'pipe' });

  // Build .pkg
  const pkgOutput = join(INSTALLERS, `whatson-api-${VERSION}.pkg`);
  try {
    execSync([
      'pkgbuild',
      `--root "${join(pkgRoot, 'payload')}"`,
      `--scripts "${scriptsDir}"`,
      '--identifier com.whatson.api',
      `--version ${VERSION}`,
      `"${pkgOutput}"`,
    ].join(' '), { stdio: 'inherit' });
    console.log(`✅ macOS installer: ${pkgOutput}`);
  } catch (e) {
    console.error('❌ pkgbuild failed:', e.message);
  }
}

function createLinuxInstaller() {
  console.log('\n🐧 Creating Linux packages...\n');

  // Create systemd unit file
  const unitFile = `[Unit]
Description=Whats On API - Media Aggregation Backend
After=network.target

[Service]
Type=simple
User=whatson
ExecStart=/opt/whatson/whatson-api
WorkingDirectory=/opt/whatson
Restart=on-failure
RestartSec=5
EnvironmentFile=-/opt/whatson/.env

[Install]
WantedBy=multi-user.target
`;

  // Try fpm for both .deb and .rpm
  const hasFpm = (() => { try { execSync('fpm --version', { stdio: 'pipe' }); return true; } catch { return false; } })();

  if (!hasFpm) {
    console.log('⚠ fpm not found. Install with: gem install fpm');
    console.log('  Saving systemd unit file for manual packaging...');
    writeFileSync(join(INSTALLERS, 'whatson-api.service'), unitFile, 'utf-8');
    return;
  }

  // Create staging directory
  const staging = join(INSTALLERS, 'linux-staging');
  mkdirSync(join(staging, 'opt', 'whatson'), { recursive: true });
  mkdirSync(join(staging, 'etc', 'systemd', 'system'), { recursive: true });

  copyFileSync(EXE, join(staging, 'opt', 'whatson', 'whatson-api'));
  execSync(`chmod +x "${join(staging, 'opt', 'whatson', 'whatson-api')}"`, { stdio: 'pipe' });
  copyFileSync(envExample, join(staging, 'opt', 'whatson', '.env.example'));
  writeFileSync(join(staging, 'etc', 'systemd', 'system', 'whatson-api.service'), unitFile, 'utf-8');

  const afterInstall = join(INSTALLERS, 'after-install.sh');
  writeFileSync(afterInstall, `#!/bin/bash
useradd -r -s /bin/false whatson 2>/dev/null || true
chown -R whatson:whatson /opt/whatson
if [ ! -f /opt/whatson/.env ]; then
  cp /opt/whatson/.env.example /opt/whatson/.env
  chown whatson:whatson /opt/whatson/.env
fi
systemctl daemon-reload
systemctl enable whatson-api
systemctl start whatson-api
`, 'utf-8');

  const beforeRemove = join(INSTALLERS, 'before-remove.sh');
  writeFileSync(beforeRemove, `#!/bin/bash
systemctl stop whatson-api 2>/dev/null || true
systemctl disable whatson-api 2>/dev/null || true
`, 'utf-8');

  // Build .deb
  try {
    execSync([
      'fpm -s dir -t deb',
      `-n whatson-api -v ${VERSION}`,
      '--description "Whats On media aggregation backend API"',
      '--maintainer "Whats On <noreply@whatson.app>"',
      `--after-install "${afterInstall}"`,
      `--before-remove "${beforeRemove}"`,
      `-C "${staging}"`,
      `-p "${join(INSTALLERS, `whatson-api-${VERSION}.deb`)}"`,
      '.',
    ].join(' '), { stdio: 'inherit' });
    console.log(`✅ Debian package: whatson-api-${VERSION}.deb`);
  } catch (e) {
    console.error('❌ .deb build failed:', e.message);
  }

  // Build .rpm
  try {
    execSync([
      'fpm -s dir -t rpm',
      `-n whatson-api -v ${VERSION}`,
      '--description "Whats On media aggregation backend API"',
      `--after-install "${afterInstall}"`,
      `--before-remove "${beforeRemove}"`,
      `-C "${staging}"`,
      `-p "${join(INSTALLERS, `whatson-api-${VERSION}.rpm`)}"`,
      '.',
    ].join(' '), { stdio: 'inherit' });
    console.log(`✅ RPM package: whatson-api-${VERSION}.rpm`);
  } catch (e) {
    console.error('❌ .rpm build failed:', e.message);
  }
}

function createPortableZip() {
  console.log('\n📦 Creating portable archive...\n');

  const archiveName = `whatson-api-${VERSION}-${os}-portable`;
  const archiveDir = join(INSTALLERS, archiveName);
  mkdirSync(archiveDir, { recursive: true });

  copyFileSync(EXE, join(archiveDir, exeName));
  copyFileSync(envExample, join(archiveDir, '.env.example'));

  // Create a README for portable usage
  writeFileSync(join(archiveDir, 'README.txt'), `Whats On API v${VERSION} — Portable Edition

Setup:
1. Copy .env.example to .env
2. Edit .env with your Plex/Sonarr/Radarr details
3. Run ${exeName}

The API will start on port 3001 (or whatever PORT is set in .env).
`, 'utf-8');

  if (os === 'win32') {
    // Create a zip using PowerShell
    try {
      execSync(`powershell -Command "Compress-Archive -Path '${archiveDir}\\*' -DestinationPath '${join(INSTALLERS, archiveName + '.zip')}' -Force"`, { stdio: 'inherit' });
      console.log(`✅ Portable: ${archiveName}.zip`);
    } catch {
      console.log(`⚠ Could not create zip. Portable files in: ${archiveDir}`);
    }
  } else {
    try {
      execSync(`tar -czf "${join(INSTALLERS, archiveName + '.tar.gz')}" -C "${INSTALLERS}" "${archiveName}"`, { stdio: 'inherit' });
      console.log(`✅ Portable: ${archiveName}.tar.gz`);
    } catch {
      console.log(`⚠ Could not create archive. Portable files in: ${archiveDir}`);
    }
  }
}
