#!/usr/bin/env node
// Sideload the channel onto a dev-mode Roku.
//
// Required env:
//   ROKU_HOST              — the Roku's LAN IP, e.g. 192.168.1.50
//   ROKU_DEV_PASSWORD      — the dev installer password set on first boot
//                            into developer mode
//
// Optional env:
//   ROKU_API_URL           — e.g. http://192.168.1.181:3001. When set,
//                            this URL is baked into the channel build at
//                            source/Config.brs so the channel always has
//                            it after install — survives reboots and
//                            registry wipes. Registry value still wins
//                            when present, so you can override at runtime
//                            via telnet.
//   ROKU_PLEX_USER_ID      — e.g. 1001793. Sent on every API request as
//                            X-Plex-User so the backend resolves the
//                            right per-user Plex token. Find your user
//                            ids at GET <apiUrl>/api/users. Until the
//                            Roku has its own user picker, this is the
//                            only way to log into a Plex Home account.
//   ROKU_OUT_DIR           — where to write the staged channel zip
//                            (default: apps/roku/out)
//   ROKU_OUT_FILE          — zip name (default: whatson-roku)
//
// Usage:
//   ROKU_HOST=192.168.1.50 \
//   ROKU_DEV_PASSWORD=foo \
//   ROKU_API_URL=http://192.168.1.181:3001 \
//   npm run roku:deploy
//
// On success the channel restarts on the device. Tail logs with:
//   telnet <ROKU_HOST> 8085

const path = require('path');
const rokuDeploy = require('roku-deploy');
const { writeConfigBrs, CHANNEL_FILES } = require('./config');

const host = process.env.ROKU_HOST;
const password = process.env.ROKU_DEV_PASSWORD;

console.log('Env check:');
console.log('  ROKU_HOST:        ', host ? host : '(empty)');
console.log('  ROKU_DEV_PASSWORD:', password ? '(set, length=' + password.length + ')' : '(empty)');
console.log('  ROKU_API_URL:     ', process.env.ROKU_API_URL ? process.env.ROKU_API_URL : '(empty)');

if (!host || !password) {
  console.error('Set ROKU_HOST and ROKU_DEV_PASSWORD in the environment.');
  console.error('Example: ROKU_HOST=192.168.1.50 ROKU_DEV_PASSWORD=changeme npm run roku:deploy');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');

// Always (re)generate source/Config.brs so the build either has the
// values from this run's env vars, or has them cleanly empty when env
// wasn't set. Without this, a stale value from a previous deploy could
// linger. Shared with package.js — see scripts/config.js.
writeConfigBrs(rootDir);

console.log(`Calling rokuDeploy.deploy() against ${host}…`);

rokuDeploy
  .deploy({
    host,
    password,
    rootDir,
    outDir: process.env.ROKU_OUT_DIR || path.join(rootDir, 'out'),
    outFile: process.env.ROKU_OUT_FILE || 'whatson-roku',
    files: CHANNEL_FILES,
    incrementBuildNumber: false,
    // roku-deploy's default is `true` (wipes channel + registry).
    // Forcing false avoids the explicit-delete step, but observation
    // shows the dev portal's "Replace" install ALSO wipes the
    // registry on this firmware — so we additionally bake the auth
    // key, apiUrl, and plexUserId into Config.brs above so the
    // channel can recover its identity without re-pairing on every
    // redeploy.
    deleteInstalledChannel: false,
  })
  .then((result) => {
    console.log(`✅ Deployed to ${host}. Tail logs: telnet ${host} 8085`);
    if (result) {
      console.log('Deploy result:', JSON.stringify(result, null, 2).slice(0, 400));
    }
  })
  .catch((err) => {
    console.error('❌ Deploy failed:');
    console.error(err && err.message ? err.message : err);
    // CompileError carries the device's full response in `.results`. Print it
    // — it usually contains the file + line of the actual BrightScript error
    // that roku-deploy hides behind the bare "Compile error" message.
    if (err && err.results) {
      const results = err.results;
      if (typeof results === 'string') {
        console.error('--- device response ---');
        console.error(results.slice(0, 4000));
      } else if (results.body) {
        console.error('--- device response body ---');
        console.error(String(results.body).slice(0, 4000));
      } else {
        console.error('--- device response (raw) ---');
        try { console.error(JSON.stringify(results, null, 2).slice(0, 4000)); }
        catch { console.error(results); }
      }
    }
    process.exit(1);
  });
