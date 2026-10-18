// Generated synthetic data: no captured page or analyst data.
export const mixedRow = '8.8.8.8 2001:db8::1 https://evil.example.org/a evil[.]example.org d41d8cd98f00b204e9800998ecf8427e A@evil.org AS13335 10.0.0.0/24\n';
const repeatTo = (row, length) => row.repeat(Math.ceil(length / row.length)).slice(0, length);
export const parserFixtures = [
  { name: 'dense log', make: (length) => repeatTo(mixedRow, length) },
  { name: 'no IOC', make: (length) => repeatTo('plain event accepted without indicators\n', length), empty: true },
  ...['a.', '1.'].map((token) => ({ name: `pathological ${token}`, make: (length) => repeatTo(token, length), empty: token === 'a.' })),
  { name: 'minified JSON', make: (length) => JSON.stringify({ payload: repeatTo('a.', length - 14) }), empty: true }
];

// Minimal text-node DOM adapter for Node scan accounting, not a browser emulator.
// Real TreeWalker/filter/highlight behavior remains covered by scanning E2E.
export function makePageNodes(count) {
  const parentElement = { closest: () => null };
  return Array.from({ length: count }, (_, i) => ({
    nodeType: 3, isConnected: true, parentElement,
    nodeValue: i === 0 ? parserFixtures[2].make(40000) : `plain event ${i}`
  }));
}

export function makeDetected(count = 500) {
  return Array.from({ length: count }, (_, i) => ({
    type: 'domain', raw: `host${i}.example.org`, normalized: `host${i}.example.org`,
    sourceContext: { pageUrl: 'https://report.example/', pageTitle: 'Synthetic report' }
  }));
}
