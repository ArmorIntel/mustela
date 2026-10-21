import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../src/content/content.js', import.meta.url), 'utf8');
const panelStyles = await fs.readFile(new URL('../src/content/panel.css', import.meta.url), 'utf8');
const pageStyles = await fs.readFile(new URL('../src/content/content.css', import.meta.url), 'utf8');

function harness() {
  let attachments = 0;
  const roots = [];
  const makeElement = () => ({
    dataset: {}, children: [], isConnected: false, className: '',
    style: { values: {}, setProperty(name, value, priority) { this.values[name] = { value, priority }; } },
    append(child) { this.children.push(child); child.isConnected = true; },
    remove() { this.isConnected = false; },
    addEventListener() {},
    attachShadow(options) {
      attachments++;
      const root = { ...makeElement(), mode: options.mode, host: this };
      roots.push(root);
      return root;
    }
  });
  const documentElement = makeElement();
  const context = vm.createContext({
    crypto: webcrypto, clearTimeout,
    document: { documentElement, createElement: makeElement },
    chrome: { runtime: { id: 'fixture', onMessage: { addListener() {}, removeListener() {} } } }
  });
  vm.runInContext(source.replace('bootstrap();', 'globalThis.run = code => eval(code);'), context);
  return { run: context.run, documentElement, roots, get attachments() { return attachments; } };
}

test('UI reuses one anonymous closed root with important boundary resets and internal styles', () => {
  const h = harness();
  const root = h.run('ensureUiRoot()');
  assert.equal(root.mode, 'closed');
  assert.equal(h.run('ensureUiRoot()'), root);
  assert.equal(h.attachments, 1);
  assert.equal(root.host.className, '');
  assert.equal(root.host.id, undefined);
  assert.deepEqual(root.host.style.values.all, { value: 'initial', priority: 'important' });
  assert.deepEqual(root.host.style.values.position, { value: 'fixed', priority: 'important' });
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].textContent, '', 'source placeholder is populated only in the packaged content script');
  root.host.remove();
  assert.equal(h.run('ensureUiRoot()'), root, 'reattaching a detached host must not allocate a new root');
  assert.equal(h.attachments, 1);
  h.run('dispose()');
  assert.equal(root.host.isConnected, false);
  assert.equal(h.run('uiRoot'), null);
});

test('only page highlights stay global; UI styles have one moderate blur and an opaque alternative', () => {
  assert.doesNotMatch(pageStyles, /\.mustela-panel|\.mustela-page-indicator|\.mustela-ioc-tip/);
  assert.match(pageStyles, /::highlight\(mustela-ioc\)/);
  assert.equal((panelStyles.match(/backdrop-filter: blur\(/g) || []).length, 1);
  assert.match(panelStyles, /backdrop-filter: blur\(12px\)/);
  assert.match(panelStyles, /prefers-reduced-transparency: reduce/);
  assert.match(panelStyles, /--panel-bg: #161c26; backdrop-filter: none/);
});
