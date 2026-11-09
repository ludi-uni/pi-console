import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));

test('package, lockfile and PWA cache agree on the release version', async () => {
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  const worker = await readFile(new URL('public/sw.js', root), 'utf8');
  assert.ok(worker.includes(`const CACHE='pi-console-shell-v${pkg.version}';`));
});

test('the npm documentation allowlist excludes local verification archives', () => {
  assert.ok(!pkg.files.includes('docs/'), 'do not publish the whole local evidence tree');
  for (const path of ['docs/*.md', 'docs/images/', 'docs/releases/*.md']) assert.ok(pkg.files.includes(path), path);
});
