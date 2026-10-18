import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateContentIocRuntime } from './content-ioc-runtime.mjs';

const root = process.cwd();
const sourcePath = path.join(root, 'src', 'shared', 'ioc.js');
const targetPath = path.join(root, 'src', 'shared', 'ioc.content-runtime.js');

const source = await readFile(sourcePath, 'utf8');
const exclusions = await readFile(path.join(root, 'src', 'shared', 'exclusions.js'), 'utf8');
await writeFile(targetPath, generateContentIocRuntime(source, exclusions));
console.log(`Generated ${path.relative(root, targetPath)} from ${path.relative(root, sourcePath)}`);
