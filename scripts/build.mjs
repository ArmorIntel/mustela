import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import './generate-content-ioc-runtime.mjs';

const root = process.cwd();
const dist = path.join(root, 'dist', 'chrome');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(path.join(root, 'src'), path.join(dist, 'src'), { recursive: true });
// Keep shadow UI styles private without adding manifest resources or a fetch.
const contentPath = path.join(dist, 'src/content/content.js');
const content = await readFile(contentPath, 'utf8');
const panelStyles = await readFile(path.join(root, 'src/content/panel.css'), 'utf8');
await writeFile(contentPath, content.replace('/* MUSTELA_UI_STYLES */ ""', () => JSON.stringify(panelStyles)));
await cp(path.join(root, 'public'), path.join(dist, 'public'), { recursive: true });
await cp(path.join(root, 'manifest', 'chrome.manifest.json'), path.join(dist, 'manifest.json'));
console.log(`Built Chrome extension into ${dist}`);
