import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, firefox, expect } from '@playwright/test';
import { build } from 'vite';
import { mkdir, writeFile, rm, mkdtemp, appendFile, access } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { folderFixture } from './helpers/folder-mcp.fixture.ts';
import { ownerOrigin, privatePost } from '../package/local-folder-mcp.mjs';

const evidence = process.env.FOLDER_MCP_BROWSER_EVIDENCE!;
test('owner UI: installed Chromium/Firefox desktop/mobile; cancel, double click, lost response, recovery, revoke', { timeout: 120000 }, async () => {
  assert(evidence && resolve(evidence).startsWith(resolve(process.env.FOLDER_MCP_TASK_ROOT!) + '\\'));
  await mkdir(evidence, { recursive: true });
  const bundle = await build({ configFile: false, envFile: false, root: process.cwd(), build: { write: false, minify: false, rollupOptions: { input: resolve('owner.html') } } });
  const assets = (Array.isArray(bundle) ? bundle[0] : bundle) as any;
  const results: any[] = [];
  for (const executable of [{ name: 'chromium', engine: chromium, path: process.env.FOLDER_MCP_CHROMIUM! }, { name: 'firefox', engine: firefox, path: process.env.FOLDER_MCP_FIREFOX! }]) for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    assert(executable.path && resolve(executable.path).startsWith(resolve(process.env.FOLDER_MCP_TASK_ROOT!) + '\\browser-runtime\\'));
    const label = executable.name + '-' + viewport.width, f = await folderFixture(), profile = await mkdtemp(join(evidence, 'dummy-browser-'));
    let browser: any; const actions: string[] = [], errors: string[] = [];
    const action = async (label: string, work: () => Promise<any>) => { await work(); actions.push(label); };
    const lifecycle = process.env.FOLDER_MCP_LIFECYCLE!;
    try {
      await appendFile(lifecycle, JSON.stringify({ phase: 'created', kind: 'dummy-browser', profile, browser: executable.name, viewport }) + '\n');
      for (const a of assets.output) { assert(!a.fileName.includes('..')); const p = join(f.assets, a.fileName); await mkdir(dirname(p), { recursive: true }); await writeFile(p, a.type === 'chunk' ? a.code : a.source); }
      const issued = await f.issue(); assert.equal(issued.status, 200); const url = issued.body.url, origin = ownerOrigin(url);
      const env: Record<string, string> = { HOME: profile, USERPROFILE: profile, APPDATA: join(profile, 'AppData', 'Roaming'), LOCALAPPDATA: join(profile, 'AppData', 'Local'), TEMP: profile, TMP: profile };
      await mkdir(env.APPDATA, { recursive: true }); await mkdir(env.LOCALAPPDATA, { recursive: true });
      for (const k of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'ComSpec']) if (process.env[k]) env[k] = process.env[k]!;
      browser = await executable.engine.launchPersistentContext(join(profile, 'browser'), { executablePath: executable.path, headless: true, env, viewport, timeout: 20000 });
      await appendFile(lifecycle, JSON.stringify({ phase: 'ready', kind: 'dummy-browser', profile, browser: executable.name }) + '\n');
      browser.setDefaultTimeout(10000);
      await browser.route('**/*', (route: any) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await browser.newPage(); page.on('pageerror', () => errors.push('pageerror'));
      await action('open owner page', () => page.goto(url));
      await expect(page.getByLabel('One-time bootstrap code')).toBeVisible();
      await page.screenshot({ path: join(evidence, label + '-login.png'), fullPage: true });
      await action('enter dummy bootstrap', () => page.getByLabel('One-time bootstrap code').fill(issued.body.code));
      await action('confirm login', () => page.getByRole('button', { name: '一回コードでログイン', exact: true }).click());
      await expect(page.getByRole('button', { name: 'ローカル連携を始める', exact: true })).toBeVisible();
      assert.equal(await page.locator('input[type=password]').count(), 0);
      const cookies = await browser.cookies(url); assert.equal(cookies.length, 1); assert(cookies[0].httpOnly); const cookie = cookies[0].name + '=' + cookies[0].value;
      const p: any = await privatePost(origin, 'request', { name: 'Generic dummy MCP client' });
      await action('start local integration', () => page.getByRole('button', { name: 'ローカル連携を始める', exact: true }).click());
      await expect(page.getByLabel('MCP stdio configuration')).toBeVisible();
      await expect(page.getByLabel('Pending MCP connection')).toContainText('Generic dummy MCP client');
      await action('select pending client', () => page.getByLabel('Pending MCP connection').selectOption(p.connectionId));
      await action('choose allowed parent', () => page.getByLabel('Allowed parent folder').fill('D:\\Allowed'));
      await action('review scope', () => page.getByRole('button', { name: '許可内容を確認', exact: true }).click());
      await expect(page.getByLabel('Confirm parent scope')).toBeVisible();
      await page.screenshot({ path: join(evidence, label + '-review.png'), fullPage: true });
      await action('back and cancel', () => page.getByRole('button', { name: '戻る・取消', exact: true }).click());
      await expect(page.getByLabel('Pending MCP connection')).toBeVisible();
      assert.equal(f.folders.issues(), 1);
      await action('review edited scope', () => page.getByRole('button', { name: '許可内容を確認', exact: true }).click());
      await action('confirm scope', () => page.getByLabel('Confirm parent scope').check());
      let approvals = 0;
      await page.route('**/local-owner/folder/approve', async (route: any) => { approvals++; const response = await f.browser('folder/approve', route.request().postDataJSON(), cookie); assert.equal(response.status, 200); await route.abort('failed'); });
      await action('double click approval with response loss', () => page.getByRole('button', { name: '許可して接続', exact: true }).dblclick());
      await expect(page.getByRole('button', { name: '保存結果を照合', exact: true })).toBeVisible();
      assert.equal(approvals, 1); assert.equal(f.folders.issues(), 5);
      await page.unroute('**/local-owner/folder/approve');
      await action('reload after unknown outcome', () => page.reload());
      await expect(page.getByRole('button', { name: '保存結果を照合', exact: true })).toBeVisible();
      await action('inspect approval receipt', () => page.getByRole('button', { name: '保存結果を照合', exact: true }).click());
      await expect(page.getByRole('button', { name: '保存結果を照合', exact: true })).toHaveCount(0);
      const c: any = await privatePost(origin, 'claim', { connectionId: p.connectionId, proof: p.proof }); assert.equal(c.state, 'connected');
      assert(!(await page.locator('body').innerText()).includes(c.token)); assert(!JSON.stringify(await page.evaluate(() => ({ ...sessionStorage }))).includes(c.token));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: join(evidence, label + '-connected.png'), fullPage: true });
      await action('revoke all in one place', () => page.getByRole('button', { name: 'このローカル連携をすべて解除', exact: true }).click());
      await expect(page.locator('li').filter({ hasText: 'revoked' })).toHaveCount(1);
      await assert.rejects(privatePost(origin, 'rpc', { method: 'tools/list', name: null, arguments: null }, c.token));
      assert.deepEqual(errors, []); assert.equal(approvals, 1);
      results.push({ browser: executable.name, viewport, actions, actionCount: actions.length, approvals, roleIssues: 3, noHumanKeys: true, cancelledWithoutIssuance: true, unknownOutcomeRecovered: true, revokeEnforced: true, overflow: false, pageErrors: errors.length });
    } finally {
      await browser?.close(); await f.cleanup();
      assert(resolve(profile).startsWith(resolve(evidence) + '\\')); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      assert.equal(await access(profile).then(() => true, () => false), false);
      await appendFile(lifecycle, JSON.stringify({ phase: 'closed', kind: 'dummy-browser', profile, browserClosed: true, profileRemoved: true }) + '\n');
    }
  }
  await writeFile(join(evidence, 'browser-proof.json'), JSON.stringify({ results, imageCount: results.length * 3, actionCount: results.reduce((n, r) => n + r.actionCount, 0), productionApplied: false, realClient: false, realCredentials: false, provider: 'fake' }, null, 2));
});
