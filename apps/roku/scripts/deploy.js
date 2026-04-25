#!/usr/bin/env node
// Sideload the channel onto a dev-mode Roku.
//
// Required env:
//   ROKU_HOST              — the Roku's LAN IP, e.g. 192.168.1.50
//   ROKU_DEV_PASSWORD      — the dev installer password set on first boot
//                            into developer mode
//
// Optional env:
//   ROKU_OUT_DIR           — where to write the staged channel zip
//                            (default: apps/roku/out)
//   ROKU_OUT_FILE          — zip name (default: whatson-roku)
//
// Usage:
//   ROKU_HOST=192.168.1.50 ROKU_DEV_PASSWORD=foo npm run roku:deploy
//
// On success the channel restarts on the device. Tail logs with:
//   telnet <ROKU_HOST> 8085

const path = require('path');
const rokuDeploy = require('roku-deploy');

const host = process.env.ROKU_HOST;
const password = process.env.ROKU_DEV_PASSWORD;

if (!host || !password) {
  console.error('Set ROKU_HOST and ROKU_DEV_PASSWORD in the environment.');
  console.error('Example: ROKU_HOST=192.168.1.50 ROKU_DEV_PASSWORD=changeme npm run roku:deploy');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');

rokuDeploy
  .deploy({
    host,
    password,
    rootDir,
    outDir: process.env.ROKU_OUT_DIR || path.join(rootDir, 'out'),
    outFile: process.env.ROKU_OUT_FILE || 'whatson-roku',
    files: [
      'manifest',
      'source/**/*',
      'components/**/*',
      'images/**/*',
    ],
    incrementBuildNumber: false,
    deleteInstalledChannel: true,
  })
  .then(() => {
    console.log(`✅ Deployed to ${host}. Tail logs: telnet ${host} 8085`);
  })
  .catch((err) => {
    console.error('❌ Deploy failed:');
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
