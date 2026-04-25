#!/usr/bin/env node
// Build a standalone .zip for the Roku channel without sideloading.
// Useful for store submission packaging or for handing the build off to
// a colleague to install manually via the Roku dev installer web UI.
//
// Usage:  npm run roku:package
// Output: apps/roku/out/whatson-roku.zip

const path = require('path');
const rokuDeploy = require('roku-deploy');

const rootDir = path.resolve(__dirname, '..');

rokuDeploy
  .createPackage({
    rootDir,
    outDir: process.env.ROKU_OUT_DIR || path.join(rootDir, 'out'),
    outFile: process.env.ROKU_OUT_FILE || 'whatson-roku',
    files: [
      'manifest',
      'source/**/*',
      'components/**/*',
      'images/**/*',
    ],
  })
  .then((info) => {
    const out = info && info.path ? info.path : 'apps/roku/out/whatson-roku.zip';
    console.log(`✅ Packaged ${out}`);
  })
  .catch((err) => {
    console.error('❌ Package failed:');
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
