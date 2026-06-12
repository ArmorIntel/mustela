import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoryKey, mergeHistoryEntries, normalizeHistoryEntry } from '../src/storage/storage.js';

test('buildHistoryKey returns a stable type+normalized key', () => {
  assert.equal(buildHistoryKey({ ioc: { type: 'domain', normalized: 'evil.example' } }), 'domain:evil.example');
  assert.equal(buildHistoryKey({ type: 'ip', normalized: '8.8.8.8' }), 'ip:8.8.8.8');
});

test('normalizeHistoryEntry keeps useful local-memory metadata', () => {
  const normalized = normalizeHistoryEntry({
    ioc: {
      type: 'domain',
      normalized: 'evil.example',
      raw: 'evil.example',
      sourceContext: { pageUrl: 'https://console.local/case/42', pageTitle: 'Case 42' }
    },
    overallVerdict: 'suspicious',
    score: 67,
    timestamp: '2026-03-21T18:00:00.000Z'
  });

  assert.equal(normalized.historyKey, 'domain:evil.example');
  assert.equal(normalized.pageUrl, 'https://console.local/case/42');
  assert.equal(normalized.pageTitle, 'Case 42');
  assert.equal(normalized.seenCount, 1);
  assert.equal(normalized.firstSeen, '2026-03-21T18:00:00.000Z');
});

test('mergeHistoryEntries deduplicates repeated IOC lookups and increments seenCount', () => {
  const first = {
    ioc: {
      type: 'ip',
      normalized: '8.8.8.8',
      raw: '8.8.8.8',
      sourceContext: { pageUrl: 'https://a.local', pageTitle: 'Page A' }
    },
    overallVerdict: 'unknown',
    score: 10,
    timestamp: '2026-03-21T18:00:00.000Z'
  };

  const second = {
    ioc: {
      type: 'ip',
      normalized: '8.8.8.8',
      raw: '8.8.8.8',
      sourceContext: { pageUrl: 'https://b.local', pageTitle: 'Page B' }
    },
    overallVerdict: 'suspicious',
    score: 72,
    timestamp: '2026-03-21T18:05:00.000Z'
  };

  const once = mergeHistoryEntries([], first);
  const twice = mergeHistoryEntries(once, second);

  assert.equal(twice.length, 1);
  assert.equal(twice[0].historyKey, 'ip:8.8.8.8');
  assert.equal(twice[0].seenCount, 2);
  assert.equal(twice[0].firstSeen, '2026-03-21T18:00:00.000Z');
  assert.equal(twice[0].lastSeen, '2026-03-21T18:05:00.000Z');
  assert.equal(twice[0].overallVerdict, 'suspicious');
  assert.equal(twice[0].score, 72);
  assert.equal(twice[0].pageTitle, 'Page B');
});

test('mergeHistoryEntries preserves pinning metadata across refreshes', () => {
  const pinned = mergeHistoryEntries([], {
    ioc: { type: 'domain', normalized: 'evil.example', raw: 'evil.example' },
    pinned: true,
    pinnedAt: '2026-03-21T18:01:00.000Z',
    timestamp: '2026-03-21T18:00:00.000Z'
  });

  const refreshed = mergeHistoryEntries(pinned, {
    ioc: { type: 'domain', normalized: 'evil.example', raw: 'evil.example' },
    timestamp: '2026-03-21T18:05:00.000Z'
  });

  assert.equal(refreshed[0].pinned, true);
  assert.equal(refreshed[0].pinnedAt, '2026-03-21T18:01:00.000Z');
});

test('mergeHistoryEntries preserves analyst notes across refreshes', () => {
  const noted = mergeHistoryEntries([], {
    ioc: { type: 'domain', normalized: 'evil.example', raw: 'evil.example' },
    analystNote: 'Pivot to proxy logs before blocking.',
    analystNoteUpdatedAt: '2026-03-21T18:02:00.000Z',
    timestamp: '2026-03-21T18:00:00.000Z'
  });

  const refreshed = mergeHistoryEntries(noted, {
    ioc: { type: 'domain', normalized: 'evil.example', raw: 'evil.example' },
    timestamp: '2026-03-21T18:05:00.000Z'
  });

  assert.equal(refreshed[0].analystNote, 'Pivot to proxy logs before blocking.');
  assert.equal(refreshed[0].analystNoteUpdatedAt, '2026-03-21T18:02:00.000Z');
});

test('mergeHistoryEntries keeps most recent records first and respects limit', () => {
  const entries = [
    { ioc: { type: 'domain', normalized: 'one.example', raw: 'one.example' }, timestamp: '2026-03-21T18:00:00.000Z' },
    { ioc: { type: 'domain', normalized: 'two.example', raw: 'two.example' }, timestamp: '2026-03-21T18:10:00.000Z' },
    { ioc: { type: 'domain', normalized: 'three.example', raw: 'three.example' }, timestamp: '2026-03-21T18:20:00.000Z' }
  ];

  const merged = entries.reduce((acc, entry) => mergeHistoryEntries(acc, entry, 2), []);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].normalized, 'three.example');
  assert.equal(merged[1].normalized, 'two.example');
});
