import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDefenderQuery, kqlStringLiteral } from '../src/shared/hunting.js';

const header = '// Microsoft Defender XDR Advanced Hunting — requires Defender for Endpoint telemetry';
for (const [input, table, filter] of [
  [' 8.8.8.8 ', 'DeviceNetworkEvents', 'RemoteIP == "8.8.8.8"'],
  ['EVIL.Example.org', 'DeviceNetworkEvents', 'RemoteUrl =~ "evil.example.org"'],
  ['https://evil.example.org/Path?q=Mixed&x=1', 'DeviceNetworkEvents', 'RemoteUrl == "https://evil.example.org/Path?q=Mixed&x=1"'],
  ['A'.repeat(32), 'DeviceFileEvents', `MD5 =~ "${'a'.repeat(32)}"`],
  ['B'.repeat(40), 'DeviceFileEvents', `SHA1 =~ "${'b'.repeat(40)}"`],
  ['C'.repeat(64), 'DeviceFileEvents', `SHA256 =~ "${'c'.repeat(64)}"`]
]) {
  test(`exact Defender template for ${input.trim()}`, () => {
    assert.equal(generateDefenderQuery(input).query, `${header}\n${table}\n| where Timestamp >= ago(7d)\n| where ${filter}`);
  });
}

for (const input of ['', ' ', '999.1.1.1', 'text 8.8.8.8', '8.8.8.8 text', '8.8.8.8 1.1.1.1', 'AS123', '8.8.8.0/24', '2001:db8::1', 'a@evil.example.org', 'ftp://evil.example.org', 'https://', 'https://999.1.1.1', 'evil.example.org" | take 1', 'https://evil.example.org/"|take', '8.8.8.8\n', '\t8.8.8.8', 'https://evil.example.org/\u0000', 'https://evil.example.org/\u007f', 'https://evil.example.org/\u0085']) {
  test(`reject entire unsupported or unsafe input ${JSON.stringify(input)}`, () => {
    const result = generateDefenderQuery(input);
    assert.equal(result.query, null);
    assert.ok(result.reason);
  });
}

test('KQL literals escape backslashes and double quotes, not HTML', () => {
  assert.equal(kqlStringLiteral('a\\b"<&'), '"a\\\\b\\"<&"');
  assert.throws(() => kqlStringLiteral('a\nb'), /control/i);
  const input = 'https://evil.example.org/a\\b?x=1|take';
  assert.equal(generateDefenderQuery(input).query, `${header}\nDeviceNetworkEvents\n| where Timestamp >= ago(7d)\n| where RemoteUrl == "https://evil.example.org/a\\\\b?x=1|take"`);
});
