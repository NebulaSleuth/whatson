/**
 * Jellyfin/Emby copy-vs-transcode decision (services/embyStreamCopy.ts).
 * A "no change" request may stream-copy; anything that changes the output
 * (or that we can't confirm matches the source) must force a transcode.
 * Run with `npm test -w packages/api`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideStreamCopy, defaultAudioIndex, type CopySourceInfo } from '../src/services/embyStreamCopy.js';

// A typical demo file: 1080p H.264 + two AAC tracks, ~5 Mbps.
const source: CopySourceInfo = {
  Bitrate: 5_000_000,
  DefaultAudioStreamIndex: 1,
  MediaStreams: [
    { Index: 0, Type: 'Video', Width: 1920, Height: 1080 },
    { Index: 1, Type: 'Audio', IsDefault: true },
    { Index: 2, Type: 'Audio' },
    { Index: 3, Type: 'Subtitle' },
  ],
};

// Explicit arity check, not a default parameter: passing `undefined` must
// mean "no source info", not "use the default source".
const copies = (opts: Parameters<typeof decideStreamCopy>[0], ...src: [CopySourceInfo | undefined] | []) =>
  decideStreamCopy(opts, src.length ? src[0] : source).allowCopy;

test('no options at all → stream copy', () => {
  const d = decideStreamCopy({}, source);
  assert.equal(d.allowCopy, true);
  assert.equal(d.reason, 'no change requested');
});

test('resume offset alone does not force a transcode', () => {
  assert.equal(copies({ offsetMs: 600_000 }), true);
});

test('forceTranscode → transcode', () => {
  assert.equal(copies({ forceTranscode: true }), false);
  assert.equal(copies({ forceTranscode: false }), true);
});

test('subtitle: burn-in transcodes; off sentinels (unset, 0, -1) copy', () => {
  assert.equal(copies({ subtitleStreamID: 3 }), false);
  assert.equal(copies({ subtitleStreamID: 0 }), true);
  assert.equal(copies({ subtitleStreamID: -1 }), true);
  assert.equal(copies({ subtitleStreamID: undefined }), true);
});

test('audio: default track copies, other track transcodes', () => {
  assert.equal(copies({ audioStreamID: 1 }), true);
  assert.equal(copies({ audioStreamID: 2 }), false);
});

test('audio: pick with unknown default → transcode', () => {
  assert.equal(copies({ audioStreamID: 1 }, { Bitrate: 5_000_000 }), false);
  assert.equal(copies({ audioStreamID: 1 }, undefined), false);
});

test('defaultAudioIndex falls back to IsDefault, then first audio stream', () => {
  assert.equal(defaultAudioIndex({ MediaStreams: [{ Index: 4, Type: 'Audio' }, { Index: 5, Type: 'Audio', IsDefault: true }] }), 5);
  assert.equal(defaultAudioIndex({ MediaStreams: [{ Index: 0, Type: 'Video' }, { Index: 4, Type: 'Audio' }] }), 4);
  assert.equal(defaultAudioIndex({ MediaStreams: [{ Index: 0, Type: 'Video' }] }), undefined);
  assert.equal(copies({ audioStreamID: 2 }, { ...source, DefaultAudioStreamIndex: undefined, MediaStreams: [{ Index: 2, Type: 'Audio' }] }), true);
});

test('bitrate: cap at/above source copies (Roku "Original" sends 20000)', () => {
  assert.equal(copies({ maxBitrate: 20000 }), true);
  assert.equal(copies({ maxBitrate: 5000 }), true);
});

test('bitrate: cap below source transcodes', () => {
  assert.equal(copies({ maxBitrate: 4000 }), false);
  assert.equal(copies({ maxBitrate: 1500 }), false);
});

test('bitrate: cap with unknown source bitrate → transcode', () => {
  assert.equal(copies({ maxBitrate: 20000 }, { ...source, Bitrate: undefined }), false);
  assert.equal(copies({ maxBitrate: 20000 }, undefined), false);
});

test('resolution: at/above source copies, below transcodes', () => {
  assert.equal(copies({ resolution: '1920x1080' }), true);
  assert.equal(copies({ resolution: '3840x2160' }), true);
  assert.equal(copies({ resolution: '1280x720' }), false);
  assert.equal(copies({ resolution: '1920x720' }), false);
});

test('resolution: unparseable or unknown source size → transcode', () => {
  assert.equal(copies({ resolution: 'auto' }), false);
  assert.equal(copies({ resolution: '1920x1080' }, { Bitrate: 5_000_000 }), false);
});

test('unknown source with no options still copies (nothing to change)', () => {
  assert.equal(copies({}, undefined), true);
});

test('any single change among several no-op options forces a transcode', () => {
  const noop = { audioStreamID: 1, maxBitrate: 20000, resolution: '1920x1080', subtitleStreamID: 0 };
  assert.equal(copies(noop), true);
  assert.equal(copies({ ...noop, subtitleStreamID: 3 }), false);
  assert.equal(copies({ ...noop, audioStreamID: 2 }), false);
  assert.equal(copies({ ...noop, maxBitrate: 2000 }), false);
  assert.equal(copies({ ...noop, resolution: '640x360' }), false);
  assert.equal(copies({ ...noop, forceTranscode: true }), false);
});
