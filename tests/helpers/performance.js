import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { parseIocsFromText } from '../../src/shared/ioc.js';
import { saveDetectedForTab, getDetectedForTab } from '../../src/storage/storage.js';
import { summarizeHistoryContext } from '../../src/popup/state.js';
import { makePageNodes, makeDetected } from '../fixtures/performance.js';

export const INPUT_SCALE = 16;
export const CI_MARGIN = 3;
const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

// Batch short operations above clock noise. Warm both sizes, alternate sample
// order, and compare medians; no machine-specific absolute latency assertion.
export async function measureGrowth(run, make, length = 200000) {
  const smallInput = make(length / INPUT_SCALE);
  const largeInput = make(length);
  const time = (input, iterations) => {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) run(input);
    return (performance.now() - start) / iterations;
  };
  for (let i = 0; i < 3; i++) { run(smallInput); run(largeInput); }
  let iterations = 1;
  while (time(smallInput, iterations) * iterations < 20 && iterations < 4096) iterations *= 2;
  const small = [];
  const large = [];
  for (let i = 0; i < 7; i++) {
    if (i % 2) { large.push(time(largeInput, 1)); small.push(time(smallInput, iterations)); }
    else { small.push(time(smallInput, iterations)); large.push(time(largeInput, 1)); }
  }
  return { small: median(small), large: median(large), scale: INPUT_SCALE };
}

export function assertGrowthBudget(name, { small, large, scale }) {
  const limit = scale * CI_MARGIN;
  assert.ok(Number.isFinite(small) && small > 0 && Number.isFinite(large) && large >= 0 && large <= small * limit,
    `Performance budget exceeded: ${name}; ${small.toFixed(3)} -> ${large.toFixed(3)} ms, growth ${(large / small).toFixed(2)}x > ${limit}x (${scale}x input, ${CI_MARGIN}x CI margin)`);
}

const content = await fs.readFile(new URL('../../src/content/content.js', import.meta.url), 'utf8');
export async function measureScan(count, { lastIoc = false, dense = false } = {}) {
  const nodes = makePageNodes(count);
  if (lastIoc) nodes.at(-1).nodeValue = '8.8.8.8';
  if (dense) for (const node of nodes) node.nodeValue = '8.8.8.8 9.9.9.9';
  let clock = 0;
  let sliceWork = 0;
  let published = [];
  const metrics = { visited: 0, parsed: 0, maxText: 0, messages: 0, yields: 0, maxSliceWork: 0, contextReads: 0 };
  const body = { nodeType: 1, tagName: 'BODY', matches: () => false, isConnected: true, appendChild() {} };
  const context = vm.createContext({
    Date: { now: () => clock++ },
    setTimeout(fn) {
      metrics.maxSliceWork = Math.max(metrics.maxSliceWork, sliceWork);
      sliceWork = 0;
      metrics.yields++;
      return setTimeout(fn, 0);
    }, clearTimeout, crypto: { getRandomValues: (bytes) => bytes.fill(1) },
    location: { href: 'https://report.example/' },
    MUSTELA_SHARED: { isExcluded: () => false, parseIocsFromText(text) {
      metrics.parsed++; metrics.maxText = Math.max(metrics.maxText, text.length);
      return parseIocsFromText(text);
    } },
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
    document: { body, get title() { metrics.contextReads++; return 'Synthetic report'; }, createElement: () => ({ dataset: {}, isConnected: true }), documentElement: { dataset: {} }, createTreeWalker() {
      let index = 0;
      return { nextNode() { metrics.visited++; sliceWork++; return nodes[index++] || null; } };
    } },
    chrome: { runtime: { id: 'fixture', onMessage: { addListener() {} }, async sendMessage(message) { metrics.messages++; published = message.payload; return { ok: true }; } } }
  });
  // Skip event wiring only: the actual shipped scan/parser/publisher run unchanged.
  vm.runInContext(content.replace('bootstrap();', `initialized = true; globallyPaused = false;
    globalThis.benchScan = scanPage; globalThis.retained = () => [...detectedByNode.values()].reduce((n, items) => n + items.length, 0);
    globalThis.contextCount = () => new Set([...detectedByNode.values()].flat().map(ioc => ioc.sourceContext)).size;`), context);
  const start = performance.now();
  await context.benchScan();
  const duration = performance.now() - start;
  const first = { ...metrics };
  await context.benchScan();
  return { ...first, messages: metrics.messages, retained: context.retained(), contexts: context.contextCount(), published, duration };
}

export async function measureStorage() {
  const previous = globalThis.chrome;
  const store = {};
  const metrics = { sessionWrites: 0, localWrites: 0 };
  globalThis.chrome = { storage: {
    session: {
      async get(key) { return { [key]: structuredClone(store[key]) }; },
      async set(values) { metrics.sessionWrites++; Object.assign(store, structuredClone(values)); }
    },
    local: { async set() { metrics.localWrites++; } }
  } };
  try {
    const iocs = makeDetected();
    const start = performance.now();
    for (let i = 0; i < 16; i++) await saveDetectedForTab(71, iocs);
    const restored = await getDetectedForTab(71);
    return { ...metrics, count: iocs.length, restored: restored.length, duration: performance.now() - start };
  } finally { globalThis.chrome = previous; }
}

export function measurePopup(count) {
  let reads = 0;
  const entries = Array.from({ length: count }, (_, i) => ({ historyKey: `domain:host${i}.example.org` }));
  const history = new Proxy(entries, { get(target, key, receiver) {
    if (/^\d+$/.test(String(key))) reads++;
    return Reflect.get(target, key, receiver);
  } });
  const start = performance.now();
  const summary = summarizeHistoryContext(history, 'https://report.example/', makeDetected(1));
  return { reads, displayed: summary.filtered.length, duration: performance.now() - start };
}
