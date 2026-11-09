import { test, expect, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {HTML_PREVIEW_SHELL_CSP} from '../shared/html-preview.ts';

// Explicit-consent HTML preview shell — every API call is mocked; the page
// itself is the real built preview.html re-served under the exact parent CSP
// the integration will set, so the tests exercise the real render path.
const SHELL_CSP = HTML_PREVIEW_SHELL_CSP;
const SHELL_URL = '/api/workspace/html?workspaceId=ws1&path=docs%2Fpage.html';
const SHELL_ROUTE = '**/api/workspace/html?*';
const WS = 'ws1';
const PATH = 'docs/page.html';

const ENTRY = 'docs/page.html';
const BASE = 'docs';
const sha = (n: number) => n.toString(16).padStart(64, '0');
const file = (path: string, kind: 'html' | 'script' | 'style', n: number) => ({ path, kind, bytes: 10, sha256: sha(n) });

const SCRIPT = 'globalThis.__scriptRan = true; document.title = "script-ran";';
const STYLE = 'body { background: rgb(1, 2, 3); }';

let reviewIdSeq = 0, grantIdSeq = 0;
interface ReviewBody { workspaceId: string; path: string }
interface EnableBody { reviewId: string; allowScripts: boolean; allowStyles: boolean; confirmed: boolean; allowImages?: boolean; allowMedia?: boolean; allowFonts?: boolean }

interface MockOptions {
  html?: string;
  files?: ReturnType<typeof file>[];
  reviewStatus?: number;
  reviewError?: string;
  enableStatus?: number;
  enableError?: string;
  enableDelayMs?: number;
  revokeStatus?: number;
  grantExpiryMs?:number;
  grantFlags?:{allowScripts:boolean;allowStyles:boolean;allowImages?:boolean;allowMedia?:boolean;allowFonts?:boolean};
  contents?:Record<string,string>;
}

async function serveShell(page: Page, options: MockOptions = {}) {
  const html = options.html ?? `<!doctype html><html><head><title>doc</title></head><body><h1>document</h1></body></html>`;
  const files = options.files ?? [file(ENTRY, 'html', 1)];
  const review = { reviewId: `r${++reviewIdSeq}`, expiresAt: Date.now() + 120000, entryPath: ENTRY, basePath: BASE, documentHtml: html, files };
  const calls: { route: string; body: unknown }[] = [];
  const apiPaths: string[] = [];
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    apiPaths.push(`${request.method()} ${pathname}`);
    if (pathname === '/api/workspace/preview/review') {
      calls.push({ route: 'review', body: request.postDataJSON() });
      if (options.reviewStatus) return route.fulfill({ status: options.reviewStatus, json: { error: options.reviewError ?? 'preview_unavailable' } });
      return route.fulfill({ json: review });
    }
    if (pathname === '/api/workspace/preview/enable') {
      const body = request.postDataJSON() as EnableBody;
      calls.push({ route: 'enable', body });
      if (options.enableStatus) return route.fulfill({ status: options.enableStatus, json: { error: options.enableError ?? 'preview_review_unavailable' } });
      const grant = {
        grantId: `g${++grantIdSeq}`, expiresAt: Date.now() + (options.grantExpiryMs??300000), entryPath: ENTRY, basePath: BASE,
        documentHtml: html, allowScripts: options.grantFlags?.allowScripts??body.allowScripts, allowStyles: options.grantFlags?.allowStyles??body.allowStyles,
        allowImages: options.grantFlags?.allowImages??body.allowImages??false, allowMedia: options.grantFlags?.allowMedia??body.allowMedia??false, allowFonts: options.grantFlags?.allowFonts??body.allowFonts??false,
        resources: files.filter(f => (f.kind === 'script' && body.allowScripts) || (f.kind === 'style' && body.allowStyles))
          .map(f => ({ ...f, content: options.contents?.[f.path]??(f.kind === 'script' ? SCRIPT : STYLE) })),
      };
      if (options.enableDelayMs) await new Promise(r => setTimeout(r, options.enableDelayMs));
      return route.fulfill({ json: grant });
    }
    if (pathname === '/api/workspace/preview/revoke') {
      calls.push({ route: 'revoke', body: request.postDataJSON() });
      return route.fulfill({ status: options.revokeStatus ?? 200, json: options.revokeStatus ? { error: 'preview_grant_unavailable' } : { ok: true } });
    }
    return route.abort();
  });
  await page.route(SHELL_ROUTE, async route => {
    await route.fulfill({
      status: 200, contentType: 'text/html; charset=utf-8',
      headers: { 'content-security-policy': SHELL_CSP, 'cache-control': 'no-store' },
      body: await readFile(resolve('dist/preview.html'), 'utf8'),
    });
  });
  return { calls, apiPaths };
}

async function open(page: Page, options: MockOptions = {}) {
  const mock = await serveShell(page, options);
  await page.goto(SHELL_URL);
  return mock;
}

const confirmAndEnable = async (page: Page) => {
  await page.locator('.preview-confirm input').check();
  await page.getByRole('button', { name: '確認した内容で実行する', exact: true }).click();
};
const frame = (page: Page) => page.frameLocator('.preview-frame');

test.beforeAll(async () => {
  // The shell page is served from dist/ so it matches what the parent will
  // ship; fail early with a clear hint if the build is missing.
  await readFile(resolve('dist/preview.html'), 'utf8').catch(() => {
    throw new Error('dist/preview.html missing — run `npm run build` first');
  });
});

test('mount POSTs review once, shows the verification list and never enables', async ({ page }) => {
  const mock = await open(page);
  await expect(page.getByRole('heading', { name: 'HTML プレビュー（明示的同意）' })).toBeVisible();
  await expect(page.locator('.preview-files')).toContainText(ENTRY);
  await expect(page.locator('.preview-off')).toContainText('オフ');
  await expect(page.locator('.preview-frame')).toHaveCount(0);
  // Toggling consent checkboxes alone must not run anything.
  await page.locator('.preview-consent input').nth(0).check();
  await page.locator('.preview-consent input').nth(1).check();
  await expect(page.getByRole('button', { name: '確認した内容で実行する' })).toBeDisabled();
  await expect(page.locator('.preview-frame')).toHaveCount(0);
  expect(mock.calls.map(c => c.route)).toEqual(['review']);
  expect(mock.calls[0].body).toEqual({ workspaceId: WS, path: PATH });
  expect(mock.apiPaths.filter(p => p.startsWith('GET'))).toEqual([]);
});

test('CSS-only consent applies approved data styles and blocks scripts', async ({ page }) => {
  const html = `<!doctype html><html><head><link rel="stylesheet" href="site.css"><script>globalThis.__scriptRan=true</script><script src="app.js"></script></head><body><h1 id="t">doc</h1></body></html>`;
  const mock = await open(page, { html, files: [file(ENTRY, 'html', 1), file('docs/app.js', 'script', 2), file('docs/site.css', 'style', 3)] });
  await page.locator('.preview-consent input').nth(0).check(); // CSS only
  await confirmAndEnable(page);
  await expect(frame(page).locator('h1')).toHaveText('doc');
  expect(await frame(page).locator('body').evaluate(b => getComputedStyle(b).backgroundColor)).toBe('rgb(1, 2, 3)');
  expect(await frame(page).locator('body').evaluate(() => (globalThis as Record<string, unknown>).__scriptRan ?? false)).toBe(false);
  const enable = mock.calls.find(c => c.route === 'enable')!.body as EnableBody;
  expect(enable).toEqual({ reviewId: expect.any(String), allowScripts: false, allowStyles: true, allowImages: false, allowMedia: false, allowFonts: false, confirmed: true });
});

test('JS+CSS consent runs inline and approved local scripts; external is removed with a warning', async ({ page }) => {
  const html = `<!doctype html><html><head><link rel="stylesheet" href="site.css"><script>globalThis.__inlineRan=true</script><script src="app.js"></script><script src="https://cdn.example.com/x.js"></script></head><body><h1>doc</h1></body></html>`;
  const mock = await open(page, { html, files: [file(ENTRY, 'html', 1), file('docs/app.js', 'script', 2), file('docs/site.css', 'style', 3)] });
  await page.locator('.preview-consent input').nth(0).check();
  await page.locator('.preview-consent input').nth(1).check();
  await confirmAndEnable(page);
  await expect.poll(() => frame(page).locator('body').evaluate(() => (globalThis as Record<string, unknown>).__scriptRan === true)).toBe(true);
  expect(await frame(page).locator('body').evaluate(() => (globalThis as Record<string, unknown>).__inlineRan)).toBe(true);
  await expect(page.locator('.preview-warnings')).toContainText('外部・ワークスペース外の参照');
  expect((mock.calls.find(c => c.route === 'enable')!.body as EnableBody).confirmed).toBe(true);
});

test('iframe is opaque: no parent access, no cookies, no fetch, no external assets, no self-navigation', async ({ page }) => {
  const html = `<!doctype html><html><head>
    <link rel="stylesheet" href="https://evil.example.com/x.css"><img src="https://evil.example.com/p.png">
    <script>
      globalThis.__probe = { parent: null, cookie: null, fetch: null };
      try { globalThis.__probe.parent = window.parent.location.href; } catch (e) { globalThis.__probe.parent = 'blocked'; }
      try { globalThis.__probe.cookie = document.cookie; } catch (e) { globalThis.__probe.cookie = 'blocked'; }
      fetch('/api/state').then(() => globalThis.__probe.fetch = 'allowed').catch(() => globalThis.__probe.fetch = 'blocked');
      setTimeout(() => { try { location.href = 'https://evil.example.com/escape'; } catch {} }, 1500);
    </script></head><body><h1>doc</h1></body></html>`;
  const requests: string[] = [];
  const finished: string[] = [];
  const failed = new Set<string>();
  page.on('request', r => requests.push(r.url()));
  page.on('requestfinished', r => finished.push(r.url()));
  page.on('requestfailed', r => failed.add(r.url()));
  const mock = await open(page, { html, files: [file(ENTRY, 'html', 1)] });
  await page.locator('.preview-consent input').nth(1).check();
  await confirmAndEnable(page);
  // Wait for the opaque document itself, then read the probe the script wrote
  // (reading parent.location always throws there; cookies are always empty).
  await expect.poll(() => frame(page).locator('body').evaluate(() => {
    const p = (globalThis as Record<string, { parent: unknown; cookie: unknown }>).__probe;
    return p ? 'ready' : '';
  })).toBe('ready');
  const probe = await frame(page).locator('body').evaluate(() => (globalThis as Record<string, { parent: unknown; cookie: unknown }>).__probe);
  expect(probe.parent).toBe('blocked');
  expect(probe.cookie === '' || probe.cookie === 'blocked').toBe(true); // empty or SecurityError — never a real cookie
  await expect.poll(() => frame(page).locator('body').evaluate(() => (globalThis as Record<string, { fetch?: string }>).__probe?.fetch)).toBe('blocked');
  // Give the self-navigation attempt time to run. Chrome swaps the frame for
  // an error page, so afterwards we assert the parent stays healthy and no
  // external request ever left — the child DOM may legitimately be gone.
  await page.waitForTimeout(2000);
  await expect(page.locator('.preview-live-bar')).toBeVisible(); // parent shell intact
  // CSP-blocked loads still surface as request events (like DevTools'
  // "(blocked:csp)" rows); the security property is that none ever finished
  // on the network and every attempt failed.
  expect(finished.filter(u => u.includes('evil.example.com'))).toEqual([]);
  for (const url of requests.filter(u => u.includes('evil.example.com'))) expect(failed.has(url)).toBe(true);
  expect(mock.apiPaths.filter(p => p.startsWith('GET'))).toEqual([]);
  // The shell must still be able to kill whatever remains of the frame.
  await page.getByRole('button', { name: '取り消して停止' }).first().click();
  await expect(page.locator('.preview-frame')).toHaveCount(0);
});

test('revoke removes the iframe before the POST and stops even when revoke fails', async ({ page }) => {
  const html = `<!doctype html><html><body><h1>doc</h1><script>setInterval(()=>{globalThis.__ticks=(globalThis.__ticks||0)+1},50)</script></body></html>`;
  const mock = await open(page, { html, files: [file(ENTRY, 'html', 1)], revokeStatus: 409 });
  await page.locator('.preview-consent input').nth(1).check();
  await confirmAndEnable(page);
  await expect(page.locator('.preview-frame')).toHaveCount(1);
  await page.getByRole('button', { name: '取り消して停止' }).first().click();
  await expect(page.locator('.preview-frame')).toHaveCount(0);
  await expect(page.locator('.preview-off')).toContainText('オフ');
  await expect.poll(() => mock.calls.filter(c => c.route === 'revoke').length).toBe(1);
  expect(mock.calls.map(c => c.route)).toEqual(['review', 'enable', 'revoke']);
});

test('grant expiry stops the frame', async ({ page }) => {
  // WebKit cannot inject Playwright's fake clock into an opaque srcdoc frame.
  // A short server-granted lifetime exercises the real expiry timer instead.
  const html = `<!doctype html><html><body><h1>doc</h1></body></html>`;
  await open(page, { html,grantExpiryMs:1200 });
  await confirmAndEnable(page);
  await expect(page.locator('.preview-frame')).toHaveCount(1);
  await expect(page.locator('.preview-frame')).toHaveCount(0);
  await expect(page.locator('.preview-off')).toContainText('オフ');
});

test('changing the file rejects enable: no frame runs and re-review is required', async ({ page }) => {
  const mock = await open(page, { enableStatus: 409, enableError: 'preview_changed' });
  await confirmAndEnable(page);
  await expect(page.getByRole('alert')).toContainText('変更または削除');
  await expect(page.locator('.preview-frame')).toHaveCount(0);
  await expect(page.locator('.preview-off')).toBeVisible();
  expect(mock.calls.map(c => c.route)).toEqual(['review', 'enable']);
});

test('a slow enable can be cancelled; a late grant is revoked and never renders', async ({ page }) => {
  const mock = await open(page, { enableDelayMs: 800 });
  await page.locator('.preview-confirm input').check();
  await page.getByRole('button', { name: '確認した内容で実行する' }).click();
  await page.locator('.preview-confirm input').click(); // withdrawal removes this control; do not wait for an unchecked node
  await page.waitForTimeout(1200);
  await expect(page.locator('.preview-frame')).toHaveCount(0);
  expect(mock.calls.filter(c => c.route === 'enable')).toHaveLength(1);
});

test('a grant arriving after consent was withdrawn is revoked, never displayed', async ({ page }) => {
  // Same race as above but the enable response still lands: the in-flight
  // guard must revoke it instead of rendering.
  const mock = await open(page, { enableDelayMs: 400 });
  await page.locator('.preview-confirm input').check();
  await page.getByRole('button', { name: '確認した内容で実行する' }).click();
  await page.locator('.preview-confirm input').click();
  await expect.poll(() => mock.calls.filter(c => c.route === 'revoke').length, { timeout: 5000 }).toBe(1);
  await expect(page.locator('.preview-frame')).toHaveCount(0);
});

test('modules, import maps and CDN references are listed as unsupported and removed', async ({ page }) => {
  const html = `<!doctype html><html><head>
    <script type="importmap">{"imports":{"a":"./a.js"}}</script>
    <script type="module">globalThis.__moduleRan=true</script>
    <script src="https://cdn.example.com/lib.js"></script>
    </head><body><h1>doc</h1></body></html>`;
  await open(page, { html, files: [file(ENTRY, 'html', 1)] });
  await page.locator('.preview-consent input').nth(1).check();
  await confirmAndEnable(page);
  await expect(page.locator('.preview-frame')).toHaveCount(1);
  await expect(page.locator('.preview-warnings')).toContainText('ES module は未対応');
  await expect(page.locator('.preview-warnings')).toContainText('import map は未対応');
  await expect(page.locator('.preview-warnings')).toContainText('cdn.example.com');
  expect(await frame(page).locator('body').evaluate(() => (globalThis as Record<string, unknown>).__moduleRan ?? false)).toBe(false);
});

test('CSS @import of an approved file is inlined; an external import is dropped', async ({ page }) => {
  const html = `<!doctype html><html><head><link rel="stylesheet" href="site.css"></head><body><h1>doc</h1></body></html>`;
  const css = `@import "more.css"; body { background: rgb(4, 5, 6); } @import "https://evil.example.com/x.css";`;
  let enabled = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/review')) return route.fulfill({ json: { reviewId: 'r9', expiresAt: Date.now() + 120000, entryPath: ENTRY, basePath: BASE, documentHtml: html, files: [file(ENTRY, 'html', 1), file('docs/site.css', 'style', 2), file('docs/more.css', 'style', 3)] } });
    if (path.endsWith('/enable')) {
      enabled = true;
      return route.fulfill({ json: { grantId: 'g9', expiresAt: Date.now() + 300000, entryPath: ENTRY, basePath: BASE, documentHtml: html, allowScripts: false, allowStyles: true, resources: [
        { ...file('docs/site.css', 'style', 2), content: css }, { ...file('docs/more.css', 'style', 3), content: 'h1 { color: rgb(9, 9, 9); }' },
      ] } });
    }
    return route.fulfill({ json: { ok: true } });
  });
  await page.route(SHELL_ROUTE, async route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': SHELL_CSP }, body: await readFile(resolve('dist/preview.html'), 'utf8') }));
  await page.goto(SHELL_URL);
  await page.locator('.preview-consent input').nth(0).check();
  await confirmAndEnable(page);
  expect(enabled).toBe(true);
  await expect.poll(() => frame(page).locator('h1').evaluate(h => getComputedStyle(h).color)).toBe('rgb(9, 9, 9)');
  await expect(page.locator('.preview-warnings')).toContainText('evil.example.com');
});

test('an expired grant is never briefly mounted or executed',async({page})=>{
 const mock=await open(page,{grantExpiryMs:-1,html:'<h1>Expired</h1><script>globalThis.expiredRan=true</script>'});
 await page.locator('.preview-consent input').nth(1).check();await confirmAndEnable(page);
 await expect(page.getByRole('alert')).toContainText('失効');await expect(page.locator('.preview-frame')).toHaveCount(0);
 await expect.poll(()=>mock.calls.filter(c=>c.route==='revoke').length).toBe(1);
});

test('a response cannot escalate the selected permission flags',async({page})=>{
 const mock=await open(page,{grantFlags:{allowScripts:true,allowStyles:false},html:'<script>globalThis.unapproved=true</script><p>doc</p>'});
 await confirmAndEnable(page);await expect(page.getByRole('alert')).toBeVisible();await expect(page.locator('.preview-frame')).toHaveCount(0);
 await expect.poll(()=>mock.calls.filter(c=>c.route==='revoke').length).toBe(1);
});

test('encoded paths, query strings, UTF-8 and conditional CSS imports retain their meaning',async({page})=>{
 const html='<link rel="stylesheet" href="styles/site%20%C3%A9.css?v=1" integrity="sha256-invalid" crossorigin="anonymous"><h1>doc</h1><script src="app%20%C3%A9.js?cache=1" integrity="sha256-invalid"></script>';
 await open(page,{html,files:[file(ENTRY,'html',1),file('docs/styles/site é.css','style',2),file('docs/theme.css','style',3),file('docs/print.css','style',4),file('docs/app é.js','script',5)],contents:{
  'docs/styles/site é.css':'@IMPORT url(../theme.css?cache=1) screen; @import "../print.css" not all;',
  'docs/theme.css':'h1{color:rgb(9,8,7)}','docs/print.css':'h1{color:rgb(255,0,255)}',
  'docs/app é.js':'document.querySelector("h1").dataset.utf8="日本語";',
 }});
 await page.locator('.preview-consent input').nth(0).check();await page.locator('.preview-consent input').nth(1).check();await confirmAndEnable(page);
 await expect(frame(page).locator('h1')).toHaveAttribute('data-utf8','日本語');
 await expect.poll(()=>frame(page).locator('h1').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(9, 8, 7)');
});

test('too many resource references fail before any partial document executes',async({page})=>{
 const mock=await open(page,{html:'<h1>limit</h1>'+('<script src="app.js"></script>').repeat(129),files:[file(ENTRY,'html',1),file('docs/app.js','script',2)]});
 await page.locator('.preview-consent input').nth(1).check();await confirmAndEnable(page);
 await expect(page.getByRole('alert')).toContainText('上限');await expect(page.locator('.preview-frame')).toHaveCount(0);
 await expect.poll(()=>mock.calls.filter(c=>c.route==='revoke').length).toBe(1);
});

test('an Access login page returned with status 200 is not mistaken for preview data',async({page})=>{
 await serveShell(page);await page.route('**/api/workspace/preview/review',route=>route.fulfill({status:200,contentType:'text/html',body:'<h1>Access sign in</h1>'}));
 await page.goto(SHELL_URL);await expect(page.getByRole('alert')).toContainText('認証が必要');await expect(page.locator('.preview-frame')).toHaveCount(0);
});

for(const scripts of [false,true])test(`imported CSS cannot break out of an inline style element: scripts=${scripts}`,async({page})=>{
 const html='<style>@import "payload.css";</style><h1>safe</h1><script>globalThis.__legitimate=true</script>';
 const css='h1{color:rgb(12,34,56)}\n</style><p id="css-injected">injected</p><script>globalThis.__cssInjected=true</script><style>';
 await open(page,{html,files:[file(ENTRY,'html',1),file('docs/payload.css','style',2)],contents:{'docs/payload.css':css}});
 await page.locator('.preview-consent input').nth(0).check();if(scripts)await page.locator('.preview-consent input').nth(1).check();await confirmAndEnable(page);
 await expect(frame(page).locator('h1')).toHaveText('safe');await expect(frame(page).locator('#css-injected')).toHaveCount(0);
 await expect.poll(()=>frame(page).locator('h1').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(12, 34, 56)');
 expect(await frame(page).locator('body').evaluate(()=>(globalThis as any).__cssInjected??false)).toBe(false);
 expect(await frame(page).locator('body').evaluate(()=>(globalThis as any).__legitimate??false)).toBe(scripts);
});

test('authored page navigation is inert while same-document fragments remain available',async({page})=>{
 const html='<a id="outside" href="https://evil.example.com/">outside</a><map><area id="area" href="/api/workspaces"></map><svg xmlns:xlink="http://www.w3.org/1999/xlink"><a id="svg-link" xlink:href="https://evil.example.com/"><text>svg</text></a></svg><a id="fragment" href="#target" target="_blank" ping="https://evil.example.com/">jump</a><h2 id="target">target</h2>';
 const mock=await open(page,{html});await confirmAndEnable(page);
 for(const id of ['outside','area','svg-link']){
  expect(await frame(page).locator(`#${id}`).getAttribute('href')).toBeNull();
  expect(await frame(page).locator(`#${id}`).evaluate(el=>el.getAttributeNS('http://www.w3.org/1999/xlink','href'))).toBeNull();
 }
 await expect(frame(page).locator('#fragment')).toHaveAttribute('href','about:srcdoc#target');expect(await frame(page).locator('#fragment').getAttribute('target')).toBeNull();
 await frame(page).locator('#fragment').click();await expect(frame(page).locator('#target')).toHaveText('target');
 expect(mock.apiPaths.filter(path=>path.startsWith('GET'))).toEqual([]);
});

test('authentication and review failures show an explanation without a frame', async ({ page }) => {
  const mock = await open(page, { reviewStatus: 403, reviewError: 'preview_identity_required' });
  await expect(page.getByRole('alert')).toContainText('認証が必要です');
  await expect(page.locator('.preview-frame')).toHaveCount(0);
  expect(mock.calls.map(c => c.route)).toEqual(['review']);
});
