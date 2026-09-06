#!/usr/bin/env node
// Build a standalone .zip for the Roku channel without sideloading.
// Useful for store submission packaging, for handing the build off to a
// colleague to install manually via the Roku dev installer web UI, or as
// a "build" step before deploy.js pushes to a device.
//
// Honours the same env as deploy.js (ROKU_API_URL, ROKU_PLEX_USER_ID,
// optional ROKU_AUTH_KEY) — they're baked into source/Config.brs. For a
// store package leave them all unset so nothing developer-specific ships.
//
// Usage:  npm run package            (from apps/roku)
// Output: apps/roku/out/whatson-roku.zip

const path = require('path');
const rokuDeploy = require('roku-deploy');
const { writeConfigBrs, CHANNEL_FILES } = require('./config');

const rootDir = path.resolve(__dirname, '..');

writeConfigBrs(rootDir);

rokuDeploy
  .createPackage({
    rootDir,
    outDir: process.env.ROKU_OUT_DIR || path.join(rootDir, 'out'),
    outFile: process.env.ROKU_OUT_FILE || 'whatson-roku',
    files: CHANNEL_FILES,
  })
  .then((info) => {
    const out = info && info.path ? info.path : path.join(rootDir, 'out', 'whatson-roku.zip');
    console.log(`✅ Packaged ${out}`);
  })
  .catch((err) => {
    console.error('❌ Package failed:');
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
