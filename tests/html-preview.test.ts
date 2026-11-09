// Explicit-consent HTML preview backend: review/enable/revoke lifecycle,
// identity binding and expiry, one-shot consumption, change/deletion
// re-approval, containment and scan/size limits — all against temp workspaces
// and a fake clock. No HTTP server, browser or external fetch is involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import { HtmlPreviewService, createHtmlPreviewHttp } from '../server/html-preview.ts';
import { HTML_PREVIEW_LIMITS } from '../shared/html-preview.ts';
import { PermissionFault } from '../server/workspace-permissions.ts';

const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const LOCAL = { id: 'local' } as const;

async function fixture(files: Record<string, string | Buffer> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pi-console-html-preview-'));
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

const PAGE = '<!doctype html><title>t</title><script src="app.js"></script>';
const SCRIPT = 'console.log("hi");\n';
const STYLE = 'body{margin:0}\n';

test('review snapshots the entry HTML and its base-dir resources for user verification', async () => {
  const f = await fixture({
    'docs/page.html': PAGE, 'docs/app.js': SCRIPT, 'docs/site.css': STYLE,
    'docs/deep/util.js': 'x', 'note.js': 'ignored-outside-base', 'docs/readme.md': 'not-a-resource',
  });
  try {
    const review = await f.service.review({ workspaceId: f.id, path: 'docs/page.html' }, LOCAL);
    assert.ok(/^[0-9a-f]{32}$/.test(review.reviewId));
    assert.equal(review.expiresAt, 1_000_000 + HTML_PREVIEW_LIMITS.reviewTtlMs);
    assert.equal(review.entryPath, 'docs/page.html');
    assert.equal(review.basePath, 'docs');
    assert.equal(review.documentHtml, PAGE);
    assert.deepEqual(review.files.map(v => v.path).sort(), ['docs/app.js', 'docs/deep/util.js', 'docs/page.html', 'docs/site.css']);
    const script = review.files.find(v => v.path === 'docs/app.js')!;
    assert.deepEqual({ kind: script.kind, bytes: script.bytes, sha256: script.sha256 },
      { kind: 'script', bytes: Buffer.byteLength(SCRIPT), sha256: sha256(SCRIPT) });
  } finally { await cleanup(f); }
});

test('enable returns only flag-approved resources, consumes the review, and revoke deletes the grant', async () => {
  const f = await fixture({ 'page.html': PAGE, 'app.js': SCRIPT, 'site.css': STYLE });
  try {
    const review = await f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL);
    const grant = await f.service.enable({ reviewId: review.reviewId, allowScripts: true, allowStyles: false, confirmed: true }, LOCAL);
    assert.ok(/^[0-9a-f]{32}$/.test(grant.grantId));
    assert.equal(grant.expiresAt, 1_000_000 + HTML_PREVIEW_LIMITS.grantTtlMs);
    assert.equal(grant.allowScripts, true); assert.equal(grant.allowStyles, false);
    assert.equal(grant.documentHtml, PAGE);
    assert.deepEqual(grant.resources.map(v => v.path), ['app.js']);
    assert.equal(grant.resources[0].content, SCRIPT);
    // One-shot: the review cannot mint a second grant.
    await assert.rejects(f.service.enable({ reviewId: review.reviewId, allowScripts: true, allowStyles: false, confirmed: true }, LOCAL), /preview_review_unavailable/);
    // Revoke is identity-checked and deletes the grant; a second revoke fails.
    await assert.rejects(f.service.revoke({ grantId: grant.grantId }, { id: 'other' }), /preview_identity_mismatch/);
    assert.deepEqual(await f.service.revoke({ grantId: grant.grantId }, LOCAL), { ok: true });
    await assert.rejects(f.service.revoke({ grantId: grant.grantId }, LOCAL), /preview_grant_unavailable/);
  } finally { await cleanup(f); }
});

test('concurrent enables produce at most one grant', async () => {
  const f = await fixture({ 'page.html': PAGE, 'app.js': SCRIPT });
  try {
    const review = await f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL);
    const body = { reviewId: review.reviewId, allowScripts: true, allowStyles: true, confirmed: true };
    const results = await Promise.allSettled([f.service.enable(body, LOCAL), f.service.enable(body, LOCAL)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  } finally { await cleanup(f); }
});

test('review and grant expiry advance with the fake clock and bind to the caller identity', async () => {
  const f = await fixture({ 'page.html': PAGE, 'app.js': SCRIPT });
  try {
    const review = await f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL);
    // Another principal cannot spend this review while it is alive.
    await assert.rejects(f.service.enable({ reviewId: review.reviewId, allowScripts: false, allowStyles: false, confirmed: true }, { id: 'other' }), /preview_identity_mismatch/);
    f.advance(HTML_PREVIEW_LIMITS.reviewTtlMs + 1);
    await assert.rejects(f.service.enable({ reviewId: review.reviewId, allowScripts: false, allowStyles: false, confirmed: true }, LOCAL), /preview_review_unavailable/);
    // An identity whose authentication already expired cannot act at all.
    await assert.rejects(f.service.review({ workspaceId: f.id, path: 'page.html' }, { id: 'expired', expiresAt: 999 }), /preview_identity_expired/);
    // Snapshot lifetime is capped by the authentication expiry, and every
    // later step re-checks it.
    const authExpiry = f.now() + 30_000;
    const capped = await f.service.review({ workspaceId: f.id, path: 'page.html' }, { id: 'remote', expiresAt: authExpiry });
    assert.equal(capped.expiresAt, authExpiry);
    f.advance(31_000);
    await assert.rejects(f.service.enable({ reviewId: capped.reviewId, allowScripts: false, allowStyles: false, confirmed: true }, { id: 'remote', expiresAt: authExpiry }), /preview_identity_expired/);
    const live = await f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL);
    const grant = await f.service.enable({ reviewId: live.reviewId, allowScripts: false, allowStyles: false, confirmed: true }, LOCAL);
    f.advance(HTML_PREVIEW_LIMITS.grantTtlMs);
    await assert.rejects(f.service.revoke({ grantId: grant.grantId }, LOCAL), /preview_grant_unavailable/);
  } finally { await cleanup(f); }
});

test('missing or malformed identity is denied; strict bodies reject unknown fields', async () => {
  const f = await fixture({ 'page.html': PAGE });
  try {
    for (const identity of [undefined, { id: '' }]) {
      await assert.rejects(f.service.review({ workspaceId: f.id, path: 'page.html' }, identity), /preview_identity_required/);
      await assert.rejects(f.service.revoke({ grantId: 'x' }, identity), /preview_identity_required/);
    }
    await assert.rejects(f.service.review({ workspaceId: f.id, path: 'page.html', extra: 1 }, LOCAL), /invalid_arguments/);
    await assert.rejects(f.service.review({ workspaceId: f.id }, LOCAL), /invalid_arguments/);
    const review = await f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL);
    for (const body of [
      { reviewId: review.reviewId, allowScripts: 1, allowStyles: false, confirmed: true },
      { reviewId: review.reviewId, allowScripts: true, allowStyles: false, confirmed: 'true' },
      { reviewId: review.reviewId, allowScripts: true, allowStyles: false, confirmed: true, extra: 1 },
      { allowScripts: true, allowStyles: false, confirmed: true },
    ]) await assert.rejects(f.service.enable(body, LOCAL), /invalid_arguments/);
    await assert.rejects(f.service.review({ workspaceId: f.id, path: 'note.txt' }, LOCAL), /preview_not_html/);
    await assert.rejects(f.service.review({ workspaceId: 'missing', path: 'page.html' }, LOCAL), /preview_unavailable/);
    await assert.rejects(f.service.review({ workspaceId: f.id, path: '../outside.html' }, LOCAL), /preview_unavailable/);
    await assert.rejects(f.service.review({ workspaceId: f.id, path: 'missing.html' }, LOCAL), /preview_unavailable/);
  } finally { await cleanup(f); }
});

test('enable re-reads approved files and rejects on change or deletion', async () => {
  const f = await fixture({ 'page.html': PAGE, 'app.js': SCRIPT, 'site.css': STYLE });
  try {
    // Content change after review → re-approval required; review is consumed.
    let review = await f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL);
    await appendFile(join(f.workspace, 'app.js'), '// edited\n');
    await assert.rejects(f.service.enable({ reviewId: review.reviewId, allowScripts: true, allowStyles: true, confirmed: true }, LOCAL), /preview_changed/);
    await assert.rejects(f.service.enable({ reviewId: review.reviewId, allowScripts: true, allowStyles: true, confirmed: true }, LOCAL), /preview_review_unavailable/);
    // Deletion also fails (the re-read itself cannot complete).
    review = await f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL);
    await rm(join(f.workspace, 'site.css'));
    await assert.rejects(f.service.enable({ reviewId: review.reviewId, allowScripts: true, allowStyles: true, confirmed: true }, LOCAL), /preview_unavailable|preview_changed/);
  } finally { await cleanup(f); }
});

test('symlinked directories are never traversed and escape files are excluded', async () => {
  const f = await fixture({ 'docs/page.html': PAGE, 'docs/app.js': SCRIPT });
  try {
    const outside = join(f.root, 'outside'); await mkdir(outside);
    await writeFile(join(outside, 'secret.js'), 'private');
    await symlink(outside, join(f.workspace, 'docs', 'linked'), 'junction').catch(() => {});
    const review = await f.service.review({ workspaceId: f.id, path: 'docs/page.html' }, LOCAL);
    assert.deepEqual(review.files.map(v => v.path).sort(), ['docs/app.js', 'docs/page.html']);
  } finally { await cleanup(f); }
});

test('hidden/tooling directories and .pi-console are excluded from the candidate list', async () => {
  const f = await fixture({
    'docs/page.html': PAGE, 'docs/app.js': SCRIPT,
    'docs/.git/config.js': 'x', 'docs/node_modules/pkg/index.js': 'x',
    'docs/.hidden/x.css': 'x', 'docs/.pi-console/data.js': 'x', 'docs/visible.js': 'y',
  });
  try {
    const review = await f.service.review({ workspaceId: f.id, path: 'docs/page.html' }, LOCAL);
    assert.deepEqual(review.files.map(v => v.path).sort(), ['docs/app.js', 'docs/page.html', 'docs/visible.js']);
  } finally { await cleanup(f); }
});

test('scan and resource limits fail explicitly instead of truncating', async () => {
  const many: Record<string, string> = { 'docs/page.html': PAGE };
  for (let i = 0; i <= HTML_PREVIEW_LIMITS.maxResources; i++) many[`docs/f${i}.js`] = 'x';
  const f = await fixture(many);
  try {
    // The 65th resource trips the explicit scan cap rather than truncating.
    await assert.rejects(f.service.review({ workspaceId: f.id, path: 'docs/page.html' }, LOCAL), /preview_scan_limit|preview_resource_limit/);
  } finally { await cleanup(f); }

  const big = await fixture({ 'page.html': PAGE, 'huge.js': 'x'.repeat(256 * 1024 + 1) });
  try {
    await assert.rejects(big.service.review({ workspaceId: big.id, path: 'page.html' }, LOCAL), /preview_unavailable/);
  } finally { await cleanup(big); }
});

test('per-principal review/grant caps bound memory snapshots', async () => {
  const f = await fixture({ 'page.html': PAGE });
  try {
    for (let i = 0; i < HTML_PREVIEW_LIMITS.maxReviews; i++) {
      assert.ok((await f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL)).reviewId);
    }
    await assert.rejects(f.service.review({ workspaceId: f.id, path: 'page.html' }, LOCAL), /preview_review_limit/);
  } finally { await cleanup(f); }
});

test('exactly 64 resources are allowed even with non-resource entries afterwards',async()=>{
 const files:Record<string,string>={'zz-page.html':PAGE,'zzz-note.txt':'not a resource'};
 for(let i=0;i<HTML_PREVIEW_LIMITS.maxResources;i++)files[`f${i}.js`]='x';
 const f=await fixture(files);
 try{const review=await f.service.review({workspaceId:f.id,path:'zz-page.html'},LOCAL);assert.equal(review.files.length,65);}
 finally{await cleanup(f);}
});

test('authentication is rechecked after asynchronous review reads',async()=>{
 const f=await fixture({'page.html':PAGE}),identity={id:'remote',expiresAt:f.now()+1000};
 try{
  const service=f.service as any,read=service.readApproved.bind(service);
  service.readApproved=async(...args:any[])=>{const value=await read(...args);f.advance(1001);return value;};
  await assert.rejects(f.service.review({workspaceId:f.id,path:'page.html'},identity),/preview_identity_expired/);
 }finally{await cleanup(f);}
});

test('a review or authentication that expires during enable cannot issue a grant',async()=>{
 for(const authExpiry of [false,true]){
  const f=await fixture({'page.html':PAGE}),identity=authExpiry?{id:'remote',expiresAt:f.now()+1000}:LOCAL;
  try{
   const review=await f.service.review({workspaceId:f.id,path:'page.html'},identity);
   const service=f.service as any,read=service.readApproved.bind(service);
   service.readApproved=async(...args:any[])=>{const value=await read(...args);f.advance(authExpiry?1001:HTML_PREVIEW_LIMITS.reviewTtlMs+1);return value;};
   await assert.rejects(f.service.enable({reviewId:review.reviewId,allowScripts:true,allowStyles:false,confirmed:true},identity),authExpiry?/preview_identity_expired/:/preview_review_unavailable/);
  }finally{await cleanup(f);}
 }
});

test('a directory junction retargeted outside the approved base is rejected even for identical bytes',async(t)=>{
 const f=await fixture({'docs/page.html':PAGE,'docs/assets/app.js':SCRIPT,'other/app.js':SCRIPT});
 try{
  const review=await f.service.review({workspaceId:f.id,path:'docs/page.html'},LOCAL);
  await rm(join(f.workspace,'docs','assets'),{recursive:true});
  try{await symlink(join(f.workspace,'other'),join(f.workspace,'docs','assets'),process.platform==='win32'?'junction':'dir');}
  catch(error){if(['EPERM','EACCES','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??'')){t.skip('Fixture symlinks unavailable');return;}throw error;}
  await assert.rejects(f.service.enable({reviewId:review.reviewId,allowScripts:true,allowStyles:false,confirmed:true},LOCAL),/preview_outside_base/);
 }finally{await cleanup(f);}
});

function httpReq(path: string, body?: unknown, method = 'POST', headers: Record<string, string> = {}) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as any;
  req.method = method; req.url = path; req.headers = { 'content-type': 'application/json', ...headers };
  return req;
}
async function httpCall(http: ReturnType<typeof createHtmlPreviewHttp>, path: string, body?: unknown, method = 'POST', headers: Record<string, string> = {}) {
  let code = 0, value: any;
  const handled = await http.handle(httpReq(path, body, method, headers), {
    writeHead: (status: number) => { code = status; },
    end: (data: string) => { value = JSON.parse(data); },
  } as any);
  return { handled, code, value };
}

test('HTTP boundary: strict POST-only routes, stable error codes, no-store/nosniff', async () => {
  const f = await fixture({ 'page.html': PAGE, 'app.js': SCRIPT });
  try {
    const http = createHtmlPreviewHttp({ service: f.service, identity: req => req.headers['x-test-deny'] ? undefined : LOCAL });
    // Unrelated paths pass through untouched.
    assert.equal((await httpCall(http, '/api/workspace/text', {})).handled, false);
    assert.equal((await httpCall(http, '/api/workspace/preview/other', {})).handled, false);
    // GET and queries are denied on the known routes.
    for (const [path, method] of [['/api/workspace/preview/review', 'GET'], ['/api/workspace/preview/review?x=1', 'POST']] as const) {
      const r = await httpCall(http, path, {}, method);
      assert.equal(r.handled, true); assert.equal(r.code, 400); assert.equal(r.value.error, 'preview_route_unavailable');
    }
    // Missing identity and unknown fields are denied with stable codes.
    const denied = await httpCall(http, '/api/workspace/preview/review', { workspaceId: f.id, path: 'page.html' }, 'POST', { 'x-test-deny': '1' });
    assert.equal(denied.code, 403); assert.equal(denied.value.error, 'preview_identity_required');
    const extra = await httpCall(http, '/api/workspace/preview/review', { workspaceId: f.id, path: 'page.html', bad: 1 });
    assert.equal(extra.code, 400); assert.equal(extra.value.error, 'invalid_arguments');
    const req = httpReq('/api/workspace/preview/review', { workspaceId: f.id, path: 'page.html' });
    let code = 0, headers: any;
    const handled = await http.handle(req, { writeHead: (s: number, h: any) => { code = s; headers = h; }, end() {} } as any);
    assert.equal(handled, true); assert.equal(code, 200);
    assert.equal(headers['cache-control'], 'no-store');
    assert.equal(headers['x-content-type-options'], 'nosniff');
  } finally { await cleanup(f); }
});
