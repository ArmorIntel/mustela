import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { generateContentIocRuntime } from '../../scripts/content-ioc-runtime.mjs';

const runtimePath = 'src/shared/ioc.content-runtime.js';
const repair = 'Run npm run build, then stage and commit src/shared/ioc.js and src/shared/ioc.content-runtime.js.';

function failure(message, cause) {
  return new Error(`${runtimePath}: ${message}. ${repair}`, { cause });
}

export async function checkIocRuntime(root) {
  let source;
  try {
    source = await readFile(path.join(root, 'src/shared/ioc.js'), 'utf8');
  } catch (cause) {
    throw failure('Cannot read source src/shared/ioc.js', cause);
  }

  let expected;
  try {
    const exclusions = await readFile(path.join(root, 'src/shared/exclusions.js'), 'utf8');
    expected = Buffer.from(generateContentIocRuntime(source, exclusions));
  } catch (cause) {
    throw failure('Cannot generate runtime from src/shared/ioc.js', cause);
  }

  let workingTree;
  try {
    workingTree = await readFile(path.join(root, runtimePath));
  } catch (cause) {
    throw failure('Cannot read working tree runtime', cause);
  }

  let indexed;
  try {
    indexed = execFileSync('git', ['show', `:${runtimePath}`], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (cause) {
    throw failure('Cannot read Git index runtime (Git and a staged runtime are required)', cause);
  }

  // Compare bytes, not decoded or normalized text, and keep failure output concise.
  assert.ok(workingTree.equals(expected), `${runtimePath}: working tree differs from regenerated source. ${repair}`);
  assert.ok(indexed.equals(expected), `${runtimePath}: Git index differs from regenerated source. ${repair}`);
}
