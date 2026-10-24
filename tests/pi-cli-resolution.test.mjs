import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePiCli, hostPiCli } from '../package/launcher.mjs';

const pkgName = '@earendil-works/pi-coding-agent';
const pkgDirs = ['node_modules', ...pkgName.split('/')];

/** Build <agent>/install/releases/<version>/<pkg> with a manifest and cli.js. */
async function managedInstall(agent, version, { name = pkgName, manifestVersion = version, bin = 'dist/bundle/cli.js' } = {}) {
  const dir = join(agent, 'install', 'releases', version, ...pkgDirs);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version: manifestVersion, bin: typeof bin === 'string' ? { pi: bin } : bin }));
  if (typeof bin === 'string') {
    const cli = join(dir, 'dist', 'bundle'); await mkdir(cli, { recursive: true });
    await writeFile(join(cli, 'cli.js'), '// pi cli fixture');
  }
  return dir;
}
const writeSelector = (agent, version) => writeFile(join(agent, 'install', 'current-version'), `${version}\n`);
const baseEnv = () => ({ PATH: '', APPDATA: join(tmpdir(), 'no-such-appdata'), HOME: join(tmpdir(), 'no-such-home'), USERPROFILE: join(tmpdir(), 'no-such-profile'), PI_CODING_AGENT_DIR: join(tmpdir(), 'no-such-agent') });

test('managed install discovery selects the release named by current-version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-cli-managed-'));
  const agent = join(root, 'agent');
  try {
    const dir = await managedInstall(agent, '1.1.0');
    await writeSelector(agent, '1.1.0');
    const env = { ...baseEnv(), PI_CODING_AGENT_DIR: agent };
    assert.equal(resolvePiCli(env, [process.execPath]), join(dir, 'dist', 'bundle', 'cli.js'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('explicit PI_CONSOLE_PI_COMMAND stays authoritative over every other source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-cli-override-'));
  const agent = join(root, 'agent');
  try {
    await managedInstall(agent, '1.1.0'); await writeSelector(agent, '1.1.0');
    const explicit = join(root, 'elsewhere', 'cli.js');
    await mkdir(join(root, 'elsewhere')); await writeFile(explicit, '');
    assert.equal(resolvePiCli({ ...baseEnv(), PI_CODING_AGENT_DIR: agent, PI_CONSOLE_PI_COMMAND: explicit }, [process.execPath]), explicit);
    // An invalid override fails instead of silently falling back to the managed install.
    assert.throws(() => resolvePiCli({ ...baseEnv(), PI_CODING_AGENT_DIR: agent, PI_CONSOLE_PI_COMMAND: join(root, 'missing.js') }, [process.execPath]), /PI_CONSOLE_PI_COMMAND/);
    assert.throws(() => resolvePiCli({ ...baseEnv(), PI_CODING_AGENT_DIR: agent, PI_CONSOLE_PI_COMMAND: 'relative/cli.js' }, [process.execPath]), /PI_CONSOLE_PI_COMMAND/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('host argv resolution still wins before managed discovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-cli-host-'));
  try {
    const dir = join(root, 'host', 'node_modules', ...pkgName.split('/'), 'dist', 'bundle');
    await mkdir(dir, { recursive: true });
    const hosted = join(dir, 'cli.js'); await writeFile(hosted, '');
    assert.equal(resolvePiCli(baseEnv(), [process.execPath, hosted]), hosted);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('legacy npm roots still resolve before the managed fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-cli-legacy-'));
  const agent = join(root, 'agent');
  try {
    await managedInstall(agent, '1.1.0'); await writeSelector(agent, '1.1.0');
    // A stale npm global install still wins: managed discovery is only a fallback.
    const target = join(root, 'appdata', 'npm', ...pkgDirs, 'dist', 'bundle');
    await mkdir(target, { recursive: true }); await writeFile(join(target, 'cli.js'), '');
    const env = { ...baseEnv(), APPDATA: join(root, 'appdata'), PI_CODING_AGENT_DIR: agent };
    assert.equal(resolvePiCli(env, [process.execPath]), join(target, 'cli.js'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('malformed selectors and manifests never escape the managed layout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-cli-invalid-'));
  const agent = join(root, 'agent');
  const env = () => ({ ...baseEnv(), PI_CODING_AGENT_DIR: agent });
  try {
    // Selectors that fail validation or point at missing releases fall through to throw.
    for (const version of ['..', '.', '../escape', '', 'a/b', 'a\\b', 'x y', '1.0.0/../../x', '9.9.9', 'x'.repeat(129)]) {
      await mkdir(join(agent, 'install'), { recursive: true }); await writeSelector(agent, version);
      assert.throws(() => resolvePiCli(env(), [process.execPath]), /Pi CLI not found/);
    }
    // Valid selector, manifest anomalies: wrong name, version mismatch, no pi bin.
    for (const mutate of [
      manifest => ({ ...manifest, name: 'other/pkg' }),
      manifest => ({ ...manifest, version: '9.9.9' }),
      manifest => ({ ...manifest, bin: { other: 'x.js' } }),
      manifest => ({ ...manifest, extra: 'x'.repeat(65536) }),
    ]) {
      const dir = join(agent, 'install', 'releases', '1.1.0', ...pkgDirs);
      await rm(join(agent, 'install', 'releases'), { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      const manifest = mutate({ name: pkgName, version: '1.1.0', bin: { pi: 'dist/bundle/cli.js' } });
      await writeFile(join(dir, 'package.json'), JSON.stringify(manifest));
      await mkdir(join(dir, 'dist', 'bundle'), { recursive: true }); await writeFile(join(dir, 'dist', 'bundle', 'cli.js'), '');
      await writeSelector(agent, '1.1.0');
      assert.throws(() => resolvePiCli(env(), [process.execPath]), /Pi CLI not found/);
    }
    // A bin path that escapes its package is rejected, not followed.
    const dir = join(agent, 'install', 'releases', '1.1.0', ...pkgDirs);
    await rm(join(agent, 'install', 'releases'), { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const outside = join(agent, 'install', 'releases', '1.1.0', 'outside.js'); await writeFile(outside, '');
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: pkgName, version: '1.1.0', bin: { pi: '../../outside.js' } }));
    await writeSelector(agent, '1.1.0');
    assert.throws(() => resolvePiCli(env(), [process.execPath]), /Pi CLI not found/);
    // Missing cli.js file (manifest is fine, target absent) also fails discovery.
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: pkgName, version: '1.1.0', bin: { pi: 'dist/bundle/cli.js' } }));
    assert.throws(() => resolvePiCli(env(), [process.execPath]), /Pi CLI not found/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('managed discovery is skipped without a valid agent install and homedir default is respected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-cli-nohome-'));
  try {
    assert.throws(() => resolvePiCli(baseEnv(), [process.execPath]), /Pi CLI not found/);
    // hostPiCli rejects non-Pi argv entries even when absolute and existing.
    const notPi = join(root, 'node_modules', 'other', 'cli.js');
    await mkdir(join(root, 'node_modules', 'other'), { recursive: true }); await writeFile(notPi, '');
    assert.equal(hostPiCli([process.execPath, notPi]), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});
