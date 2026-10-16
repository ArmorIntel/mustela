import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourcePath = 'src/shared/ioc.js';
const runtimePath = 'src/shared/ioc.content-runtime.js';
const repair = 'Run npm run build, then stage and commit src/shared/ioc.js and src/shared/ioc.content-runtime.js.';

function run(cwd, command, args) {
  const env = { ...process.env };
  // A child npm test is an independent runner, not a recursive node:test invocation.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 30000 });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}

function succeed(result) {
  assert.equal(result.status, 0, result.output);
}

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'mustela-ioc-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const entry of ['scripts', 'src', 'public', 'manifest', 'package.json']) {
    await cp(path.join(root, entry), path.join(dir, entry), { recursive: true });
  }
  await mkdir(path.join(dir, 'tests/helpers'), { recursive: true });
  for (const entry of ['ioc-runtime.test.js', 'helpers/check-ioc-runtime.mjs']) {
    await cp(path.join(root, 'tests', entry), path.join(dir, 'tests', entry));
  }
  succeed(run(dir, 'git', ['init', '-q']));
  succeed(run(dir, 'git', ['add', 'src']));
  await mkdir(path.join(dir, 'dist'));
  await writeFile(path.join(dir, 'dist/sentinel'), 'must not change');
  return dir;
}

async function snapshot(dir) {
  const files = {};
  async function visit(relative) {
    for (const entry of await readdir(path.join(dir, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else files[name] = await readFile(path.join(dir, name));
    }
  }
  await visit('src');
  await visit('dist');
  try {
    files.index = await readFile(path.join(dir, '.git/index'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    files.index = null;
  }
  return files;
}

async function checkWithoutMutation(dir, diagnostic) {
  const before = await snapshot(dir);
  const result = run(dir, 'npm', ['test']);
  assert.deepEqual(await snapshot(dir), before, 'freshness check must not mutate source, dist or Git index');
  if (diagnostic) {
    assert.equal(result.status, 1, result.output);
    assert.ok(result.output.includes(runtimePath), result.output);
    assert.ok(result.output.includes(repair), result.output);
    assert.match(result.output, diagnostic);
  } else succeed(result);
  return result;
}

test('fresh runtime passes npm test without mutations', async (t) => {
  await checkWithoutMutation(await fixture(t));
});

for (const [name, mutate, diagnostic] of [
  ['changed source', async (dir) => {
    const file = path.join(dir, sourcePath);
    await writeFile(file, await readFile(file, 'utf8') + '\n// source change\n');
  }, /working tree differs/],
  ['altered runtime bytes', async (dir) => {
    const file = path.join(dir, runtimePath);
    await writeFile(file, (await readFile(file)).subarray(0, -1));
  }, /working tree differs/],
  ['missing source', (dir) => rm(path.join(dir, sourcePath)), /Cannot read source/],
  ['missing runtime', (dir) => rm(path.join(dir, runtimePath)), /Cannot read working tree/],
  ['missing indexed runtime', async (dir) => {
    succeed(run(dir, 'git', ['rm', '--cached', runtimePath]));
  }, /Cannot read Git index/],
  ['missing Git index', (dir) => rm(path.join(dir, '.git/index')), /Cannot read Git index/],
  ['missing Git repository', (dir) => rm(path.join(dir, '.git'), { recursive: true }), /Cannot read Git index/],
  ['runtime with invalid UTF-8 bytes', async (dir) => {
    const file = path.join(dir, runtimePath);
    await writeFile(file, Buffer.concat([await readFile(file), Buffer.from([0xff])]));
  }, /working tree differs/]
]) {
  test(`${name} fails npm test with a repair diagnostic and no mutations`, async (t) => {
    const dir = await fixture(t);
    await mutate(dir);
    await checkWithoutMutation(dir, diagnostic);
  });
}

test('build cannot hide a stale indexed runtime; staging the regenerated runtime repairs it', async (t) => {
  const dir = await fixture(t);
  const file = path.join(dir, sourcePath);
  await writeFile(file, await readFile(file, 'utf8') + '\n// source change\n');
  succeed(run(dir, 'git', ['add', sourcePath]));
  succeed(run(dir, 'npm', ['run', 'build']));
  const failed = await checkWithoutMutation(dir, /Git index differs/);
  t.diagnostic(`Stale fixture: npm test exit ${failed.status}; Git index differs; ${repair}`);
  succeed(run(dir, 'git', ['add', runtimePath]));
  await checkWithoutMutation(dir);
});

test('CLI regeneration preserves the existing bytes and is deterministic', async (t) => {
  const dir = await fixture(t);
  const expected = await readFile(path.join(dir, runtimePath));
  for (let i = 0; i < 2; i++) {
    succeed(run(dir, process.execPath, ['scripts/generate-content-ioc-runtime.mjs']));
    assert.deepEqual(await readFile(path.join(dir, runtimePath)), expected);
  }
});
