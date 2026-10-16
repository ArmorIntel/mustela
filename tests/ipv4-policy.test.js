import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { classifyIpv4, isProtectedIoc, detectSingleIoc } from '../src/shared/ioc.js';
import { PROVIDERS, getSupportedExternalProviders, isProviderSupportedForIoc } from '../src/providers/providers.js';

const ranges = [
  ['10.0.0.0', '10.255.255.255', '9.255.255.255', '11.0.0.0'],
  ['172.16.0.0', '172.31.255.255', '172.15.255.255', '172.32.0.0'],
  ['192.168.0.0', '192.168.255.255', '192.167.255.255', '192.169.0.0'],
  ['127.0.0.0', '127.255.255.255', '126.255.255.255', '128.0.0.0'],
  ['169.254.0.0', '169.254.255.255', '169.253.255.255', '169.255.0.0'],
  ['100.64.0.0', '100.127.255.255', '100.63.255.255', '100.128.0.0'],
  ['224.0.0.0', '239.255.255.255', '223.255.255.255', '240.0.0.0'],
  ['192.0.2.0', '192.0.2.255', '192.0.1.255', '192.0.3.0'],
  ['198.51.100.0', '198.51.100.255', '198.51.99.255', '198.51.101.0'],
  ['203.0.113.0', '203.0.113.255', '203.0.112.255', '203.0.114.0']
];
const ip = (normalized) => ({ type: 'ip', normalized });

test('only listed IPv4 ranges are protected, including boundaries; detection is preserved', async () => {
  const runtimeContext = {};
  vm.runInNewContext(await readFile(new URL('../src/shared/ioc.content-runtime.js', import.meta.url), 'utf8'), runtimeContext);
  for (const [first, last, before, after] of ranges) {
    for (const value of [first, last]) {
      assert.equal(classifyIpv4(value), 'internal-reserved', value);
      assert.equal(isProtectedIoc(ip(value)), true);
      assert.equal(detectSingleIoc(value)?.type, 'ip');
      assert.equal(runtimeContext.MUSTELA_SHARED.classifyIpv4(value), classifyIpv4(value));
    }
    for (const value of [before, after]) assert.equal(classifyIpv4(value), 'public', value);
  }
  for (const value of ['8.8.8.8', '1.1.1.1', '0.0.0.0', '255.255.255.255']) assert.equal(classifyIpv4(value), 'public');
  for (const value of ['999.1.1.1', '', '10.0.0.1/24', '::1']) assert.equal(classifyIpv4(value), null);
  assert.equal(detectSingleIoc('999.1.1.1'), null);
  assert.equal(isProtectedIoc({ type: 'subnet', normalized: '10.0.0.0/24' }), false);
});

test('public API and pivot entry points reject protected IPv4 before fetch or credentials', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (...args) => { calls.push(args); throw new Error('Unexpected network'); });
  for (const [first, last] of ranges) {
    for (const value of [first, last]) {
      const ioc = ip(value);
      assert.deepEqual(getSupportedExternalProviders(ioc), []);
      assert.equal(isProviderSupportedForIoc('misp', ioc), true);
      for (const id of ['virustotal', 'abuseipdb', 'shodan']) {
        assert.equal(isProviderSupportedForIoc(id, ioc), false);
        assert.equal(PROVIDERS[id].buildExternalUrl(ioc), '');
        await assert.rejects(PROVIDERS[id].lookup(ioc, {}), /Public lookups blocked for internal\/reserved IPv4/);
      }
    }
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(getSupportedExternalProviders(ip('8.8.8.8')), ['virustotal', 'abuseipdb', 'shodan']);
});
