import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest/chrome.manifest.json', root), 'utf8'));

function section(listing, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = listing.match(new RegExp(`^## ${escaped}\\n+([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
  assert.ok(match, `Missing listing field: ${heading}`);
  const text = match[1].trim();
  assert.ok(text, `Empty listing field: ${heading}`);
  return text;
}

test('store listing provides required copy and matches the manifest within store limits', () => {
  const listing = readFileSync(new URL('docs/store/LISTING.md', root), 'utf8');
  assert.equal(section(listing, 'Name'), manifest.name);
  const description = section(listing, 'Short description');
  assert.ok(description.length <= 132, `Short description has ${description.length} characters`);
  assert.equal(description, manifest.description);
  for (const heading of ['Detailed description', 'Proposed categories', 'Language', 'Single purpose', 'Data usage', 'Remote code']) {
    section(listing, heading);
  }
  assert.equal(section(listing, 'Privacy policy URL'), 'https://github.com/ArmorIntel/mustela/blob/next/docs/PRIVACY_TRANSPARENCY.md');
  assert.equal(section(listing, 'Support URL'), 'https://github.com/ArmorIntel/mustela/issues');
  const keywords = section(listing, 'Edge keywords').split(',').map((word) => word.trim());
  assert.ok(keywords.length >= 1 && keywords.length <= 7);
  assert.ok(keywords.every(Boolean));
  assert.equal(new Set(keywords).size, keywords.length);
});
