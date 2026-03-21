#!/usr/bin/env node

/**
 * Cross-platform service installer for Whats On API.
 * Installs/uninstalls the backend as a system service that runs
 * in the background without requiring a user login.
 *
 * Usage:
 *   npx tsx src/service.ts install
 *   npx tsx src/service.ts uninstall
 *   npx tsx src/service.ts status
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { platform, homedir } from 'os';

const SERVICE_NAME = 'whatson-api';
const SERVICE_DISPLAY = 'Whats On API';
const SERVICE_DESC = 'Whats On media aggregation backend API service';
const API_DIR = resolve(__dirname, '..');
const NODE_PATH = process.execPath;

const command = process.argv[2];

if (!command || !['install', 'uninstall', 'status'].includes(command)) {
  console.log(`
Whats On API — Service Manager

Usage:
  install    Install as a system service (runs on boot, no login required)
  uninstall  Remove the system service
  status     Check if the service is running
  `);
  process.exit(0);
}

const os = platform();

// ── Windows Service ──

function windowsInstall() {
  const nssm = findNssm();
  if (!nssm) {
    // Use sc.exe as fallback
    console.log('Installing Windows service using sc.exe...');
    const scriptPath = join(API_DIR, 'dist', 'index.js');
    const envFile = join(API_DIR, '.env');

    // Create a wrapper batch file
    const wrapperPath = join(API_DIR, 'whatson-service.bat');
    writeFileSync(wrapperPath, `@echo off
cd /d "${API_DIR}"
"${NODE_PATH}" "${scriptPath}"
`, 'utf-8');

    try {
      execSync(`sc create ${SERVICE_NAME} binPath= "${wrapperPath}" start= auto DisplayName= "${SERVICE_DISPLAY}"`, { stdio: 'inherit' });
      execSync(`sc description ${SERVICE_NAME} "${SERVICE_DESC}"`, { stdio: 'inherit' });
      execSync(`sc start ${SERVICE_NAME}`, { stdio: 'inherit' });
      console.log(`\n✓ Service "${SERVICE_DISPLAY}" installed and started.`);
    } catch (e) {
      console.error('\nFailed. Try running as Administrator.');
      console.log('\nAlternative: install NSSM (https://nssm.cc) and run again.');
    }
    return;
  }

  // Use NSSM for proper service management
  const scriptPath = join(API_DIR, 'dist', 'index.js');
  try {
    execSync(`"${nssm}" install ${SERVICE_NAME} "${NODE_PATH}" "${scriptPath}"`, { stdio: 'inherit' });
    execSync(`"${nssm}" set ${SERVICE_NAME} AppDirectory "${API_DIR}"`, { stdio: 'inherit' });
    execSync(`"${nssm}" set ${SERVICE_NAME} DisplayName "${SERVICE_DISPLAY}"`, { stdio: 'inherit' });
    execSync(`"${nssm}" set ${SERVICE_NAME} Description "${SERVICE_DESC}"`, { stdio: 'inherit' });
    execSync(`"${nssm}" set ${SERVICE_NAME} Start SERVICE_AUTO_START`, { stdio: 'inherit' });
    execSync(`"${nssm}" set ${SERVICE_NAME} AppStdout "${join(API_DIR, 'service.log')}"`, { stdio: 'inherit' });
    execSync(`"${nssm}" set ${SERVICE_NAME} AppStderr "${join(API_DIR, 'service.log')}"`, { stdio: 'inherit' });
    execSync(`"${nssm}" start ${SERVICE_NAME}`, { stdio: 'inherit' });
    console.log(`\n✓ Service "${SERVICE_DISPLAY}" installed and started.`);
    console.log(`  Logs: ${join(API_DIR, 'service.log')}`);
  } catch {
    console.error('\nFailed. Try running as Administrator.');
  }
}

function windowsUninstall() {
  try {
    execSync(`sc stop ${SERVICE_NAME}`, { stdio: 'pipe' });
  } catch {}
  try {
    execSync(`sc delete ${SERVICE_NAME}`, { stdio: 'inherit' });
    console.log(`✓ Service "${SERVICE_DISPLAY}" removed.`);
  } catch {
    console.error('Failed. Try running as Administrator.');
  }
}

function windowsStatus() {
  try {
    execSync(`sc query ${SERVICE_NAME}`, { stdio: 'inherit' });
  } catch {
    console.log(`Service "${SERVICE_NAME}" is not installed.`);
  }
}

function findNssm(): string | null {
  try {
    execSync('nssm version', { stdio: 'pipe' });
    return 'nssm';
  } catch {
    // Check common install locations
    const paths = [
      'C:\\nssm\\nssm.exe',
      'C:\\Program Files\\nssm\\nssm.exe',
      join(homedir(), 'nssm', 'nssm.exe'),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    return null;
  }
}

// ── macOS (launchd) ──

function macInstall() {
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `com.whatson.api.plist`);
  const scriptPath = join(API_DIR, 'dist', 'index.js');
  const logPath = join(API_DIR, 'service.log');
  const envFile = join(API_DIR, '.env');

  // Read .env and convert to EnvironmentVariables
  let envVars = '';
  if (existsSync(envFile)) {
    const lines = require('fs').readFileSync(envFile, 'utf-8').split('\n');
    const vars = lines
      .filter((l: string) => l.trim() && !l.startsWith('#') && l.includes('='))
      .map((l: string) => {
        const [key, ...rest] = l.split('=');
        return `      <key>${key.trim()}</key>\n      <string>${rest.join('=').trim()}</string>`;
      })
      .join('\n');
    if (vars) {
      envVars = `    <key>EnvironmentVariables</key>\n    <dict>\n${vars}\n    </dict>`;
    }
  }

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.whatson.api</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${scriptPath}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${API_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logPath}</string>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
${envVars}
</dict>
</plist>`;

  mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  writeFileSync(plistPath, plist, 'utf-8');

  try {
    execSync(`launchctl load -w "${plistPath}"`, { stdio: 'inherit' });
    console.log(`✓ Service installed and started.`);
    console.log(`  Plist: ${plistPath}`);
    console.log(`  Logs: ${logPath}`);
  } catch {
    console.error('Failed to load service.');
  }
}

function macUninstall() {
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.whatson.api.plist');
  try {
    execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe' });
  } catch {}
  try {
    unlinkSync(plistPath);
    console.log('✓ Service removed.');
  } catch {
    console.log('Service not found.');
  }
}

function macStatus() {
  try {
    const output = execSync('launchctl list | grep whatson', { encoding: 'utf-8' });
    console.log('Service is running:');
    console.log(output);
  } catch {
    console.log('Service is not running.');
  }
}

// ── Linux (systemd) ──

function linuxInstall() {
  const unitPath = `/etc/systemd/system/${SERVICE_NAME}.service`;
  const scriptPath = join(API_DIR, 'dist', 'index.js');
  const envFile = join(API_DIR, '.env');

  const unit = `[Unit]
Description=${SERVICE_DESC}
After=network.target

[Service]
Type=simple
User=${process.env.USER || 'root'}
WorkingDirectory=${API_DIR}
ExecStart=${NODE_PATH} ${scriptPath}
Restart=on-failure
RestartSec=5
${existsSync(envFile) ? `EnvironmentFile=${envFile}` : ''}

[Install]
WantedBy=multi-user.target
`;

  try {
    writeFileSync(unitPath, unit, 'utf-8');
    execSync('systemctl daemon-reload', { stdio: 'inherit' });
    execSync(`systemctl enable ${SERVICE_NAME}`, { stdio: 'inherit' });
    execSync(`systemctl start ${SERVICE_NAME}`, { stdio: 'inherit' });
    console.log(`✓ Service installed, enabled, and started.`);
    console.log(`  Unit file: ${unitPath}`);
    console.log(`  Logs: journalctl -u ${SERVICE_NAME} -f`);
  } catch {
    console.error('Failed. Try running with sudo.');
  }
}

function linuxUninstall() {
  const unitPath = `/etc/systemd/system/${SERVICE_NAME}.service`;
  try {
    execSync(`systemctl stop ${SERVICE_NAME}`, { stdio: 'pipe' });
    execSync(`systemctl disable ${SERVICE_NAME}`, { stdio: 'pipe' });
    unlinkSync(unitPath);
    execSync('systemctl daemon-reload', { stdio: 'pipe' });
    console.log('✓ Service removed.');
  } catch {
    console.error('Failed. Try running with sudo.');
  }
}

function linuxStatus() {
  try {
    execSync(`systemctl status ${SERVICE_NAME}`, { stdio: 'inherit' });
  } catch {
    console.log('Service is not installed or not running.');
  }
}

// ── Dispatcher ──

switch (command) {
  case 'install':
    console.log(`Installing ${SERVICE_DISPLAY} as a ${os} service...\n`);
    if (os === 'win32') windowsInstall();
    else if (os === 'darwin') macInstall();
    else linuxInstall();
    break;

  case 'uninstall':
    console.log(`Removing ${SERVICE_DISPLAY} service...\n`);
    if (os === 'win32') windowsUninstall();
    else if (os === 'darwin') macUninstall();
    else linuxUninstall();
    break;

  case 'status':
    if (os === 'win32') windowsStatus();
    else if (os === 'darwin') macStatus();
    else linuxStatus();
    break;
}
