import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../src/content/content.js', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function harness(options = {}) {
  const state = { paused: false, listener: null, scans: 0, lookup: 0, rendered: 0, observed: false, ...options };
  const context = vm.createContext({
    state, setTimeout, clearTimeout,
    location: { href: 'https://fixture.example/' },
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class {
      observe() { state.observed = true; }
      disconnect() { state.observed = false; }
    },
    document: {
      documentElement: { dataset: {} }, body: {},
      querySelectorAll: () => [],
      createTreeWalker: () => { state.scans++; return { nextNode: () => false }; }
    },
    chrome: { runtime: {
      onMessage: { addListener: (fn) => { state.listener = fn; } },
      async sendMessage(message) {
        if (message.type === 'GET_PAUSE_STATE') return state.read ? state.read() : { ok: true, data: { paused: state.paused } };
        if (message.type === 'GET_CONTENT_SETTINGS') return { ok: true, data: {} };
        if (message.type === 'GET_DETECTION_POLICY') return state.policy ? state.policy() : { ok: true, data: { rules: [], excluded: false } };
        if (message.type === 'LOOKUP_IOC') { state.lookup++; return state.response.promise; }
        return { ok: true };
      }
    } }
  });
  vm.runInContext(source, context);
  vm.runInContext(`renderPanelSkeleton = () => { closePanel(); panelEl = { remove() {} }; };
    renderResult = () => { state.rendered++; };
    renderError = () => { state.rendered++; };`, context);
  return { state, context, run: (code) => vm.runInContext(code, context),
    notify: () => new Promise((resolve) => state.listener({ type: 'PAUSE_STATE_UPDATED', payload: { paused: state.paused } }, {}, resolve)) };
}

test('content invalidates cached late replies across OFF/ON before any rerun or rendering', async () => {
  const h = harness();
  await tick();
  h.state.response = deferred();
  const opening = h.run("openPanel({ type: 'ip', normalized: '8.8.8.8' }, false)");
  await tick();
  assert.equal(h.state.lookup, 1);
  h.state.paused = true;
  await h.notify();
  assert.equal(h.state.observed, false);
  h.state.paused = false;
  await h.notify();
  assert.equal(h.state.observed, true);
  h.state.response.resolve({ ok: true, data: { cached: true } });
  await opening;
  assert.equal(h.state.lookup, 1, 'late cache must not trigger a second send');
  assert.equal(h.state.rendered, 0);
});

test('stale startup confirmation cannot overwrite OFF and queued opens stay closed', async () => {
  const h = harness();
  const stale = deferred();
  h.state.read = () => stale.promise;
  await tick();
  h.state.read = null;
  h.state.paused = true;
  await h.notify();
  stale.resolve({ ok: true, data: { paused: false } });
  await tick();
  assert.equal(h.state.scans, 0);
  assert.equal(h.state.observed, false);
  await h.run("openPanel({ type: 'ip', normalized: '8.8.8.8' }, true)");
  assert.equal(h.state.lookup, 0);
  assert.equal(h.run('panelEl'), null);
  h.state.paused = false;
  await h.notify();
  assert.ok(h.state.scans > 0);
});

test('failed content initialization is fail-closed and a later confirmed ON recovers', async () => {
  const h = harness();
  h.state.read = async () => { throw new Error('Worker unavailable'); };
  await tick();
  assert.equal(h.state.scans, 0);
  assert.equal(h.state.observed, false);
  h.state.read = null;
  await h.notify();
  assert.ok(h.state.scans > 0);
});

test('exclusion changes invalidate late panel replies without replay after removal', async () => {
  const h = harness();
  await tick();
  h.state.response = deferred();
  const opening = h.run("openPanel({ type: 'ip', normalized: '8.8.8.8' }, false)");
  await tick();
  h.state.policy = async () => ({ ok: true, data: { rules: [], excluded: true } });
  await new Promise((resolve) => h.state.listener({ type: 'EXCLUSIONS_UPDATED' }, {}, resolve));
  assert.equal(h.run('extensionDisabled'), true);
  h.state.policy = null;
  await new Promise((resolve) => h.state.listener({ type: 'EXCLUSIONS_UPDATED' }, {}, resolve));
  h.state.response.resolve({ ok: true, data: { cached: true } });
  await opening;
  assert.equal(h.state.lookup, 1);
  assert.equal(h.state.rendered, 0);
  assert.equal(h.run('panelEl'), null);
});

test('unavailable exclusion policy fails detection closed and a new confirmed policy recovers', async () => {
  const h = harness({ policy: async () => { throw new Error('Unavailable'); } });
  await tick();
  assert.equal(h.state.scans, 0);
  assert.equal(h.run('extensionDisabled'), true);
  h.state.policy = null;
  await new Promise((resolve) => h.state.listener({ type: 'EXCLUSIONS_UPDATED' }, {}, resolve));
  assert.ok(h.state.scans > 0);
});
