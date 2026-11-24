/**
 * Demo sample cards (services/demoSamples.ts): the made-up Late / Downloading /
 * Coming Soon items the public demo adds to its Coming Soon shelves.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContentItem } from '@whatson/shared';
import { buildSampleItems, loadSampleEntries, type SampleEntry } from '../src/services/demoSamples.js';

const NOW = Date.parse('2026-11-23T12:00:00Z');

const libraryEpisode = {
  id: 'jf-1', type: 'episode', title: 'Pilot', showTitle: 'Sherlock Holmes',
  summary: '', duration: 26, source: 'jellyfin', sourceId: 'jf-1', status: 'ready',
  artwork: { poster: 'http://jellyfin:8096/Items/s1/Images/Primary', thumbnail: 't', background: 'b' },
  progress: { watched: false, percentage: 0, currentPosition: 0 },
  availability: { availableAt: '' }, addedAt: '', year: 1954,
} as ContentItem;

const entries: SampleEntry[] = [
  { kind: 'episode', state: 'late', offsetHours: -20, series: 'Sherlock Holmes', season: 1, episode: 6, title: 'Episode 6', year: 1954 },
  { kind: 'episode', state: 'coming_soon', offsetHours: 10, series: 'Not In Library', season: 1, episode: 1, title: 'x', year: 2000 },
  { kind: 'movie', state: 'downloading', offsetHours: -6, title: 'Charge', year: 2022, poster: 'https://image.tmdb.org/a.jpg', percentage: 31, timeLeft: '48m' },
  { kind: 'movie', state: 'coming_soon', offsetHours: 70, title: 'Night of the Living Dead', year: 1968, poster: 'https://image.tmdb.org/b.jpg' },
  { kind: 'movie', state: 'late', offsetHours: -30, title: 'No Poster', year: 1963 },
];

test('builds late, downloading and coming-soon cards with relative dates', () => {
  const { tv, movies } = buildSampleItems(entries, [libraryEpisode], NOW);

  assert.equal(tv.length, 1);
  const late = tv[0];
  assert.equal(late.status, 'coming_soon');
  assert.equal(late.isLate, true);
  assert.equal(late.source, 'sonarr');
  assert.equal(late.showTitle, 'Sherlock Holmes');
  assert.equal(late.episodeNumber, 6);
  assert.deepEqual(late.artwork, libraryEpisode.artwork, 'episode borrows its series artwork');
  assert.equal(late.availability.availableAt, new Date(NOW - 20 * 3600_000).toISOString());

  assert.equal(movies.length, 2);
  const [dl, soon] = movies;
  assert.equal(dl.status, 'downloading');
  assert.equal(dl.source, 'radarr');
  assert.equal(dl.download?.percentage, 31);
  assert.equal(dl.download?.timeLeft, '48m');
  assert.ok((dl.download?.queueId ?? 0) < 0, 'fake queue ids are negative');
  assert.equal(dl.isLate, undefined);
  assert.equal(soon.status, 'coming_soon');
  assert.equal(soon.isLate, undefined);
  assert.equal(soon.availability.availableAt, new Date(NOW + 70 * 3600_000).toISOString());
});

test('drops samples with no artwork rather than showing blank cards', () => {
  const { tv, movies } = buildSampleItems(entries, [], NOW);
  assert.equal(tv.length, 0, 'no library series to borrow art from');
  assert.ok(!movies.some((m) => m.title === 'No Poster'));
});

test('ids are unique and never look like real items', () => {
  const { tv, movies } = buildSampleItems(entries, [libraryEpisode], NOW);
  const ids = [...tv, ...movies].map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith('demo-sample-')));
});

test('loadSampleEntries: missing or malformed file gives no samples', () => {
  const dir = mkdtempSync(join(tmpdir(), 'whatson-samples-'));
  try {
    assert.deepEqual(loadSampleEntries(join(dir, 'absent.json')), []);
    writeFileSync(join(dir, 'bad.json'), '{not json');
    assert.deepEqual(loadSampleEntries(join(dir, 'bad.json')), []);
    writeFileSync(join(dir, 'ok.json'), JSON.stringify({ items: entries }));
    assert.equal(loadSampleEntries(join(dir, 'ok.json')).length, entries.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
