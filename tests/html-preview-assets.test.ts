// Explicit-consent HTML preview — binary asset extension tests. Covers the
// allowlisted image/audio/video/font kinds: review metadata surface (no raw
// bytes), signature verification against the extension, per-kind size caps and
// disjoint consent flags, base64 delivery inside one-shot grants, mid-read
// race rejection, and the guarantee that review/grant maps never retain raw
// payloads. Temp fixtures + fake clock only — no real user files, no playback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
const { mkdtemp, mkdir, writeFile, rm, symlink } = fsp;
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import { HtmlPreviewService } from '../server/html-preview.ts';
import { HTML_PREVIEW_LIMITS, previewAssetType } from '../shared/html-preview.ts';
import { previewAssetSignature } from '../server/html-preview-assets.ts';

const sha256Raw = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');
const LOCAL = { id: 'local' } as const;

async function fixture(files: Record<string, string | Buffer> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-html-assets-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const full = join(workspace, name);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
  }
  const store = new WorkspaceStore(join(root, 'store.json'));
  const registered = await store.add(workspace);
  let time = 1_000_000;
  const service = new HtmlPreviewService({ store, now: () => time });
  return { root, workspace, store, service, id: registered.id, now: () => time, advance: (ms: number) => { time += ms; } };
}
const cleanup = (f: { root: string }) => rm(f.root, { recursive: true, force: true });

// Minimal container headers — enough for the magic-byte signature guard, not
// meant to be playable media.
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const GIF = Buffer.from('GIF89a' + 'x'.repeat(16), 'ascii');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([20, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(16)]);
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.from([36, 0, 0, 0]), Buffer.from('WAVEfmt '), Buffer.alloc(16)]);
const MP3_ID3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(16)]);
const MP3_SYNC = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]);
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(24)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(16)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16)]);
const WOFF = Buffer.concat([Buffer.from('wOFF'), Buffer.alloc(16)]);
const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(16)]);
const TTF = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(16)]);
const OTF = Buffer.concat([Buffer.from('OTTO'), Buffer.alloc(16)]);
const PAGE = '<!doctype html><title>t</title><img src="a.png">';
const SCRIPT = 'console.log("hi");\n';

const enableBody = (reviewId: string, extra: Record<string, unknown> = {}) =>
  ({ reviewId, allowScripts: false, allowStyles: false, confirmed: true, ...extra });

test('previewAssetType exposes only the allowlist and signature checks container magic', () => {
  assert.equal(previewAssetType('.png')?.kind, 'image');
  assert.equal(previewAssetType('.mp3')?.mime, 'audio/mpeg');
  assert.equal(previewAssetType('.opus')?.mime, 'audio/ogg');
  assert.equal(previewAssetType('.m4a')?.mime, 'audio/mp4');
  assert.equal(previewAssetType('.webm')?.kind, 'video');
  assert.equal(previewAssetType('.woff2')?.kind, 'font');
  for (const ext of ['.svg', '.pdf', '.html', '.exe', '.json', '.js', '.css', '.js.map', '.bmp', '.txt']) {
    assert.equal(previewAssetType(ext), undefined, ext);
  }
  assert.equal(previewAssetType('.PNG')?.mime, 'image/png');
  assert.ok(previewAssetSignature('.png', PNG));
  assert.ok(previewAssetSignature('.mp3', MP3_ID3));
  assert.ok(previewAssetSignature('.mp3', MP3_SYNC));
  assert.ok(previewAssetSignature('.opus', OGG));
  assert.ok(previewAssetSignature('.m4a', MP4));
  assert.ok(previewAssetSignature('.ttf', Buffer.from('true' + 'x'.repeat(12), 'ascii')));
  assert.ok(!previewAssetSignature('.png', JPEG));
  assert.ok(!previewAssetSignature('.ogg', MP3_ID3));
});

test('review lists asset metadata (kind/mime/encoding/hash) but never raw content; unsupported types stay out', async () => {
  const f = await fixture({
    'docs/page.html': PAGE, 'docs/app.js': SCRIPT,
    'docs/a.png': PNG, 'docs/b.jpg': JPEG, 'docs/c.gif': GIF, 'docs/d.webp': WEBP,
    'docs/e.wav': WAV, 'docs/f.mp3': MP3_SYNC, 'docs/g.ogg': OGG, 'docs/h.opus': OGG, 'docs/i.m4a': MP4,
    'docs/j.mp4': MP4, 'docs/k.webm': WEBM,
    'docs/l.woff': WOFF, 'docs/m.woff2': WOFF2, 'docs/n.ttf': TTF, 'docs/o.otf': OTF,
    'docs/p.svg': '<svg/>', 'docs/q.pdf': Buffer.from('%PDF-1.7'), 'docs/r.json': '{}', 'docs/other.html': '<html/>',
  });
  try {
    const review = await f.service.review({ workspaceId: f.id, path: 'docs/page.html' }, LOCAL);
    const byPath = new Map(review.files.map(v => [v.path, v]));
    for (const [name, kind, mime, data] of [
      ['docs/a.png', 'image', 'image/png', PNG], ['docs/b.jpg', 'image', 'image/jpeg', JPEG],
      ['docs/c.gif', 'image', 'image/gif', GIF], ['docs/d.webp', 'image', 'image/webp', WEBP],
      ['docs/e.wav', 'audio', 'audio/wav', WAV], ['docs/f.mp3', 'audio', 'audio/mpeg', MP3_ID3 === MP3_SYNC ? MP3_ID3 : MP3_SYNC],
      ['docs/g.ogg', 'audio', 'audio/ogg', OGG], ['docs/h.opus', 'audio', 'audio/ogg', OGG], ['docs/i.m4a', 'audio', 'audio/mp4', MP4],
      ['docs/j.mp4', 'video', 'video/mp4', MP4], ['docs/k.webm', 'video', 'video/webm', WEBM],
      ['docs/l.woff', 'font', 'font/woff', WOFF], ['docs/m.woff2', 'font', 'font/woff2', WOFF2],
      ['docs/n.ttf', 'font', 'font/ttf', TTF], ['docs/o.otf', 'font', 'font/otf', OTF],
    ] as const) {
      const info = byPath.get(name);
      assert.ok(info, name);
      assert.equal(info.kind, kind);
      assert.equal(info.mime, mime);
      assert.equal(info.encoding, 'base64');
      assert.equal(info.bytes, data.length);
      assert.equal(info.sha256, sha256Raw(data));
      assert.equal((info as unknown as Record<string, unknown>).content, undefined);
    }
    for (const excluded of ['docs/p.svg', 'docs/q.pdf', 'docs/r.json', 'docs/other.html']) assert.equal(byPath.has(excluded), false, excluded);
    const script = byPath.get('docs/app.js')!;
    assert.equal(script.kind, 'script');
    assert.equal(script.encoding, undefined);
    assert.equal(script.mime, undefined);
    // The retained review record holds metadata only — no base64 or Buffer.
    const record = (f.service as any).reviews.get(review.reviewId);
    assert.ok(record);
    assert.ok(record.files.every((v: any) => Object.keys(v).sort().join(',') === 'kind,rel,sha256'));
  } finally { await cleanup(f); }
});

test('a signature that does not match the extension fails the review with preview_asset_invalid', async () => {
  for (const [name, data] of [
    ['fake.png', Buffer.from('just text, not a png')],
    ['renamed.jpg', PNG], // real PNG bytes under a JPEG extension
    ['fake.mp4', WEBM],
    ['fake.woff2', WOFF],
    ['fake.mp3', Buffer.alloc(16)],
  ] as const) {
    const f = await fixture({ 'page.html': PAGE, [name]: data });
    try {
      await assert.rejects(f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL), /preview_asset_invalid/, name);
    } finally { await cleanup(f); }
  }
});

test('per-kind size caps reject oversized assets before their bytes are read', async t => {
  const sizes: Array<[string, number]> = [
    ['big.png', 4 * 1024 * 1024 + 1], ['big.mp3', 8 * 1024 * 1024 + 1],
    ['big.mp4', 8 * 1024 * 1024 + 1], ['big.woff', 2 * 1024 * 1024 + 1],
  ];
  for (const [name, size] of sizes) {
    const f = await fixture({ 'page.html': PAGE });
    try {
      const target = join(f.workspace, name);
      const handle = await fs.open(target, 'w');
      try { await handle.truncate(size); } finally { await handle.close(); }
      const realTarget = await fs.realpath(target);
      const nativeOpen = fs.open;
      let reads = 0;
      t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
        const opened = await nativeOpen(...args);
        if (args[0] === realTarget) t.mock.method(opened, 'read', () => { reads++; throw new Error('must not be read'); });
        return opened;
      });
      await assert.rejects(f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL), /preview_resource_limit/, name);
      t.mock.restoreAll();
      assert.equal(reads, 0, `${name}: early stat rejected before any read`);
    } finally { await cleanup(f); }
  }
});

test('enable delivers base64 resources only for enabled asset kinds; flags stay disjoint and are echoed', async () => {
  const f = await fixture({ 'page.html': PAGE, 'app.js': SCRIPT, 'a.png': PNG, 'b.mp3': MP3_SYNC, 'c.mp4': MP4, 'd.woff2': WOFF2 });
  try {
    // Images only: media and fonts are verified but not delivered.
    let review = await f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL);
    let grant = await f.service.enable(enableBody(review.reviewId, { allowImages: true }), LOCAL);
    assert.deepEqual([grant.allowScripts, grant.allowStyles, grant.allowImages, grant.allowMedia, grant.allowFonts], [false, false, true, false, false]);
    assert.deepEqual(grant.resources.map(v => v.path), ['a.png']);
    const image = grant.resources[0];
    assert.equal(image.kind, 'image');
    assert.equal(image.mime, 'image/png');
    assert.equal(image.encoding, 'base64');
    assert.deepEqual(Buffer.from(image.content, 'base64'), PNG);
    assert.equal(image.sha256, sha256Raw(PNG));

    // Media flag covers audio and video, never images or fonts.
    review = await f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL);
    grant = await f.service.enable(enableBody(review.reviewId, { allowMedia: true }), LOCAL);
    assert.deepEqual(grant.resources.map(v => v.path).sort(), ['b.mp3', 'c.mp4']);

    // Fonts only; scripts stay text even when everything else is enabled.
    review = await f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL);
    grant = await f.service.enable(enableBody(review.reviewId, { allowScripts: true, allowFonts: true }), LOCAL);
    const paths = grant.resources.map(v => v.path).sort();
    assert.deepEqual(paths, ['app.js', 'd.woff2']);
    const script = grant.resources.find(v => v.path === 'app.js')!;
    assert.equal(script.content, SCRIPT);
    assert.equal(script.encoding, undefined);
    assert.equal(script.mime, undefined);
    const font = grant.resources.find(v => v.path === 'd.woff2')!;
    assert.equal(font.mime, 'font/woff2');
    assert.equal(font.encoding, 'base64');
    assert.deepEqual(Buffer.from(font.content, 'base64'), WOFF2);
  } finally { await cleanup(f); }
});

test('omitted flags default to false; non-boolean flags and unknown body keys are rejected', async () => {
  const f = await fixture({ 'page.html': PAGE, 'a.png': PNG });
  try {
    // Legacy body shape (no asset keys at all) still works and echoes flags.
    const review = await f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL);
    const grant = await f.service.enable({ reviewId: review.reviewId, allowScripts: false, allowStyles: false, confirmed: true }, LOCAL);
    assert.deepEqual([grant.allowImages, grant.allowMedia, grant.allowFonts], [false, false, false]);
    assert.equal(grant.resources.length, 0);
    for (const bad of [
      enableBody(review.reviewId, { allowImages: 'yes' }),
      enableBody(review.reviewId, { allowMedia: 1 }),
      enableBody(review.reviewId, { allowFonts: null }),
      enableBody(review.reviewId, { allowEverything: true }),
    ]) {
      const next = await f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL);
      (bad as any).reviewId = next.reviewId;
      await assert.rejects(f.service.enable(bad, LOCAL), /invalid_arguments/);
    }
  } finally { await cleanup(f); }
});

test('a changed or deleted asset between review and enable requires a fresh review', async () => {
  const f = await fixture({ 'page.html': PAGE, 'a.png': PNG });
  try {
    let review = await f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL);
    await fs.appendFile(join(f.workspace, 'a.png'), Buffer.from([0]));
    await assert.rejects(f.service.enable(enableBody(review.reviewId, { allowImages: true }), LOCAL), /preview_changed|preview_unavailable/);
    // The review is consumed — a retry cannot mint a grant either.
    await assert.rejects(f.service.enable(enableBody(review.reviewId, { allowImages: true }), LOCAL), /preview_review_unavailable/);
    review = await f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL);
    await rm(join(f.workspace, 'a.png'));
    await assert.rejects(f.service.enable(enableBody(review.reviewId, { allowImages: true }), LOCAL), /preview_unavailable|preview_changed/);
  } finally { await cleanup(f); }
});

test('an asset that grows mid-read is rejected and its handle is closed', async t => {
  const f = await fixture({ 'page.html': PAGE, 'a.png': PNG });
  try {
    const review = await f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL);
    const target = await fs.realpath(join(f.workspace, 'a.png'));
    const nativeOpen = fs.open;
    let closed = false;
    t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
      const handle = await nativeOpen(...args);
      if (args[0] === target) {
        const read = handle.read.bind(handle), close = handle.close.bind(handle);
        t.mock.method(handle, 'read', async (buffer: Buffer, offset: number, length: number, position: number) => {
          await fs.appendFile(target, Buffer.alloc(64));
          return read(buffer, offset, length, position);
        });
        t.mock.method(handle, 'close', async () => { closed = true; return close(); });
      }
      return handle;
    });
    await assert.rejects(f.service.enable(enableBody(review.reviewId, { allowImages: true }), LOCAL), /preview_changed|preview_resource_limit|preview_unavailable/);
    assert.equal(closed, true);
  } finally { t.mock.restoreAll(); await cleanup(f); }
});

test('an asset swapped for a different inode mid-read is rejected and its handle is closed', async t => {
  const f = await fixture({ 'page.html': PAGE, 'a.png': PNG });
  try {
    const review = await f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL);
    const target = await fs.realpath(join(f.workspace, 'a.png'));
    const nativeOpen = fs.open;
    let closed = false;
    t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
      const handle = await nativeOpen(...args);
      if (args[0] === target) {
        const close = handle.close.bind(handle);
        t.mock.method(handle, 'close', async () => { closed = true; return close(); });
        // Replace the inode while the old handle is still open.
        await rm(target);
        await writeFile(target, PNG);
      }
      return handle;
    });
    await assert.rejects(f.service.enable(enableBody(review.reviewId, { allowImages: true }), LOCAL), /preview_changed|preview_unavailable/);
    assert.equal(closed, true);
  } finally { t.mock.restoreAll(); await cleanup(f); }
});

test('a directory junction retargeted outside the approved base is rejected for assets too', async t => {
  const f = await fixture({ 'docs/page.html': PAGE, 'docs/assets/a.png': PNG, 'other/a.png': PNG });
  try {
    const review = await f.service.review({ workspaceId: f.id, path: 'docs/page.html' }, LOCAL);
    await rm(join(f.workspace, 'docs', 'assets'), { recursive: true });
    try { await symlink(join(f.workspace, 'other'), join(f.workspace, 'docs', 'assets'), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) { t.skip('Fixture symlinks unavailable'); return; } throw error; }
    await assert.rejects(f.service.enable(enableBody(review.reviewId, { allowImages: true }), LOCAL), /preview_outside_base|preview_unavailable/);
  } finally { await cleanup(f); }
});

test('an asset symlinked outside the workspace is rejected at enable', async t => {
  const f = await fixture({ 'docs/page.html': PAGE });
  try {
    const outside = join(f.root, 'outside');
    await mkdir(outside);
    const external = join(outside, 'a.png');
    await writeFile(external, PNG);
    await mkdir(join(f.workspace, 'docs', 'assets'));
    try { await symlink(external, join(f.workspace, 'docs', 'assets', 'a.png'), 'file'); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) { t.skip('Fixture symlinks unavailable'); return; } throw error; }
    await assert.rejects(f.service.review({ workspaceId: f.id, path: 'docs/page.html' }, LOCAL), /preview_outside_workspace|preview_unavailable/);
  } finally { await cleanup(f); }
});

test('grant records and the queue never retain raw asset payloads', async () => {
  const f = await fixture({ 'page.html': PAGE, 'a.png': PNG });
  try {
    const review = await f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL);
    const grant = await f.service.enable(enableBody(review.reviewId, { allowImages: true }), LOCAL);
    assert.equal(Buffer.from(grant.resources[0].content, 'base64').length, PNG.length);
    const record = (f.service as any).grants.get(grant.grantId);
    assert.ok(record);
    assert.deepEqual(Object.keys(record).sort(), ['basePath', 'entryPath', 'expiresAt', 'identityId']);
    // Review consumed; neither map holds the base64 string.
    assert.equal((f.service as any).reviews.size, 0);
    const serialized = JSON.stringify([...(f.service as any).grants.values()]);
    assert.equal(serialized.includes(PNG.toString('base64')), false);
  } finally { await cleanup(f); }
});

test('oversized review total fails even when each asset is under its own cap', async () => {
  const f = await fixture({ 'page.html': PAGE });
  try {
    // 5 × 4 MiB images exceed the 16 MiB total while each stays under 4 MiB.
    for (let i = 0; i < 5; i++) {
      const target = join(f.workspace, `a${i}.png`);
      const handle = await fs.open(target, 'w');
      try {
        await handle.truncate(4 * 1024 * 1024);
        // Rewrite the header so the signature check would pass if reached.
        const head = Buffer.alloc(4 * 1024 * 1024);
        PNG.copy(head, 0);
        const pos = await handle.stat().then(() => 0);
        await handle.write(head, 0, head.length, pos);
      } finally { await handle.close(); }
    }
    await assert.rejects(f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL), /preview_resource_limit|preview_scan_limit/);
  } finally { await cleanup(f); }
});
