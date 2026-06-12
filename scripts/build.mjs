import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import './generate-content-ioc-runtime.mjs';

const root = process.cwd();
const dist = path.join(root, 'dist', 'chrome');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(path.join(root, 'src'), path.join(dist, 'src'), { recursive: true });
await cp(path.join(root, 'public'), path.join(dist, 'public'), { recursive: true });
await cp(path.join(root, 'manifest', 'chrome.manifest.json'), path.join(dist, 'manifest.json'));
console.log(`Built Chrome extension into ${dist}`);
