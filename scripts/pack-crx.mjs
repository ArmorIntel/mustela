import fs from 'node:fs/promises';
import path from 'node:path';
import crx3 from 'crx3';

const root = process.cwd();
const dist = path.join(root, 'dist', 'chrome');
const artifacts = path.join(root, 'artifacts');
const keyPath = path.join(artifacts, 'mustela.pem');
const crxPath = path.join(artifacts, 'mustela-v0.2.0.crx');
await fs.mkdir(artifacts, { recursive: true });
await crx3([dist], {
  crxPath,
  keyPath,
  zipPath: ''
});
console.log(`Created ${crxPath}`);
