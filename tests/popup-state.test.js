import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHistoryFilter, buildIocKey, choosePrimaryInvestigationTarget, findSameIocHistory, getManualLookupState, mapCurrentIocsToHistory, summarizeHistoryContext } from '../src/popup/state.js';

test('buildIocKey normalizes casing and whitespace', () => {
  assert.equal(buildIocKey({ type: ' IP ', normalized: ' 8.8.8.8 ' }), 'ip:8.8.8.8');
  assert.equal(buildIocKey({ type: 'DOMAIN', normalized: ' Evil.Example ' }), 'domain:evil.example');
});

test('findSameIocHistory matches current IOC against recent investigation history', () => {
  const history = [
    { historyKey: 'domain:evil.example', normalized: 'evil.example' },
    { historyKey: 'ip:8.8.8.8', normalized: '8.8.8.8' }
  ];
  const match = findSameIocHistory(history, [{ type: 'IP', normalized: '8.8.8.8' }]);
  assert.ok(match);
  assert.equal(match.historyKey, 'ip:8.8.8.8');
});

test('applyHistoryFilter supports all, same-page, same-ioc and pinned views', () => {
  const history = [
    { historyKey: 'domain:evil.example', pageUrl: 'https://case.local/1', pinned: true },
    { historyKey: 'ip:8.8.8.8', pageUrl: 'https://case.local/2', pinned: false }
  ];
  const sameIocEntry = history[1];

  assert.equal(applyHistoryFilter(history, 'https://case.local/1', sameIocEntry, 'all').length, 2);
  assert.equal(applyHistoryFilter(history, 'https://case.local/1', sameIocEntry, 'same-page').length, 1);
  assert.equal(applyHistoryFilter(history, 'https://case.local/1', sameIocEntry, 'same-ioc').length, 1);
  assert.equal(applyHistoryFilter(history, 'https://case.local/1', sameIocEntry, 'pinned').length, 1);
});

test('mapCurrentIocsToHistory marks only already investigated IOCs', () => {
  const history = [
    { historyKey: 'domain:evil.example', normalized: 'evil.example', lastSeen: '2026-03-21T20:00:00.000Z' }
  ];
  const items = mapCurrentIocsToHistory(history, [
    { type: 'domain', normalized: 'evil.example' },
    { type: 'ip', normalized: '8.8.8.8' }
  ]);

  assert.equal(items[0].alreadyInvestigated, true);
  assert.equal(items[0].lastInvestigation?.historyKey, 'domain:evil.example');
  assert.equal(items[1].alreadyInvestigated, false);
  assert.equal(items[1].lastInvestigation, null);
});

test('summarizeHistoryContext exposes same-page and same-ioc shortcuts coherently', () => {
  const history = [
    { historyKey: 'domain:evil.example', pageUrl: 'https://case.local/1', normalized: 'evil.example' },
    { historyKey: 'ip:8.8.8.8', pageUrl: 'https://case.local/2', normalized: '8.8.8.8' }
  ];
  const currentIocs = [{ type: 'ip', normalized: '8.8.8.8' }];
  const summary = summarizeHistoryContext(history, 'https://case.local/1', currentIocs, 'all');
  assert.equal(summary.samePageEntry?.historyKey, 'domain:evil.example');
  assert.equal(summary.sameIocEntry?.historyKey, 'ip:8.8.8.8');
  assert.equal(summary.filtered.length, 2);
});

test('getManualLookupState recognizes valid IOCs and exposes aligned provider pivots', () => {
  const subnet = getManualLookupState('10.0.0.0/24');
  assert.equal(subnet.ioc?.type, 'subnet');
  assert.equal(subnet.chip, 'SUBNET');
  assert.match(subnet.hint, /IOC recognized/i);
  assert.equal(subnet.pivots.virustotal, false);
  assert.equal(subnet.pivots.abuseipdb, true);
  assert.equal(subnet.pivots.shodan, false);

  const asn = getManualLookupState('AS13335');
  assert.equal(asn.ioc?.type, 'asn');
  assert.equal(asn.pivots.virustotal, false);
  assert.equal(asn.pivots.abuseipdb, false);
  assert.equal(asn.pivots.shodan, true);

  const invalid = getManualLookupState('totally not an ioc');
  assert.equal(invalid.ioc, null);
  assert.equal(invalid.chip, 'TYPE');
  assert.match(invalid.hint, /Try a single IP|Paste a single IOC/i);
  assert.deepEqual(invalid.pivots, { virustotal: false, abuseipdb: false, shodan: false });
});

test('choosePrimaryInvestigationTarget prefers reopening an investigated IOC before a fresh one', () => {
  const target = choosePrimaryInvestigationTarget([
    { type: 'domain', normalized: 'fresh.example', alreadyInvestigated: false },
    { type: 'ip', normalized: '8.8.8.8', alreadyInvestigated: true }
  ], [], 'https://case.local/1');
  assert.equal(target?.normalized, '8.8.8.8');

  const fallback = choosePrimaryInvestigationTarget([], [
    { pageUrl: 'https://case.local/1', ioc: { type: 'domain', normalized: 'evil.example' } }
  ], 'https://case.local/1');
  assert.equal(fallback?.normalized, 'evil.example');
});
