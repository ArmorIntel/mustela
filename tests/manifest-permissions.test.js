import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest/chrome.manifest.json', import.meta.url), 'utf8'));

function assertJustifications(document, expected) {
  const sections = document.split(/^## /m).slice(1);
  const entries = sections.map((section) => {
    const [heading, ...lines] = section.split('\n');
    assert.match(heading, /^(permissions|host_permissions): `[^`]+`$/);
    const text = lines.join('\n').trim();
    assert.ok(text.length > 0, `${heading} needs a justification`);
    assert.ok(Array.from(text).length <= 1000, `${heading} exceeds the store limit`);
    return heading;
  });
  assert.deepEqual(entries.sort(), [...expected].sort(), 'justify every entry exactly once, with no obsolete entries');
}

const expected = ['permissions', 'host_permissions'].flatMap((kind) =>
  manifest[kind].map((permission) => `${kind}: \`${permission}\``));

test('manifest requests only necessary permissions and non-redundant hosts', () => {
  assert.deepEqual(manifest.permissions, ['storage', 'contextMenus', 'scripting']);
  assert.deepEqual(manifest.host_permissions, ['http://*/*', 'https://*/*']);
});

test('manifest requires Chrome 105 for CSS Custom Highlight support', () => {
  assert.equal(manifest.minimum_chrome_version, '105');
});

test('store justifications match manifest entries and stay within 1000 characters', () => {
  const document = readFileSync(new URL('../docs/store/PERMISSIONS.md', import.meta.url), 'utf8');
  assertJustifications(document, expected);
});

test('justification validation rejects missing, obsolete, duplicate, blank and overlong entries', () => {
  const heading = 'permissions: `storage`';
  const valid = `# Permissions\n\n## ${heading}\n\nSave settings locally.\n`;
  assertJustifications(valid, [heading]);
  assert.throws(() => assertJustifications('', [heading]));
  assert.throws(() => assertJustifications(valid, []));
  assert.throws(() => assertJustifications(valid + valid, [heading]));
  assert.throws(() => assertJustifications(`## ${heading}\n\n`, [heading]));
  assert.throws(() => assertJustifications(`## ${heading}\n${'x'.repeat(1001)}`, [heading]));
  assertJustifications(`## ${heading}\n${'x'.repeat(1000)}`, [heading]);
});
