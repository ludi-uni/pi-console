import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import {HTML_PREVIEW_SHELL_CSP} from '../shared/html-preview.ts';

// GET /api/workspace/html serves workspace HTML for the sandboxed tab view and
// reuses the workspace text guards for everything outside .html/.htm.
test('HTML tab serves only the trusted consent shell and keeps preview APIs behind authentication and CSRF', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(),'pi-console-html-'));
  const workspace = join(root,'workspace'); await mkdir(workspace);
  const page = '<!doctype html><title>report</title><h1>Local report</h1><script>globalThis.ran=true</script>';
  await writeFile(join(workspace,'report.html'),page);
  await writeFile(join(workspace,'legacy.htm'),'<p>legacy</p>');
  await writeFile(join(workspace,'note.txt'),'plain text');
  await writeFile(join(root,'secret.html'),'outside');
  const port = 32000+Math.floor(Math.random()*10000);
  const proc = spawn(process.execPath, ['--import','tsx','server/index.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), PI_CONSOLE_DATA_DIR: join(root,'data'), PI_CODING_AGENT_SESSION_DIR: join(root,'sessions'), PI_CONSOLE_PUBLIC_ORIGIN: '', PI_CONSOLE_ACCESS_TEAM_DOMAIN: '', PI_CONSOLE_ACCESS_AUD: '' }, stdio:'pipe' });
  let output=''; proc.stdout.on('data',d=>output+=d.toString()); proc.stderr.on('data',d=>output+=d.toString());
  const base=`http://127.0.0.1:${port}`;
  try {
    const until=Date.now()+15000; while (!output.includes('pi-console http:') && Date.now()<until) await new Promise(r=>setTimeout(r,50)); assert.match(output,/pi-console http:/);
    const created = await fetch(base+'/api/workspaces',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:workspace})});
    const ws = (await created.json()).workspace;
    const html = await fetch(`${base}/api/workspace/html?workspaceId=${ws.id}&path=${encodeURIComponent('report.html')}`);
    assert.equal(html.status,200);
    const headers = html.headers;
    assert.equal(headers.get('content-type'),'text/html; charset=utf-8');
    assert.equal(headers.get('cache-control'),'no-store');
    assert.equal(headers.get('x-content-type-options'),'nosniff');
    assert.equal(headers.get('referrer-policy'),'no-referrer');
    const csp = headers.get('content-security-policy') ?? '';
    assert.equal(csp,HTML_PREVIEW_SHELL_CSP);
    assert.equal(headers.get('x-dns-prefetch-control'),'off');
    const shell=await html.text();assert.ok(shell.includes('id="root"'));assert.ok(!shell.includes('globalThis.ran'));
    const call=(route:string,body:object,origin=base)=>fetch(`${base}/api/workspace/preview/${route}`,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)});
    assert.equal((await call('review',{workspaceId:ws.id,path:'report.html'},'null')).status,403);
    assert.equal((await call('review',{workspaceId:ws.id,path:'report.html'},'https://evil.example')).status,403);
    const reviewed=await call('review',{workspaceId:ws.id,path:'report.html'});assert.equal(reviewed.status,200);const review=await reviewed.json();assert.equal(review.documentHtml,page);
    assert.equal((await call('enable',{reviewId:review.reviewId,allowScripts:true,allowStyles:false,confirmed:false})).status,400);
    const enabled=await call('enable',{reviewId:review.reviewId,allowScripts:true,allowStyles:false,confirmed:true});assert.equal(enabled.status,200);const grant=await enabled.json();assert.equal(grant.allowScripts,true);
    assert.equal((await call('revoke',{grantId:grant.grantId})).status,200);
    const legacy = await fetch(`${base}/api/workspace/html?workspaceId=${ws.id}&path=${encodeURIComponent('legacy.htm')}`);
    assert.equal(legacy.status,200);assert.equal(await legacy.text(),shell);
    const outside = await fetch(`${base}/api/workspace/html?workspaceId=${ws.id}&path=${encodeURIComponent('../secret.html')}`);
    assert.equal(outside.status,400);
    const absolute = await fetch(`${base}/api/workspace/html?workspaceId=${ws.id}&path=${encodeURIComponent(join(root,'secret.html'))}`);
    assert.equal(absolute.status,400);
    const notHtml = await fetch(`${base}/api/workspace/html?workspaceId=${ws.id}&path=${encodeURIComponent('note.txt')}`);
    assert.equal(notHtml.status,400);
    const missing = await fetch(`${base}/api/workspace/html?workspaceId=${ws.id}&path=${encodeURIComponent('missing.html')}`);
    assert.equal(missing.status,400);
    const badWorkspace = await fetch(`${base}/api/workspace/html?workspaceId=unknown&path=${encodeURIComponent('report.html')}`);
    assert.equal(badWorkspace.status,400);
  } finally { proc.kill(); await once(proc,'close').catch(()=>{});await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200}); }
});
