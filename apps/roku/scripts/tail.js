#!/usr/bin/env node
// Tail the Roku BrightScript debug port (8085).
// Compile errors with file + line numbers print here during install /
// channel start — invaluable when `npm run roku:deploy` returns a bare
// "Compile error" with no detail.
//
// Usage:  ROKU_HOST=192.168.1.50 npm run roku:tail
// Or:     node scripts/tail.js 192.168.1.50

const net = require('net');

const host = process.env.ROKU_HOST || process.argv[2];
if (!host) {
  console.error('Set ROKU_HOST or pass IP as first arg.');
  process.exit(1);
}

const port = 8085;
console.log(`Connecting to ${host}:${port} … (Ctrl-C to exit)`);

const sock = net.createConnection(port, host, () => {
  console.log(`[connected — channel logs follow]\n`);
});
sock.on('data', (buf) => process.stdout.write(buf));
sock.on('error', (err) => {
  console.error(`\n❌ Socket error: ${err.message}`);
  process.exit(1);
});
sock.on('close', () => {
  console.log('\n[disconnected]');
  process.exit(0);
});

// Forward Ctrl-C cleanly.
process.on('SIGINT', () => sock.destroy());
