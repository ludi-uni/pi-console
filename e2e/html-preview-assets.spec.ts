import { test, expect, type Page, type Route } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { HTML_PREVIEW_SHELL_CSP } from '../shared/html-preview.ts';

// Binary preview assets (images / audio / video / fonts) inside the
// explicit-consent HTML preview. Same pattern as html-preview.spec.ts: the
// page is the real built preview.html served under the production shell CSP,
// and every API call is mocked. Fixtures are real decodable binaries (the
// repo's preview.png/preview.mp4, a generated silent WAV and the dev-dependency
// codicon font) so the opaque frame's actual decode path is exercised.
const SHELL_CSP = HTML_PREVIEW_SHELL_CSP;
const SHELL_URL = '/api/workspace/html?workspaceId=ws1&path=docs%2Fpage.html';
const SHELL_ROUTE = '**/api/workspace/html?*';
const ENTRY = 'docs/page.html';
const BASE = 'docs';
const FIXTURES = resolve('tests/fixtures');
const IS_WINDOWS = process.platform === 'win32';

const PAGE = '<!doctype html><html><body><h1>doc</h1></body></html>';
const b64 = (buf: Buffer) => buf.toString('base64');
const sha = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

/** 44-byte RIFF/WAVE header + zeroed 16-bit samples: 16 kHz mono PCM silence. */
function silentWav(durationMs = 100): Buffer {
  const samples = Math.floor(16000 * durationMs / 1000);
  const data = Buffer.alloc(samples * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(16000, 24); head.writeUInt32LE(32000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/** Discover the codicon TTF bundled with playwright-core (dev fixture only —
 * nothing is copied into the repo). */
async function codiconFont(): Promise<Buffer> {
  const dir = resolve('node_modules/playwright-core/lib/vite/traceViewer');
  const name = (await readdir(dir)).find(entry => /^codicon.*\.ttf$/i.test(entry));
  if (!name) throw new Error('codicon font not found under playwright-core traceViewer');
  return readFile(resolve(dir, name));
}

interface AssetSpec { path: string; kind: 'image' | 'audio' | 'video' | 'font'; mime: string; data: Buffer }
const assetFile = (a: AssetSpec) => ({ path: a.path, kind: a.kind, bytes: a.data.length, sha256: sha(a.data), mime: a.mime, encoding: 'base64' as const });
const htmlFile = (html: string) => ({ path: ENTRY, kind: 'html' as const, bytes: Buffer.byteLength(html), sha256: sha(html) });

interface EnableBody {
  reviewId: string; confirmed: boolean;
  allowScripts: boolean; allowStyles: boolean;
  allowImages?: boolean; allowMedia?: boolean; allowFonts?: boolean;
}
interface MockOptions {
  html?: string;
  assets?: AssetSpec[];
  /** Drop asset resources (or specific paths) from the enable response. */
  dropResources?: true | string[];
  /** Mutate one returned asset resource (spoofing attempts). */
  corruptResource?: (resource: Record<string, unknown>) => void;
  /** Omit the new grant flag keys entirely (legacy backend shape). */
  omitGrantFlags?: boolean;
  /** Grant flag overrides for escalation checks. */
  grantFlags?: Partial<Pick<Required<EnableBody>, 'allowImages' | 'allowMedia' | 'allowFonts'>>;
  grantExpiryMs?: number;
  enableDelayMs?: number;
}

async function serveShell(page: Page, options: MockOptions = {}) {
  const html = options.html ?? PAGE;
  const assets = options.assets ?? [];
  const files = [htmlFile(html), ...assets.map(assetFile)];
  const review = { reviewId: `r${Math.random().toString(16).slice(2)}`, expiresAt: Date.now() + 120000, entryPath: ENTRY, basePath: BASE, documentHtml: html, files };
  const calls: { route: string; body: unknown }[] = [];
  const apiPaths: string[] = [];
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    apiPaths.push(`${request.method()} ${pathname}`);
    if (pathname === '/api/workspace/preview/review') {
      calls.push({ route: 'review', body: request.postDataJSON() });
      return route.fulfill({ json: review });
    }
    if (pathname === '/api/workspace/preview/enable') {
      const body = request.postDataJSON() as EnableBody;
      calls.push({ route: 'enable', body });
      const resources = assets
        .filter(a => !options.dropResources || (options.dropResources !== true && !options.dropResources.includes(a.path)))
        .filter(a => (a.kind === 'image' && body.allowImages) || (a.kind === 'font' && body.allowFonts) || ((a.kind === 'audio' || a.kind === 'video') && body.allowMedia))
        .map(a => {
          const resource: Record<string, unknown> = { ...assetFile(a), content: b64(a.data) };
          if (options.corruptResource) options.corruptResource(resource);
          return resource;
        });
      const grant: Record<string, unknown> = {
        grantId: 'g-assets', expiresAt: Date.now() + (options.grantExpiryMs ?? 300000), entryPath: ENTRY, basePath: BASE,
        documentHtml: html, allowScripts: body.allowScripts, allowStyles: body.allowStyles,
        resources,
      };
      if (!options.omitGrantFlags) {
        grant.allowImages = options.grantFlags?.allowImages ?? body.allowImages ?? false;
        grant.allowMedia = options.grantFlags?.allowMedia ?? body.allowMedia ?? false;
        grant.allowFonts = options.grantFlags?.allowFonts ?? body.allowFonts ?? false;
      }
      if (options.enableDelayMs) await new Promise(r => setTimeout(r, options.enableDelayMs));
      return route.fulfill({ json: grant });
    }
    if (pathname === '/api/workspace/preview/revoke') {
      calls.push({ route: 'revoke', body: request.postDataJSON() });
      return route.fulfill({ json: { ok: true } });
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

// Checkbox order: 0=CSS 1=JS 2=画像 3=音声・動画 4=フォント (existing order preserved).
const check = (page: Page, index: number) => page.locator('.preview-consent input').nth(index).check();
const confirmAndEnable = async (page: Page) => {
  await page.locator('.preview-confirm input').check();
  await page.getByRole('button', { name: '確認した内容で実行する', exact: true }).click();
};
const frame = (page: Page) => page.frameLocator('.preview-frame');
const decodedImage = (page: Page, selector: string) =>
  frame(page).locator(selector).evaluate(el => ({ w: (el as HTMLImageElement).naturalWidth, ok: (el as HTMLImageElement).complete }));

test.beforeAll(async () => {
  await readFile(resolve('dist/preview.html'), 'utf8').catch(() => {
    throw new Error('dist/preview.html missing — run `npm run build` first');
  });
});

test('asset kinds appear in the review list and the enable body sends all five flags, all false by default', async ({ page }) => {
  const png = await readFile(resolve(FIXTURES, 'preview.png'));
  const wav = silentWav();
  const ttf = await codiconFont();
  const mock = await open(page, {
    assets: [
      { path: 'docs/a.png', kind: 'image', mime: 'image/png', data: png },
      { path: 'docs/b.wav', kind: 'audio', mime: 'audio/wav', data: wav },
      { path: 'docs/c.mp4', kind: 'video', mime: 'video/mp4', data: await readFile(resolve(FIXTURES, 'preview.mp4')) },
      { path: 'docs/d.ttf', kind: 'font', mime: 'font/ttf', data: ttf },
    ],
  });
  const list = page.locator('.preview-files');
  await expect(list).toContainText('docs/a.png'); await expect(list).toContainText('画像');
  await expect(list).toContainText('docs/b.wav'); await expect(list).toContainText('音声');
  await expect(list).toContainText('docs/c.mp4'); await expect(list).toContainText('動画');
  await expect(list).toContainText('docs/d.ttf'); await expect(list).toContainText('フォント');
  // All five consent boxes exist and start unchecked.
  const boxes = page.locator('.preview-consent input');
  await expect(boxes).toHaveCount(5);
  for (let i = 0; i < 5; i++) await expect(boxes.nth(i)).not.toBeChecked();
  await confirmAndEnable(page);
  await expect.poll(() => mock.calls.some(c => c.route === 'enable')).toBe(true);
  const enable = mock.calls.find(c => c.route === 'enable')!.body as EnableBody;
  expect(enable).toEqual({ reviewId: expect.any(String), allowScripts: false, allowStyles: false, allowImages: false, allowMedia: false, allowFonts: false, confirmed: true });
});

test('per-kind consent is disjoint: unconsented kinds are stripped and their CSP stays none', async ({ page }) => {
  const png = await readFile(resolve(FIXTURES, 'preview.png'));
  const wav = silentWav();
  const html = `<!doctype html><body>
    <img id="a" src="a.png"><img id="ext" src="https://evil.example.com/x.png">
    <audio id="snd" src="b.wav" controls></audio>
    <video id="vid" src="b.wav" poster="a.png"></video>
    </body>`;
  const mock = await open(page, {
    html,
    assets: [
      { path: 'docs/a.png', kind: 'image', mime: 'image/png', data: png },
      { path: 'docs/b.wav', kind: 'audio', mime: 'audio/wav', data: wav },
    ],
  });
  await check(page, 2); // images only
  await confirmAndEnable(page);
  await expect.poll(() => mock.calls.some(c => c.route === 'enable')).toBe(true);
  const enable = mock.calls.find(c => c.route === 'enable')!.body as EnableBody;
  expect([enable.allowImages, enable.allowMedia, enable.allowFonts]).toEqual([true, false, false]);
  // The image flag admits only image kinds: the WAV is never delivered and
  // both media elements lose their references even though the server could
  // not have sent it.
  await expect.poll(() => decodedImage(page, '#a')).toEqual({ w: 96, ok: true });
  await expect(frame(page).locator('#ext')).not.toHaveAttribute('src', /.+/);
  await expect(frame(page).locator('#snd')).not.toHaveAttribute('src', /.+/);
  await expect(frame(page).locator('#vid')).not.toHaveAttribute('src', /.+/);
  // The poster attribute accepts only images — it embeds under the image flag.
  await expect(frame(page).locator('#vid')).toHaveAttribute('poster', /^data:image\/png;base64,/);
  await expect(frame(page).locator('#vid')).toHaveAttribute('preload', 'none');
  const csp = await frame(page).locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain('img-src data:');
  expect(csp).toContain("media-src 'none'");
  expect(csp).toContain("font-src 'none'");
  await expect(page.locator('.preview-warnings')).toContainText('evil.example.com');
  expect(mock.apiPaths.filter(p => p.startsWith('GET'))).toEqual([]);
});

test('responsive images embed through srcset, picture sources and input[type=image]', async ({ page }) => {
  const png = await readFile(resolve(FIXTURES, 'preview.png'));
  const html = `<!doctype html><body>
    <img id="main" src="a.png" srcset="a.png 1x, b.png 2x, https://evil.example.com/x.png 3x">
    <picture><source id="pick" srcset="b.png"><img id="fallback" src="a.png"></picture>
    <input id="btn" type="image" src="a.png" alt="go">
    <svg xmlns="http://www.w3.org/2000/svg"><image id="svgimg" href="a.png" width="10" height="10"/><image id="svghide" href="https://evil.example.com/y.png" width="10" height="10"/></svg>
    </body>`;
  await open(page, {
    html,
    assets: [
      { path: 'docs/a.png', kind: 'image', mime: 'image/png', data: png },
      { path: 'docs/b.png', kind: 'image', mime: 'image/png', data: png },
    ],
  });
  await check(page, 2);
  await confirmAndEnable(page);
  const main = frame(page).locator('#main');
  const srcset = await main.getAttribute('srcset');
  expect(srcset).toContain('data:image/png;base64,');
  expect(srcset).toContain(' 2x');
  expect(srcset).not.toContain('evil.example.com');
  await expect.poll(() => decodedImage(page, '#fallback')).toEqual({ w: 96, ok: true });
  await expect(frame(page).locator('#pick')).toHaveAttribute('srcset', /^data:image\/png;base64,/);
  await expect(frame(page).locator('#btn')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(frame(page).locator('#svgimg')).toHaveAttribute('href', /^data:image\/png;base64,/);
  await expect(frame(page).locator('#svghide')).not.toHaveAttribute('href', /.+/);
});

test('CSS backgrounds embed only with both style and image consent; external urls are dropped', async ({ page }) => {
  const png = await readFile(resolve(FIXTURES, 'preview.png'));
  const html = `<!doctype html><html><head><link rel="stylesheet" href="site.css"></head><body><div id="wall" style="height:8px">x</div><div id="inline" style="width:8px;height:8px;background-image:url('a.png')">x</div></body></html>`;
  const css = '#wall{background-image:url(a.png);background-size:cover}';
  const assets = [{ path: 'docs/a.png', kind: 'image', mime: 'image/png', data: png } as AssetSpec];
  const serveWithStyles = async (withCss: boolean) => {
    const resources = withCss ? [{ path: 'docs/site.css', kind: 'style', bytes: css.length, sha256: sha(css) }] : [];
    await page.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith('/review')) return route.fulfill({ json: { reviewId: 'r-css', expiresAt: Date.now() + 120000, entryPath: ENTRY, basePath: BASE, documentHtml: html, files: [htmlFile(html), ...resources, ...assets.map(assetFile)] } });
      if (pathname.endsWith('/enable')) {
        const body = route.request().postDataJSON() as EnableBody;
        return route.fulfill({ json: {
          grantId: 'g-css', expiresAt: Date.now() + 300000, entryPath: ENTRY, basePath: BASE, documentHtml: html,
          allowScripts: false, allowStyles: body.allowStyles, allowImages: body.allowImages ?? false, allowMedia: false, allowFonts: false,
          resources: [
            ...(body.allowStyles ? resources.map(r => ({ ...r, content: css })) : []),
            ...(body.allowImages ? assets.map(a => ({ ...assetFile(a), content: b64(a.data) })) : []),
          ],
        } });
      }
      return route.fulfill({ json: { ok: true } });
    });
    await page.route(SHELL_ROUTE, async route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': SHELL_CSP }, body: await readFile(resolve('dist/preview.html'), 'utf8') }));
    await page.goto(SHELL_URL);
  };

  // Image consent without style consent: no CSS at all reaches the frame.
  await serveWithStyles(true);
  await check(page, 2);
  await confirmAndEnable(page);
  expect(await frame(page).locator('#inline').evaluate(el => getComputedStyle(el).backgroundImage)).toBe('none');
  await page.getByRole('button', { name: '取り消して停止' }).first().click();
  await page.getByRole('button', { name: 'ファイル一覧を確認し直す' }).click();
  // Style consent alone does not admit image bytes — the url() is blanked and
  // the image is never embedded (disjoint kinds).
  await check(page, 0);
  await confirmAndEnable(page);
  await expect.poll(() => frame(page).locator('#wall').evaluate(el => getComputedStyle(el).backgroundImage)).toBe('none');
  await page.getByRole('button', { name: '取り消して停止' }).first().click();
  await page.getByRole('button', { name: 'ファイル一覧を確認し直す' }).click();
  // Both flags: the workspace png is embedded as a data URL inside the CSS.
  await check(page, 0); await check(page, 2);
  await confirmAndEnable(page);
  await expect.poll(() => frame(page).locator('#wall').evaluate(el => getComputedStyle(el).backgroundImage)).toContain('data:image/png');
  await expect.poll(() => frame(page).locator('#inline').evaluate(el => getComputedStyle(el).backgroundImage)).toContain('data:image/png');
});

test('audio and video embed under media consent: manual preload, controls, no autoplay, real metadata', async ({ page, browserName }) => {
  const wav = silentWav();
  const mp4 = await readFile(resolve(FIXTURES, 'preview.mp4'));
  const png = await readFile(resolve(FIXTURES, 'preview.png'));
  const html = `<!doctype html><body>
    <audio id="snd" src="b.wav" autoplay controls></audio>
    <video id="vid" poster="a.png" autoplay muted controls><source src="c.mp4" type="video/mp4"><source src="https://evil.example.com/v.webm"></video>
    </body>`;
  await open(page, {
    html,
    assets: [
      { path: 'docs/a.png', kind: 'image', mime: 'image/png', data: png },
      { path: 'docs/b.wav', kind: 'audio', mime: 'audio/wav', data: wav },
      { path: 'docs/c.mp4', kind: 'video', mime: 'video/mp4', data: mp4 },
    ],
  });
  await check(page, 2); await check(page, 3);
  await confirmAndEnable(page);
  await expect(frame(page).locator('#snd')).toHaveAttribute('src', /^data:audio\/wav;base64,/);
  await expect(frame(page).locator('#snd')).toHaveAttribute('controls', /.*/);
  await expect(frame(page).locator('#snd')).toHaveAttribute('preload', 'none');
  await expect(frame(page).locator('#snd')).not.toHaveAttribute('autoplay', /.*/);
  await expect(frame(page).locator('#vid')).toHaveAttribute('poster', /^data:image\/png;base64,/);
  const sources = frame(page).locator('#vid source');
  await expect(sources.first()).toHaveAttribute('src', /^data:video\/mp4;base64,/);
  await expect(sources.nth(1)).not.toHaveAttribute('src', /.+/);
  // Synchronous load() then poll from the parent — never call play() so the
  // fixture stays silent. The opaque frame has no script access anyway.
  await frame(page).locator('#snd').evaluate(el => (el as HTMLMediaElement).load());
  await frame(page).locator('#vid').evaluate(el => (el as HTMLMediaElement).load());
  const mediaState = (selector: string) => frame(page).locator(selector).evaluate(el => {
    const media = el as HTMLMediaElement;
    return { readyState: media.readyState, networkState: media.networkState, error: media.error ? media.error.code : null, paused: media.paused };
  });
  for (const selector of ['#snd', '#vid']) {
    const mayLackDecoder = IS_WINDOWS && browserName === 'webkit';
    await expect.poll(async () => {
      const state = await mediaState(selector);
      return state.paused && ((state.readyState >= 1 && state.error === null) || (mayLackDecoder && (state.error === 4 || state.networkState === 3)));
    }).toBe(true);
    if ((await mediaState(selector)).readyState === 0) {
      // Prove the decoder limitation outside the sandbox too; URI/CSP or
      // sandbox failures alone must not be accepted as successful loading.
      const uri = await frame(page).locator(selector).evaluate(el => el.getAttribute('src') ?? el.querySelector('source')!.getAttribute('src')!);
      const tag = selector === '#snd' ? 'audio' : 'video';
      await page.evaluate(({ uri, tag }) => {
        const control = document.createElement(tag);
        control.id = 'decoder-control'; control.preload = 'metadata';
        control.src = uri; document.body.append(control); control.load();
      }, { uri, tag });
      await expect.poll(() => page.locator('#decoder-control').evaluate(el => (el as HTMLMediaElement).error?.code)).toBe(4);
      await page.locator('#decoder-control').evaluate(el => el.remove());
      test.info().annotations.push({ type: 'runtime-limitation', description: `Windows WebKit ${tag}: decoder error 4 also outside sandbox; no playback claimed` });
    }
  }
});

test('a consented font loads inside @font-face; without the font flag nothing reaches font-src', async ({ page }) => {
  const ttf = await codiconFont();
  const css = `@font-face{font-family:"PreviewTest";src:url("codicon.ttf") format("truetype")} #t{font-family:"PreviewTest",monospace}`;
  const html = `<!doctype html><html><head><link rel="stylesheet" href="site.css"></head><body><p id="t">&#xea60;</p></body></html>`;
  const assets = [{ path: 'docs/codicon.ttf', kind: 'font', mime: 'font/ttf', data: ttf } as AssetSpec];
  const styleRes = { path: 'docs/site.css', kind: 'style', bytes: css.length, sha256: sha(css) };
  const serve = async () => {
    await page.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith('/review')) return route.fulfill({ json: { reviewId: 'r-font', expiresAt: Date.now() + 120000, entryPath: ENTRY, basePath: BASE, documentHtml: html, files: [htmlFile(html), styleRes, ...assets.map(assetFile)] } });
      if (pathname.endsWith('/enable')) {
        const body = route.request().postDataJSON() as EnableBody;
        return route.fulfill({ json: {
          grantId: 'g-font', expiresAt: Date.now() + 300000, entryPath: ENTRY, basePath: BASE, documentHtml: html,
          allowScripts: false, allowStyles: body.allowStyles, allowImages: false, allowMedia: false, allowFonts: body.allowFonts ?? false,
          resources: [
            ...(body.allowStyles ? [{ ...styleRes, content: css }] : []),
            ...(body.allowFonts ? assets.map(a => ({ ...assetFile(a), content: b64(a.data) })) : []),
          ],
        } });
      }
      return route.fulfill({ json: { ok: true } });
    });
    await page.route(SHELL_ROUTE, async route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': SHELL_CSP }, body: await readFile(resolve('dist/preview.html'), 'utf8') }));
    await page.goto(SHELL_URL);
  };

  await serve();
  await check(page, 0); await check(page, 4);
  await confirmAndEnable(page);
  // evaluate inside the opaque frame cannot await fonts.load (sandboxed
  // document, scripts off): read the synchronous FontFaceSet snapshot and let
  // the parent poll it.
  await page.locator('.preview-frame').scrollIntoViewIfNeeded();
  const fontState = () => frame(page).locator('body').evaluate(el => {
    el.getBoundingClientRect();
    // Default iteration flushes Firefox's CSS-connected font faces; values()
    // alone can return an empty, stale snapshot until that flush occurs.
    return Array.from(document.fonts).map(face => `${face.family.replace(/"/g, '')}:${face.status}`).join(',');
  });
  await expect.poll(fontState).toContain('PreviewTest:loaded');
  // A font referenced without consent is dropped: the url is blanked and the
  // child CSP keeps font-src 'none'.
  await page.getByRole('button', { name: '取り消して停止' }).first().click();
  await page.getByRole('button', { name: 'ファイル一覧を確認し直す' }).click();
  await check(page, 0); // styles on, fonts off
  await confirmAndEnable(page);
  const csp = await frame(page).locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("font-src 'none'");
  await expect.poll(fontState).not.toContain(':loaded');
});

test('a response cannot escalate asset flags and spoofed resources are rejected', async ({ page }) => {
  const png = await readFile(resolve(FIXTURES, 'preview.png'));
  const wav = silentWav();
  const assets = [
    { path: 'docs/a.png', kind: 'image', mime: 'image/png', data: png },
    { path: 'docs/b.wav', kind: 'audio', mime: 'audio/wav', data: wav },
  ] as AssetSpec[];
  const html = `<!doctype html><body><img src="a.png"><audio src="b.wav"></audio></body>`;

  // Grant echoes a flag the user never set → revoked, never rendered.
  let mock = await open(page, { html, assets, grantFlags: { allowMedia: true } });
  await check(page, 2);
  await confirmAndEnable(page);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.preview-frame')).toHaveCount(0);
  await expect.poll(() => mock.calls.filter(c => c.route === 'revoke').length).toBe(1);

  // Legacy backend without the new flag keys is treated as all-false: the
  // frame still renders, but no asset flag was sent so nothing is embedded.
  mock = await open(page, { html, assets, omitGrantFlags: true });
  await confirmAndEnable(page);
  await expect(page.locator('.preview-frame')).toHaveCount(1);
  await expect(frame(page).locator('img')).not.toHaveAttribute('src', /.+/);
  await expect(frame(page).locator('audio')).not.toHaveAttribute('src', /.+/);
});

test('a resource whose declared bytes or mime disagree with its content is never embedded', async ({ page }) => {
  const png = await readFile(resolve(FIXTURES, 'preview.png'));
  const wav = silentWav();
  const assets = [
    { path: 'docs/a.png', kind: 'image', mime: 'image/png', data: png },
    { path: 'docs/b.wav', kind: 'audio', mime: 'audio/wav', data: wav },
  ] as AssetSpec[];
  const html = `<!doctype html><body><img id="a" src="a.png"><audio id="snd" src="b.wav" controls></audio><img id="js" src="app.js"></body>`;

  // bytes spoofed smaller than the actual base64 payload.
  let mock = await open(page, {
    html, assets,
    corruptResource: resource => { if (resource.path === 'docs/a.png') resource.bytes = 8; },
  });
  await check(page, 2); await check(page, 3);
  await confirmAndEnable(page);
  await expect(frame(page).locator('#a')).not.toHaveAttribute('src', /.+/);
  await expect.poll(() => mediaReady(page, '#snd')).toBe(true);
  await page.getByRole('button', { name: '取り消して停止' }).first().click();
  await page.getByRole('button', { name: 'ファイル一覧を確認し直す' }).click();

  // A WAV resource relabelled as an image must not satisfy <img> either —
  // kind/mime/extension all have to agree with the allowlist entry.
  mock = await open(page, {
    html, assets,
    corruptResource: resource => {
      if (resource.path === 'docs/b.wav') { resource.kind = 'image'; resource.mime = 'image/wav'; }
    },
  });
  await check(page, 2); await check(page, 3);
  await confirmAndEnable(page);
  await expect(frame(page).locator('#snd')).not.toHaveAttribute('src', /.+/);
  const csp = await frame(page).locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain('img-src data:');
  expect(csp).toContain('media-src data:');
  // A path in the manifest that is not an image still cannot be embedded into
  // <img> — the entry only exists if kind/extension/mime match, so the img is
  // blanked with an unapproved-style warning.
  await expect(frame(page).locator('#js')).not.toHaveAttribute('src', /.+/);
});

const mediaReady = (page: Page, selector: string) => frame(page).locator(selector).evaluate(el => (el as HTMLMediaElement).readyState >= 0 && (el as HTMLMediaElement).src.startsWith('data:'));

test('a late or revoked grant carrying assets stops media and never renders', async ({ page }) => {
  const png = await readFile(resolve(FIXTURES, 'preview.png'));
  const wav = silentWav();
  const html = `<!doctype html><body><img src="a.png"><audio src="b.wav" controls></audio></body>`;
  const assets = [
    { path: 'docs/a.png', kind: 'image', mime: 'image/png', data: png },
    { path: 'docs/b.wav', kind: 'audio', mime: 'audio/wav', data: wav },
  ] as AssetSpec[];

  // Consent withdrawn mid-flight → the arriving grant is revoked, not shown.
  let mock = await open(page, { html, assets, enableDelayMs: 400 });
  await check(page, 2); await check(page, 3);
  await page.locator('.preview-confirm input').check();
  await page.getByRole('button', { name: '確認した内容で実行する' }).click();
  await page.locator('.preview-confirm input').click();
  await expect.poll(() => mock.calls.filter(c => c.route === 'revoke').length, { timeout: 5000 }).toBe(1);
  await expect(page.locator('.preview-frame')).toHaveCount(0);

  // Grant expiry while media is embedded → frame removed, playback stopped.
  mock = await open(page, { html, assets, grantExpiryMs: 1500 });
  await check(page, 2); await check(page, 3);
  await confirmAndEnable(page);
  await expect(frame(page).locator('audio')).toHaveAttribute('src', /^data:audio\/wav;base64,/);
  await expect(page.locator('.preview-frame')).toHaveCount(0);
  await expect(page.locator('.preview-off')).toContainText('オフ');
  await expect.poll(() => mock.calls.filter(c => c.route === 'revoke').length).toBe(1);
});

test('oversized embedded output fails before the frame mounts', async ({ page }) => {
  // A base64 payload that stays under the transport sanity checks but is
  // referenced by enough elements to exceed the render expansion budget.
  const wav = silentWav(60000); // ~1.9 MB of silence
  const references = Array.from({ length: 60 }, (_, i) => `<audio src="b.wav?x=${i}"></audio>`).join('');
  const html = `<!doctype html><body>${references}</body>`;
  const assets = [{ path: 'docs/b.wav', kind: 'audio', mime: 'audio/wav', data: wav } as AssetSpec];
  const mock = await open(page, { html, assets });
  await check(page, 3);
  await confirmAndEnable(page);
  await expect(page.getByRole('alert')).toContainText('上限');
  await expect(page.locator('.preview-frame')).toHaveCount(0);
  await expect.poll(() => mock.calls.filter(c => c.route === 'revoke').length).toBe(1);
});
