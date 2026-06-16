import { mkdir, readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist', 'chrome');
const artifacts = path.join(root, 'artifacts');

const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await mkdir(artifacts, { recursive: true });

const zipPath = path.join(artifacts, `mustela-v${version}-chrome.zip`);
execSync(`cd '${dist}' && zip -qr '${zipPath}' .`);
console.log(`Created ${zipPath}`);
