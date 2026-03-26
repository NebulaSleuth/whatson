#!/usr/bin/env node

/**
 * Build standalone executable for the Whats On API.
 *
 * Steps:
 * 1. Bundle all TypeScript + node_modules into a single CJS file with esbuild
 * 2. Generate a Node.js SEA blob
 * 3. Inject the blob into a copy of the node binary
 *
 * Usage:
 *   node scripts/build-standalone.js           # Build for current platform
 *   node scripts/build-standalone.js --skip-sea # Just bundle (for testing)
 */

const { execSync } = require('child_process');
const { writeFileSync, copyFileSync, existsSync, mkdirSync, unlinkSync, chmodSync } = require('fs');
const { join, resolve } = require('path');
const { platform, arch } = require('os');

const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'standalone');
const BUNDLE = join(DIST, 'bundle.cjs');
const SEA_CONFIG = join(DIST, 'sea-config.json');
const SEA_BLOB = join(DIST, 'sea-prep.blob');

const skipSea = process.argv.includes('--skip-sea');

const os = platform();
const exeName = os === 'win32' ? 'whatson-api.exe' : 'whatson-api';
const OUTPUT = join(DIST, exeName);

console.log(`\n🔨 Building Whats On API standalone for ${os}/${arch()}...\n`);

// ── Step 0: Create output directory ──
mkdirSync(DIST, { recursive: true });

// ── Step 1: Bundle with esbuild ──
console.log('1. Bundling with esbuild...');

// First build the shared package
execSync('npx tsc', { cwd: join(ROOT, '..', 'shared'), stdio: 'inherit' });

try {
  execSync([
    'npx esbuild',
    join(ROOT, 'src', 'index.ts'),
    '--bundle',
    '--platform=node',
    '--target=node20',
    '--format=cjs',
    `--outfile=${BUNDLE}`,
    '--external:fsevents',
    '--define:process.env.NODE_ENV=\'"production"\'',
    '--sourcemap=inline',
    '--minify',
  ].join(' '), { cwd: ROOT, stdio: 'inherit' });
} catch (e) {
  console.error('❌ esbuild bundle failed');
  process.exit(1);
}

console.log(`   ✓ Bundle created: ${BUNDLE}`);

// Check bundle works
try {
  execSync(`node -e "require('${BUNDLE.replace(/\\/g, '\\\\')}')"`, { timeout: 5000, stdio: 'pipe' });
  console.log('   ✓ Bundle validates OK');
} catch {
  console.log('   ⚠ Bundle validation skipped (may need .env)');
}

if (skipSea) {
  console.log('\n✓ Bundle-only build complete (--skip-sea)');
  console.log(`  Run with: node ${BUNDLE}`);
  process.exit(0);
}

// ── Step 2: Create SEA config ──
console.log('\n2. Creating SEA blob...');

writeFileSync(SEA_CONFIG, JSON.stringify({
  main: BUNDLE,
  output: SEA_BLOB,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: true,
}, null, 2));

try {
  execSync(`node --experimental-sea-config "${SEA_CONFIG}"`, { cwd: DIST, stdio: 'inherit' });
} catch (e) {
  console.error('❌ SEA blob generation failed. Node.js 20+ required.');
  console.log('   Falling back to bundle-only output.');
  console.log(`   Run with: node ${BUNDLE}`);
  process.exit(0);
}

console.log('   ✓ SEA blob generated');

// ── Step 3: Copy node binary and inject blob ──
console.log('\n3. Creating standalone executable...');

const nodeBin = process.execPath;
try {
  copyFileSync(nodeBin, OUTPUT);
} catch (e) {
  console.error(`❌ Could not copy node binary: ${e.message}`);
  process.exit(1);
}

// Remove code signature on macOS (required before injection)
if (os === 'darwin') {
  try {
    execSync(`codesign --remove-signature "${OUTPUT}"`, { stdio: 'pipe' });
  } catch {}
}

// Inject the SEA blob
try {
  execSync([
    'npx postject',
    `"${OUTPUT}"`,
    'NODE_SEA_BLOB',
    `"${SEA_BLOB}"`,
    '--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ].join(' '), { stdio: 'inherit' });
} catch (e) {
  console.error('❌ Blob injection failed. Installing postject...');
  try {
    execSync('npm install -g postject', { stdio: 'inherit' });
    execSync([
      'postject',
      `"${OUTPUT}"`,
      'NODE_SEA_BLOB',
      `"${SEA_BLOB}"`,
      '--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ].join(' '), { stdio: 'inherit' });
  } catch {
    console.error('❌ Could not inject blob. Run manually:');
    console.log(`   npx postject "${OUTPUT}" NODE_SEA_BLOB "${SEA_BLOB}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`);
    process.exit(1);
  }
}

// Re-sign on macOS
if (os === 'darwin') {
  try {
    execSync(`codesign --sign - "${OUTPUT}"`, { stdio: 'pipe' });
  } catch {}
}

// Make executable on Unix
if (os !== 'win32') {
  try { chmodSync(OUTPUT, 0o755); } catch {}
}

// Clean up intermediate files
try { unlinkSync(SEA_BLOB); } catch {}
try { unlinkSync(SEA_CONFIG); } catch {}

// ── Step 4: Copy admin UI files ──
console.log('\n4. Copying admin UI...');
const adminSrc = join(ROOT, 'admin');
const adminDest = join(DIST, 'admin');
if (existsSync(adminSrc)) {
  mkdirSync(adminDest, { recursive: true });
  const { readdirSync } = require('fs');
  for (const file of readdirSync(adminSrc)) {
    copyFileSync(join(adminSrc, file), join(adminDest, file));
  }
  console.log('   ✓ Admin UI copied to standalone/admin/');
} else {
  console.log('   ⚠ admin/ directory not found, skipping');
}

const { statSync } = require('fs');
const size = (statSync(OUTPUT).size / (1024 * 1024)).toFixed(1);

console.log(`\n✅ Standalone executable created!`);
console.log(`   ${OUTPUT} (${size} MB)`);
console.log(`\n   To run:`);
console.log(`   ${os === 'win32' ? '' : './'}${exeName}`);
console.log(`\n   Make sure .env is in the same directory as the executable.`);
console.log(`   Admin UI: http://localhost:3001/setup`);
