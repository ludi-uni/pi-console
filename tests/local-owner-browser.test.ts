import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { build } from 'vite';
import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { ownerFixture, keys } from './local-owner.fixture.ts';
test('actual owner browser on desktop/mobile logs in, saves separate keys, inspects unknown result and revokes', { timeout: 60000 }, async () => {
    const evidence = process.env.TRUSTED_LOCAL_TEST_OWNER_BROWSER_EVIDENCE!;
    assert(evidence && resolve(evidence).replaceAll(String.fromCharCode(92),'/').startsWith(resolve(process.env.TRUSTED_LOCAL_TEST_REPORTS_ROOT ?? resolve('..', 'reports')).replaceAll(String.fromCharCode(92),'/') + '/'));
    await mkdir(evidence, { recursive: false });
    const proof = [];
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
        let f: Awaited<ReturnType<typeof ownerFixture>> | undefined, browser: any;
        const profile = await mkdtemp(join(tmpdir(), 'dummy-owner-browser-'));
        try {
            f = await ownerFixture({ withConsole: true });
            const bundle = await build({ configFile: false, envFile: false, root: process.cwd(), build: { write: false, minify: false, rollupOptions: { input: resolve('owner.html') } } });
            const output = (Array.isArray(bundle) ? bundle[0] : bundle) as any;
            for (const a of output.output) {
                assert(!a.fileName.includes('..'));
                const p = join(f.assets, a.fileName);
                await mkdir(dirname(p), { recursive: true });
                await writeFile(p, a.type === 'chunk' ? a.code : a.source);
            }
            const issued = await f.issue();
            assert.equal(issued.status, 200);
            const url = issued.body.url, origin = new URL(url).origin;
            const local = join(profile, 'AppData', 'Local'), roaming = join(profile, 'AppData', 'Roaming');
            await mkdir(local, { recursive: true });
            await mkdir(roaming, { recursive: true });
            const env: Record<string, string> = { HOME: profile, USERPROFILE: profile, APPDATA: roaming, LOCALAPPDATA: local, TEMP: profile, TMP: profile };
            for (const k of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'ComSpec'])
                if (process.env[k])
                    env[k] = process.env[k]!;
            browser = await chromium.launchPersistentContext(join(profile, 'explicit-test-profile'), { executablePath: process.env.TRUSTED_LOCAL_TEST_BROWSER, headless: true, env, viewport });
            await browser.route('**/*', (r: any) => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
            const page = await browser.newPage(), errors: string[] = [];
            page.on('pageerror', () => errors.push('browser_script_error'));
            await page.goto(url);
            await expect(page.getByLabel('One-time bootstrap code')).toBeVisible();
            await page.screenshot({ path: join(evidence, `login-${viewport.width}.png`), fullPage: true });
            await page.getByLabel('One-time bootstrap code').fill(issued.body.code);
            await page.getByRole('button', { name: '一回コードでログイン', exact: true }).click();
            await expect(page.getByLabel('MCP read credential')).toBeVisible();
            assert.equal(await page.evaluate(() => document.cookie.includes('pi_console_local_owner_')), false);
            const cookies = await browser.cookies(url);
            assert.equal(cookies.length, 1);
            assert(cookies[0].httpOnly);
            assert.equal(cookies[0].sameSite, 'Strict');
            const cookie = cookies[0].name + '=' + cookies[0].value;
            for (const role of ['read', 'control', 'final'] as const)
                await page.getByLabel(`MCP ${role} credential`).fill(keys[role]);
            await page.getByLabel('Confirm separate credentials').check();
            const save = page.getByRole('button', { name: '確認した別キー設定を保存', exact: true });
            await expect(save).toBeEnabled();
            let saves = 0, saveStatus = 0;
            await page.route('**/local-owner/credentials/save', async (route: any) => { saves++; const response = await f!.browser('credentials/save', route.request().postDataJSON(), cookie); saveStatus = response.status; await route.abort('failed'); });
            await save.click();
            await expect(page.getByRole('button', { name: 'キー設定の保存結果を照会', exact: true })).toBeVisible();
            await expect.poll(() => saveStatus).toBe(200);
            assert.equal(saves, 1);
            for (const role of ['read', 'control', 'final'])
                await expect(page.getByLabel(`MCP ${role} credential`)).toHaveValue('');
            await page.unroute('**/local-owner/credentials/save');
            await page.reload();
            await expect(page.getByRole('button', { name: 'キー設定の保存結果を照会', exact: true })).toBeVisible();
            await page.getByRole('button', { name: 'キー設定の保存結果を照会', exact: true }).click();
            await expect(page.getByRole('button', { name: 'キー設定の保存結果を照会', exact: true })).toHaveCount(0);
            assert.equal(saves, 1);
            assert.equal((await f.app.profile.view()).enabled, false);
            await page.screenshot({ path: join(evidence, `configured-${viewport.width}.png`), fullPage: true });
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
            await page.getByRole('button', { name: 'ログアウトして失効', exact: true }).click();
            await expect(page.getByLabel('One-time bootstrap code')).toBeVisible();
            assert.equal((await f.browser('auth/status', {}, cookie)).status, 401);
            assert.deepEqual(errors, []);
            proof.push({ viewport, actualBrowserLogin: true, httpOnlyCookie: true, unknownSaveNoResend: true, maskedResult: true, logoutRevoked: true, enabled: false });
        }
        finally {
            await browser?.close();
            await f?.cleanup();
            await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    }
    await writeFile(join(evidence, 'proof.json'), JSON.stringify({ kind: 'dummy-local-owner-browser', results: proof, ownedFixturesClosed: true, tempRemoved: true, realCredentials: false, realPiProviderSdkAuthDiscovery: false, osIsolationTest: false, productionApplied: false }) + '\n');
});
