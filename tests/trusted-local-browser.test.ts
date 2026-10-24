import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { build } from 'vite';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { localFixture, dummyKeys } from './trusted-local.fixture.ts';
test('actual desktop/mobile UI requires review+confirmation, keeps unknown save pending, inspects receipt and revokes', { timeout: 60000 }, async () => {
    const evidence = process.env.TRUSTED_LOCAL_TEST_EVIDENCE!;
    assert(evidence && resolve(evidence).replaceAll(String.fromCharCode(92),'/').startsWith(resolve(process.env.TRUSTED_LOCAL_TEST_REPORTS_ROOT ?? resolve('..', 'reports')).replaceAll(String.fromCharCode(92),'/') + '/'));
    await mkdir(evidence, { recursive: false });
    const results = [];
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
        const root = await mkdtemp(join(tmpdir(), 'trusted-local-ui-'));
        const bundle = await build({ configFile: false, envFile: false, root: process.cwd(), build: { write: false, minify: false, outDir: join(root, 'build'), rollupOptions: { input: resolve('e2e/trusted-local.fixture.tsx'), output: { entryFileNames: 'fixture.js', assetFileNames: '[name][extname]' } } } });
        const output = (Array.isArray(bundle) ? bundle[0] : bundle) as any, assets = new Map<string, {
            content: any;
            type: string;
        }>();
        for (const a of output.output)
            assets.set('/' + a.fileName, { content: a.type === 'chunk' ? a.code : a.source, type: a.fileName.endsWith('.css') ? 'text/css' : 'application/javascript' });
        const css = [...assets.keys()].filter(k => k.endsWith('.css')).map(k => `<link rel="stylesheet" href="${k}">`).join('');
        const f = await localFixture({}, { ui: async (req, res) => {
                if (req.url === '/') {
                    res.setHeader('content-type', 'text/html');
                    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
                    return true;
                }
                const a = assets.get(req.url!);
                if (a) {
                    res.setHeader('content-type', a.type);
                    res.end(a.content);
                    return true;
                }
                res.writeHead(404);
                res.end();
                return true;
            } });
        let browser;
        try {
            const local = join(root, 'AppData', 'Local'), roaming = join(root, 'AppData', 'Roaming');
            await mkdir(local, { recursive: true });
            await mkdir(roaming, { recursive: true });
            const env: Record<string, string> = { HOME: root, USERPROFILE: root, APPDATA: roaming, LOCALAPPDATA: local, TEMP: root, TMP: root };
            for (const k of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'ComSpec'])
                if (process.env[k])
                    env[k] = process.env[k]!;
            browser = await chromium.launchPersistentContext(join(root, 'explicit-test-profile'), { executablePath: process.env.TRUSTED_LOCAL_TEST_BROWSER, headless: true, env, viewport });
            const context = browser;
            await context.route('**/*', r => new URL(r.request().url()).origin === f.uiBase ? r.continue({ headers: { ...r.request().headers(), ...(new URL(r.request().url()).pathname.startsWith('/api/local-mcp/') ? { 'x-pi-console-local-owner-key': dummyKeys.owner } : {}) } }) : r.abort());
            const page = await context.newPage();
            await page.goto(f.uiBase);
            await expect(page.getByText('OS 隔離成立は未検証です。', { exact: false })).toBeVisible();
            await expect(page.getByText('有効なローカル control 許可なし', { exact: true })).toBeVisible();
            await page.getByLabel('Local control target').selectOption('0');
            await page.getByLabel('Local grant minutes').fill('1');
            await page.getByRole('button', { name: 'ローカル control を確認', exact: true }).click();
            const save = page.getByRole('button', { name: '確認したローカル範囲を保存', exact: true });
            await expect(save).toBeDisabled();
            await page.getByRole('button', { name: 'ローカル確認をキャンセル', exact: true }).click();
            assert.equal((await f.app.view()).grant, null);
            await page.getByRole('button', { name: 'ローカル control を確認', exact: true }).click();
            await page.getByLabel('Confirm local MCP scope').check();
            await expect(save).toBeEnabled();
            await page.screenshot({ path: join(evidence, `review-${viewport.width}.png`), fullPage: true });
            // Route.fetch is an API client and does not preserve browser CSRF metadata.
            // Commit this exact browser POST body through the authenticated dummy owner
            // fixture, then lose only the UI acknowledgement. Normal review/result/revoke
            // still travel through the actual browser and public owner middleware.
            let saveCalls = 0, saveStatus = 0;
            await page.route('**/api/local-mcp/save', async (route) => { saveCalls++; const response = await f.owner('save', route.request().postDataJSON()); saveStatus = response.status; await route.abort('failed'); });
            await save.click();
            await expect(page.getByRole('button', { name: 'ローカル保存結果を再読取', exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: 'ローカル control を確認', exact: true })).toBeDisabled();
            assert.equal(saveCalls, 1);
            await expect.poll(() => saveStatus).toBe(200);
            assert.equal((await f.app.view()).grant?.active, true);
            await page.unroute('**/api/local-mcp/save');
            await page.getByRole('button', { name: 'ローカル保存結果を再読取', exact: true }).click();
            await expect(page.getByText('明示 control 許可が有効', { exact: true })).toBeVisible();
            const scope = await f.app.view();
            assert.equal(scope.grant?.active, true);
            assert.equal(f.counts().prompts, 0);
            await page.getByRole('button', { name: 'ローカル許可の解除を確認', exact: true }).click();
            await page.getByLabel('Confirm local MCP scope').check();
            await save.click();
            await expect(page.getByText('有効なローカル control 許可なし', { exact: true })).toBeVisible();
            await page.screenshot({ path: join(evidence, `revoked-${viewport.width}.png`), fullPage: true });
            assert.equal((await f.app.view()).grant, null);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
            await context.close();
            results.push({ viewport, reviewConfirmation: true, unknownSaveNoResend: true, resultInspection: true, revoke: true, prompts: f.counts().prompts });
        }
        finally {
            await browser?.close();
            await f.cleanup();
            await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    }
    await writeFile(join(evidence, 'proof.json'), JSON.stringify({ kind: 'dummy-local-ui', results, ownedFixturesClosed: true, tempRemoved: true, actualAccessBrowser: false, actualDotsConnected: false, osIsolationVerified: false, productionApplied: false }) + '\n');
});
