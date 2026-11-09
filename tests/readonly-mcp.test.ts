import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../server/runtime/workspaces.ts';
import { RuntimeManager } from '../server/runtime/manager.ts';
import { SessionEvents } from '../server/runtime/events.ts';
import { createReadOnlyMcp, readOnlyMcpEnabled } from '../server/readonly-mcp.ts';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { loadReadOnlyMcpAuthentication, readOnlyMcpAuthHeader, type ReadOnlyMcpAuthentication } from '../server/readonly-mcp-auth.ts';

const secret = 'PRIVATE_CONVERSATION_COMMAND_KEY_PATH';
// OS body/helpers live only in the separately approved explicit entry. This
// unconditional placeholder stays skipped even on Windows or with legacy env flags.
test('manual Windows setup protects only a dummy key, pins scope and preserves existing config',
  {skip:'OS acceptance deferred: tests/os-acceptance/readonly-key.entry.ts; separate user approval required'},
  ()=>{throw new Error('OS acceptance is not part of unit/regression');});
async function fixture(enabled = true, restricted = false, fallback = 404, authentication?: ReadOnlyMcpAuthentication) {
  const root = await mkdtemp(join(tmpdir(), 'pi-readonly-mcp-'));
  const sessions = join(root, 'sessions'); await mkdir(sessions);
  const store = new WorkspaceStore(join(root, 'workspaces.json'));
  const workspace = await store.add(root);
  const otherPath = join(root, 'other'); await mkdir(otherPath);
  const other = await store.add(otherPath);
  await writeFile(join(sessions, 'closed.jsonl'), JSON.stringify({ type: 'session', id: 'closed', cwd: root, name: secret }) + '\n' + secret);
  const runtime = new RuntimeManager(store, sessions, join(root, 'reports'), join(root, 'queue'));
  let mutations = 0;
  for (const name of ['open', 'resume', 'prompt', 'stop', 'kitStatus', 'kitDecisions', 'activity', 'startOrchestrator', 'shutdown']) {
    (runtime as any)[name] = () => { mutations++; throw new Error('FORBIDDEN ' + secret); };
  }
  const session = { id: 'observed', workspaceId: workspace.id, filePath: secret, name: secret };
  const state = new SessionEvents(session, () => 'running');
  state.preparePrompt(secret); state.ingest({ type: 'agent_start' });
  state.publishNode({ id: secret, kind: 'tool', label: secret, status: 'running', parentId: state.activeRunId,
    sourceKind: 'pi', correlation: 'explicit', nativeId: secret, action: secret, model: secret, provider: secret,
    details: { secret }, updatedAt: new Date().toISOString() });
  const worker = { state: 'running', start() { mutations++; }, call() { mutations++; }, close() { mutations++; } };
  (runtime as any).active.set(session.id, { session, state, worker });
  const scope = { version: 1, workspaces: restricted ? [{ id: workspace.id, path: workspace.path, sessionIds: ['closed'] }] : [
    { id: workspace.id, path: workspace.path, sessionIds: ['closed','observed'] },
    { id: other.id, path: other.path, sessionIds: ['foreign','other-observed'] },
  ] };
  const denials: string[][] = [];
  const mcp = createReadOnlyMcp(runtime, { enabled, version: '0.5.0', scope, authentication, onNativeDenial: (reasons: string[]) => denials.push(reasons) } as any);
  const server = createServer((req, res) => void mcp.handle(req, res).then(handled => { if (!handled) { res.writeHead(fallback); res.end(); } }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/mcp/readonly`;
  const request = (body: unknown, headers: Record<string,string> = {}) => fetch(url, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(authentication ? { [readOnlyMcpAuthHeader]: authentication.key } : {}), ...headers }, body: JSON.stringify(body) });
  const rpc = async (method: string, params: unknown = {}) => (await request({ jsonrpc: '2.0', id: 1, method, params })).json();
  const call = async (name: string, args: unknown = {}) => {
    const result = await rpc('tools/call', { name, arguments: args });
    assert.ok(!JSON.stringify(result).includes(secret)); return result;
  };
  const close = async () => { mcp.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); };
  return { root, workspace, other, runtime, state, worker, mcp, scope, denials, url, request, rpc, call, close, mutations: () => mutations };
}

const dummyMcpKey = 'a7'.repeat(32); // Deterministic fixture only; never installed as a live key.
test('dedicated authentication permits proxy presence only after key verification and retains every other boundary', async () => {
  const f = await fixture(true,true,404,{mode:'shared_secret',key:dummyMcpKey});
  try {
    const request = {jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_status',arguments:{}}};
    const before=await readFile(join(f.root,'workspaces.json'),'utf8'),seq=f.state.seq;
    for(const proxy of [{forwarded:'for=untrusted'}, {'x-forwarded-for':'arbitrary'}, {'x-forwarded-host':'foreign.invalid'}, {via:'arbitrary'}, {'x-real-ip':'192.0.2.1'}] as Record<string,string>[]) {
      const response=await f.request(request,proxy);assert.equal(response.status,200);
      const result=await response.json();assert.equal(result.result.structuredContent.workspaces.length,1);assert.ok(!JSON.stringify(result).includes(dummyMcpKey));
    }
    for(const key of ['', 'b8'.repeat(32), 'too-short', '0'.repeat(64)]) {
      const response=await f.request(request,{[readOnlyMcpAuthHeader]:key,'x-forwarded-for':'arbitrary'});
      assert.equal(response.status,401);assert.equal(response.headers.get('www-authenticate'),null);
      const text=await response.text();assert.ok(!text.includes(dummyMcpKey));assert.ok(!text.includes('b8'.repeat(32)));assert.match(text,/mcp_auth_failed/);
    }
    const without=await fetch(f.url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify(request)});
    assert.equal(without.status,401);
    for(const denied of [{origin:'https://fixture.invalid'},{'cf-ray':'dummy'},{'sec-fetch-site':'cross-site'}] as Record<string,string>[]) assert.equal((await f.request(request,denied)).status,403);
    const raw=async(headers: Record<string,string|string[]>)=>new Promise<number|undefined>((resolve,reject)=>{
      const req=httpRequest(f.url,{method:'POST',headers},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end(JSON.stringify(request));
    });
    assert.equal(await raw({Host:'foreign.invalid',[readOnlyMcpAuthHeader]:dummyMcpKey}),403);
    assert.equal(await raw({[readOnlyMcpAuthHeader]:[dummyMcpKey,dummyMcpKey]}),401);
    const base=new URL(f.url).origin;
    for(const path of ['/.well-known/oauth-protected-resource/mcp/readonly','/.well-known/oauth-protected-resource']) {
      assert.equal((await fetch(base+path)).status,401);
      assert.equal((await fetch(base+path,{headers:{[readOnlyMcpAuthHeader]:dummyMcpKey}})).status,404);
      assert.equal((await fetch(base+path,{headers:{[readOnlyMcpAuthHeader]:dummyMcpKey,origin:'https://fixture.invalid'}})).status,403);
    }
    assert.ok(!JSON.stringify(f.denials).includes(dummyMcpKey));assert.equal(f.mutations(),0);assert.equal(f.state.seq,seq);assert.equal(await readFile(join(f.root,'workspaces.json'),'utf8'),before);
    f.mcp.dispose();assert.equal((await f.request(request)).status,401);
    assert.equal((await f.request(request,{[readOnlyMcpAuthHeader]:'0'.repeat(64)})).status,401,'disposed zeroed key must not authenticate');
  } finally {await f.close()}
});

test('authentication mode/key loading is explicit, missing or malformed credentials fail closed with fixed errors', async () => {
  const root=await mkdtemp(join(tmpdir(),'pi-readonly-auth-'));
  try {
    assert.equal(await loadReadOnlyMcpAuthentication({},root),undefined);
    for(const env of [
      {PI_CONSOLE_READONLY_MCP_AUTH:'invalid'},
      {PI_CONSOLE_READONLY_MCP_KEY:dummyMcpKey},
      {PI_CONSOLE_READONLY_MCP_AUTH:'shared_secret'},
      {PI_CONSOLE_READONLY_MCP_AUTH:'shared_secret',PI_CONSOLE_READONLY_MCP_KEY:''},
      {PI_CONSOLE_READONLY_MCP_AUTH:'shared_secret',PI_CONSOLE_READONLY_MCP_KEY:secret},
    ]) await assert.rejects(loadReadOnlyMcpAuthentication(env,root),error=>!String(error).includes(dummyMcpKey)&&!String(error).includes(secret));
    await writeFile(join(root,'readonly-mcp.key'),dummyMcpKey+'\n',{mode:0o600});
    assert.deepEqual(await loadReadOnlyMcpAuthentication({PI_CONSOLE_READONLY_MCP_AUTH:'shared_secret'},root),{mode:'shared_secret',key:dummyMcpKey});
    assert.deepEqual(await loadReadOnlyMcpAuthentication({PI_CONSOLE_READONLY_MCP_AUTH:'shared_secret',PI_CONSOLE_READONLY_MCP_KEY:'b8'.repeat(32)},root),{mode:'shared_secret',key:'b8'.repeat(32)});
    await writeFile(join(root,'readonly-mcp.key'),secret.repeat(100));
    await assert.rejects(loadReadOnlyMcpAuthentication({PI_CONSOLE_READONLY_MCP_AUTH:'shared_secret'},root));
    assert.equal(await loadReadOnlyMcpAuthentication({},root),undefined,'native mode must not inspect a key file');
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
});

const modernMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'isolated-client', version: '1' },
};
test('sessionless discovery, catalog and scoped reads use official SDK metadata and complete result contract', async () => {
  const f = await fixture(true, true);
  try {
    const modern = async (method: string, params: any = {}) => {
      const response = await f.request({ jsonrpc: '2.0', id: 41, method, params: { ...params, _meta: modernMeta } },
        { 'mcp-protocol-version': '2026-07-28', 'mcp-method': method, ...(method === 'tools/call' ? { 'mcp-name': params.name } : {}) });
      const data = await response.json();
      if (data.result) {
        assert.equal(data.result.resultType, 'complete');
        assert.deepEqual(data.result._meta, { 'io.modelcontextprotocol/serverInfo': { name: 'pi-console-readonly', version: '0.5.0' } });
      }
      assert.ok(!JSON.stringify(data).includes(secret));
      return { response, data };
    };
    const discovered = await modern('server/discover');
    assert.equal(discovered.response.status, 200);
    assert.deepEqual(discovered.data.result.supportedVersions, ['2026-07-28','2025-06-18','2025-03-26']);
    assert.deepEqual(discovered.data.result.capabilities, { tools: {} });
    assert.equal(discovered.data.result.cacheScope, 'private'); assert.equal(discovered.data.result.ttlMs, 0);
    const list = await modern('tools/list');
    assert.deepEqual(list.data.result.tools.map((t: any) => t.name), ['get_status','list_sessions','get_progress']);
    const status = (await modern('tools/call', { name: 'get_status', arguments: {} })).data.result.structuredContent;
    const ws = { serverId: status.serverId, workspaceId: status.workspaces[0].workspaceId };
    const sessions = (await modern('tools/call', { name: 'list_sessions', arguments: ws })).data.result.structuredContent.sessions;
    assert.equal(sessions.length, 1);
    const target = { ...ws, sessionId: sessions[0].sessionId, generation: null, runId: null };
    const progress = await modern('tools/call', { name: 'get_progress', arguments: target });
    assert.equal(progress.data.result.structuredContent.currentStatus, 'unknown');
    const stale = await modern('tools/call', { name: 'get_progress', arguments: { ...target, serverId: 'stale' } });
    assert.equal(stale.response.status, 400); assert.equal(stale.data.error.code, -32602);
    const forbidden = await modern('tools/call', { name: 'prompt', arguments: {} });
    assert.equal(forbidden.response.status, 400); assert.equal(forbidden.data.error.code, -32602);
    for (const method of ['initialize','ping','resources/read']) {
      const missing = await modern(method); assert.equal(missing.response.status, 404); assert.equal(missing.data.error.code, -32601);
    }
    assert.equal(f.mutations(), 0);
  } finally { await f.close(); }
});

test('modern HTTP headers, required metadata, unsupported versions and client identity fail before runtime reads', async () => {
  const f = await fixture();
  try {
    let reads = 0; (f.runtime as any).readOnlyRuntimeStatus = () => { reads++; throw Error(secret); };
    const baseHeaders = { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': 'get_status' };
    const cases: [any, Record<string,string>, number][] = [
      [{}, baseHeaders, -32602],
      [{ ...modernMeta, 'io.modelcontextprotocol/clientCapabilities': null }, baseHeaders, -32602],
      [{ ...modernMeta, 'io.modelcontextprotocol/clientCapabilities': secret }, baseHeaders, -32602],
      [{ ...modernMeta, 'io.modelcontextprotocol/clientInfo': { name: secret } }, baseHeaders, -32602],
      [modernMeta, { ...baseHeaders, 'mcp-protocol-version': '' }, -32020],
      [modernMeta, { ...baseHeaders, 'mcp-protocol-version': '2025-06-18' }, -32020],
      [modernMeta, { ...baseHeaders, 'mcp-method': secret }, -32020],
      [modernMeta, { ...baseHeaders, 'mcp-name': secret }, -32020],
      [{ ...modernMeta, 'io.modelcontextprotocol/protocolVersion': '2027-01-01' }, { ...baseHeaders, 'mcp-protocol-version': '2027-01-01' }, -32022],
    ];
    for (const [meta, headers, code] of cases) {
      const response = await f.request({ jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'get_status',_meta:meta} }, headers);
      const data = await response.json(); assert.equal(response.status, 400); assert.equal(data.id, 7); assert.equal(data.error.code, code);
      assert.ok(!JSON.stringify(data).includes(secret));
      if (code === -32022) assert.deepEqual(data.error.data, { supported:['2026-07-28','2025-06-18','2025-03-26'],requested:'2027-01-01' });
    }
    assert.equal(reads, 0); assert.equal(f.mutations(), 0);
    assert.equal((await f.rpc('server/discover')).error.code, -32601);
  } finally { await f.close(); }
});

test('native denials disclose only fixed classifications and bound diagnostic callbacks without weakening guards', async () => {
  const f = await fixture();
  try {
    const headers = { origin: secret, 'x-forwarded-for': secret, 'cf-access-jwt-assertion': secret, 'sec-fetch-site': secret };
    const expected = ['origin_present','proxy_header_present','cloudflare_header_present','fetch_site_denied'];
    for (let i=0;i<3;i++) {
      const response = await f.request({ jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_status'} }, headers);
      assert.equal(response.status, 403); assert.equal(response.headers.get('x-pi-console-mcp-denial'), expected.join(','));
      const data = await response.json(); assert.deepEqual(data.denialReasons, expected); assert.ok(!JSON.stringify(data).includes(secret));
    }
    assert.deepEqual(f.denials, [expected]); assert.equal(f.mutations(), 0);
    const status = await f.call('get_status'); assert.ok(status.result);
  } finally { await f.close(); }
});

test('default OFF and strict flag parsing', async () => {
  assert.equal(readOnlyMcpEnabled(undefined), false); assert.equal(readOnlyMcpEnabled('0'), false);
  assert.equal(readOnlyMcpEnabled('1'), true); assert.throws(() => readOnlyMcpEnabled('true'));
  const f = await fixture(false); try { assert.equal((await f.request({})).status, 404); } finally { await f.close(); }
});

test('MCP initialize, exactly three read-only tools, notifications, unsupported operations', async () => {
  const f = await fixture(); try {
    const init = await f.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.result.protocolVersion, '2025-06-18'); assert.deepEqual(init.result.capabilities, { tools: {} });
    assert.ok((await f.rpc('tools/list', { _meta: { progressToken: secret } })).result);
    assert.equal((await f.rpc('tools/list', { _meta: secret })).error.code, -32602);
    const list = await f.rpc('tools/list');
    assert.deepEqual(list.result.tools.map((v: any) => v.name), ['get_status', 'list_sessions', 'get_progress']);
    assert.ok(list.result.tools.every((v: any) => v.annotations.readOnlyHint && v.inputSchema.additionalProperties === false));
    const notification = await f.request({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(notification.status, 202); assert.equal(await notification.text(), '');
    assert.equal((await fetch(f.url)).status, 405);
    assert.equal((await f.rpc('resources/read', { uri: secret })).error.code, -32601);
    for (const name of ['prompt', 'stop', 'approve', 'shell', 'read_file', 'set_config']) assert.equal((await f.call(name)).error.code, -32602);
    assert.equal((await f.request({}, { 'mcp-protocol-version': 'wrong' })).status, 400);
    assert.equal((await f.request([{}])).status, 400);
    assert.equal((await f.request({ jsonrpc: '2.0', id: null, method: 'ping' })).status, 400);
    assert.equal((await f.request({ jsonrpc: '2.0', id: 1, method: 'ping', params: [] })).status, 400);
    assert.equal((await f.request({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'get_status' } })).status, 400);
    assert.equal((await f.request({ jsonrpc: '2.0', id: 1, method: 'ping' }, { accept: 'application/json' })).status, 406);
    assert.equal((await f.request({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await f.request({ jsonrpc: '2.0', id: 1, method: 'ping', params: secret.repeat(3000) })).status, 413);
  } finally { await f.close(); }
});

test('native loopback boundary rejects Origins, proxy headers, foreign Host and paths', async () => {
  const f = await fixture(); try {
    const denied: Record<string,string>[] = [{ origin: 'https://evil.example' }, { origin: 'http://127.0.0.1' },
      { 'x-forwarded-for': '127.0.0.1' }, { 'x-forwarded-host': '127.0.0.1' }, { 'cf-access-jwt-assertion': 'anything' },
      { forwarded: 'for=127.0.0.1' }, { 'sec-fetch-site': 'cross-site' }];
    for (const headers of denied) {
      assert.equal((await f.request({ jsonrpc: '2.0', id: 1, method: 'ping' }, headers)).status, 403, JSON.stringify(headers));
    }
    const foreignHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(f.url, { headers: { host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(foreignHost, 403);
    assert.equal((await fetch(f.url + '/extra')).status, 404);
    assert.equal((await fetch(f.url + '?path=' + secret)).status, 400);
  } finally { await f.close(); }
});

test('metadata absence is limited to enabled native GETs on two exact paths with no runtime effects', async () => {
  const paths=['/.well-known/oauth-protected-resource/mcp/readonly','/.well-known/oauth-protected-resource'];
  for(const enabled of [false,true]) {
    const f=await fixture(enabled,true,418);
    try {
      const before=await readFile(join(f.root,'workspaces.json'),'utf8'),seq=f.state.seq;
      const base=new URL(f.url).origin;
      for(const path of paths) {
        const url=base+path,response=await fetch(url);
        assert.equal(response.status,enabled?404:418);
        if(!enabled)continue;
        assert.deepEqual(await response.json(),{error:'not found'});
        assert.equal(response.headers.get('cache-control'),'no-store');
        const denied: Record<string,string>[]=[{origin:'http://127.0.0.1'},{'x-forwarded-for':'127.0.0.1'},
          {'cf-access-jwt-assertion':'test'},{forwarded:'for=127.0.0.1'},{'sec-fetch-site':'cross-site'}];
        for(const headers of denied) {
          assert.equal((await fetch(url,{headers})).status,403);
        }
        const wrongHost=await new Promise<number|undefined>((resolve,reject)=>{
          const req=httpRequest(url,{headers:{host:'foreign.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();
        });
        assert.equal(wrongHost,403);
        const post=await fetch(url,{method:'POST',body:'not executed'});assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET');
        assert.equal((await fetch(url+'?scope=all')).status,400);
        assert.equal((await fetch(url+'/extra')).status,418);
        assert.equal((await fetch(url+'/')).status,418);
      }
      for(const path of ['/.well-known/oauth-authorization-server','/.well-known/openid-configuration',
        '/.well-known/oauth-protected-resource/other'])assert.equal((await fetch(base+path)).status,418);
      assert.equal(f.mutations(),0);assert.equal(f.state.seq,seq);assert.equal(await readFile(join(f.root,'workspaces.json'),'utf8'),before);
    } finally {await f.close();}
  }
});

test('reads have no worker, queue, kit or persistence side effects; identifiers and content do not leak', async () => {
  const f = await fixture(); try {
    const before = await readFile(join(f.root, 'workspaces.json'), 'utf8'); const seq = f.state.seq;
    const status = (await f.call('get_status')).result.structuredContent;
    assert.equal(status.readOnly, true); assert.equal(status.workspaces.length, 2);
    assert.ok(!JSON.stringify(status).includes(f.root)); assert.ok(!JSON.stringify(status).includes(f.workspace.id));
    let selected: any;
    for (const workspace of status.workspaces) {
      const listing = (await f.call('list_sessions', { serverId: status.serverId, workspaceId: workspace.workspaceId })).result.structuredContent;
      if (listing.sessions.length) selected = { ...listing, workspaceId: workspace.workspaceId };
    }
    assert.equal(selected.sessions.length, 2);
    const observed = selected.sessions.find((v: any) => v.observation === 'observed');
    const target = { serverId: status.serverId, workspaceId: selected.workspaceId, sessionId: observed.sessionId, generation: observed.generation, runId: observed.runs[0].runId };
    const progress = (await f.call('get_progress', target)).result.structuredContent;
    assert.equal(progress.nodes.length, 2); assert.equal(progress.source, 'live');
    assert.ok(progress.nodes.every((v: any) => !('label' in v) && !('action' in v) && !('details' in v)));
    const closed = selected.sessions.find((v: any) => v.observation === 'unobserved');
    const unknown = (await f.call('get_progress', { ...target, sessionId: closed.sessionId, generation: null, runId: null })).result.structuredContent;
    assert.equal(unknown.source, 'none'); assert.equal(unknown.runtime, 'unknown'); assert.equal(unknown.summary, null);
    assert.equal(f.mutations(), 0); assert.equal(f.state.seq, seq);
    assert.equal(await readFile(join(f.root, 'workspaces.json'), 'utf8'), before);
    assert.deepEqual((await readdir(f.root)).sort(), ['other', 'sessions', 'workspaces.json']);
    (f.runtime as any).active.delete('observed'); (f.runtime as any).failed.set('observed', { session: f.state.session, state: f.state, worker: { state: 'failed' } });
    const disconnected = (await f.call('get_progress', target)).result.structuredContent;
    assert.equal(disconnected.observation, 'disconnected'); assert.equal(disconnected.source, 'cached');
    assert.equal(disconnected.currentStatus, 'unknown');
  } finally { await f.close(); }
});

test('target binding, stale generations, run ownership, strict arguments and pagination', async () => {
  const f = await fixture(); try {
    const status = (await f.call('get_status')).result.structuredContent;
    const lists = await Promise.all(status.workspaces.map((w: any) => f.call('list_sessions', { serverId: status.serverId, workspaceId: w.workspaceId })));
    const index = lists.findIndex(v => v.result.structuredContent.sessions.length);
    const sessions = lists[index].result.structuredContent.sessions;
    const s = sessions.find((v: any) => v.observation === 'observed');
    const target = { serverId: status.serverId, workspaceId: status.workspaces[index].workspaceId, sessionId: s.sessionId, generation: s.generation, runId: s.runs[0].runId };
    for (const bad of [{ ...target, serverId: '00000000-0000-0000-0000-000000000000' }, { ...target, workspaceId: status.workspaces[1-index].workspaceId },
      { ...target, generation: null }, { ...target, runId: null }, { ...target, runId: 'a'.repeat(64) }, { ...target, sessionId: 'b'.repeat(64) },
      { ...target, limit: 101 }, { ...target, offset: -1 }, { ...target, path: secret }, { ...target, generation: secret }, { ...target, limit: 1.5 },
      { ...target, limit: null }, { ...target, offset: null }]) {
      assert.equal((await f.call('get_progress', bad)).error.code, -32602);
    }
    const page = (await f.call('get_progress', { ...target, limit: 1 })).result.structuredContent;
    assert.equal(page.nodes.length, 1); assert.equal(page.nextOffset, 1);
    const otherMcp = createReadOnlyMcp(f.runtime, { enabled: true, scope: f.scope } as any); assert.notEqual(otherMcp.serverId, status.serverId);
    (f.runtime as any).active.delete('observed');
    assert.equal((await f.call('get_progress', target)).error.code, -32602);
  } finally { await f.close(); }
});

test('header bounds, workspace ownership, starting state, unknown enums and unrelated nodes', async () => {
  const f = await fixture(); try {
    await writeFile(join(f.root, 'sessions', 'foreign.jsonl'), JSON.stringify({ type: 'session', id: 'foreign', cwd: f.other.path }) + '\n');
    await writeFile(join(f.root, 'sessions', 'oversized.jsonl'), JSON.stringify({ type: 'session', id: 'oversized', cwd: f.root, name: secret.repeat(500) }) + '\n');
    await writeFile(join(f.root, 'sessions', 'malformed.jsonl'), 'not json\n');
    const raw = await f.runtime.readOnlySessions(f.workspace.id);
    assert.ok(!raw.sessions.some(v => ['foreign','oversized'].includes(v.id))); assert.equal(raw.truncated, true); assert.equal(raw.unavailable, true);
    const status = (await f.call('get_status')).result.structuredContent;
    let wid: string = '';
    for (const w of status.workspaces) {
      const list = (await f.call('list_sessions', { serverId: status.serverId, workspaceId: w.workspaceId })).result.structuredContent;
      if (list.sessions.some((s: any) => s.observation === 'observed')) wid = w.workspaceId;
    }
    (f.runtime as any).starting.set('observed', Promise.resolve());
    const starting = (await f.call('list_sessions', { serverId: status.serverId, workspaceId: wid })).result.structuredContent.sessions.find((s: any) => s.observation === 'starting');
    assert.equal(starting.generation, null); assert.deepEqual(starting.runs, []); assert.equal(f.mutations(), 0);
    (f.runtime as any).starting.delete('observed');
    f.state.publishNode({ id: 'unattached', kind: 'task', label: secret, status: 'completed', sourceKind: 'pi', correlation: 'unknown', updatedAt: new Date().toISOString() });
    f.state.publishNode({ id: 'malicious', kind: 'tool', label: secret, status: secret as any, sourceKind: secret as any,
      parentId: f.state.activeRunId, correlation: 'explicit', updatedAt: secret });
    const s = (await f.call('list_sessions', { serverId: status.serverId, workspaceId: wid })).result.structuredContent.sessions.find((v: any) => v.observation === 'observed');
    const progress = (await f.call('get_progress', { serverId: status.serverId, workspaceId: wid, sessionId: s.sessionId, generation: s.generation, runId: s.runs[0].runId })).result.structuredContent;
    assert.equal(progress.nodes.length, 3); assert.ok(progress.nodes.some((v: any) => v.status === 'unknown' && v.source === 'unknown' && v.updatedAt === null));
  } finally { await f.close(); }
});

test('session directory scan is bounded and reports truncation', async () => {
  const f = await fixture(); try {
    await Promise.all(Array.from({ length: 1030 }, (_, i) => writeFile(join(f.root, 'sessions', `${i}.jsonl`), JSON.stringify({ type: 'session', id: `s-${i}`, cwd: f.root }) + '\n')));
    const list = await f.runtime.readOnlySessions(f.workspace.id);
    assert.equal(list.truncated, true); assert.ok(list.sessions.length <= 1024); assert.equal(f.mutations(), 0);
  } finally { await f.close(); }
});

test('release HTTP entry excludes legacy MCP opt-ins; spoofed ready flags cannot bypass browser auth', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-readonly-http-'));
  try {
    await mkdir(join(root,'sessions'));
    const store = new WorkspaceStore(join(root,'workspaces.json')); const ws = await store.add(root);
    await writeFile(join(root,'readonly-mcp-scope.json'), JSON.stringify({ version: 1, workspaces: [{ id: ws.id, path: ws.path, sessionIds: ['closed'] }] }));
    await writeFile(join(root,'readonly-mcp.key'),dummyMcpKey,{mode:0o600});
    for (const mode of ['off', 'native', 'shared_secret']) {
      const enabled=mode!=='off',authenticated=mode==='shared_secret';
      const reserve = createServer(); await new Promise<void>(resolve => reserve.listen(0,'127.0.0.1',resolve));
      const port = (reserve.address() as { port: number }).port; await new Promise<void>(resolve => reserve.close(() => resolve()));
      const env: NodeJS.ProcessEnv = { SystemRoot: process.env.SystemRoot, TEMP: tmpdir(), TMP: tmpdir(), PORT: String(port),
        PI_CONSOLE_DATA_DIR: root, PI_CODING_AGENT_SESSION_DIR: join(root,'sessions'), PI_CONSOLE_KIT_ROOT: join(root,'no-kit'),
        PI_CONSOLE_EXTERNAL_MCP_READY:'1', PI_CONSOLE_ISOLATION_VERIFIED:'true',
        PI_CONSOLE_PUBLIC_ORIGIN: 'https://console.test', PI_CONSOLE_ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com', PI_CONSOLE_ACCESS_AUD: 'a'.repeat(32),
        ...(enabled ? { PI_CONSOLE_READONLY_MCP: '1' } : {}),
        ...(authenticated ? { PI_CONSOLE_READONLY_MCP_AUTH: 'shared_secret' } : {}) };
      const proc = spawn(process.execPath,['--import','tsx','server/index.ts'],{ cwd:process.cwd(),env,stdio:'pipe',windowsHide:true });
      let output = ''; proc.stdout.on('data',data => output += data.toString()); proc.stderr.on('data',data => output += data.toString());
      const closed = once(proc,'close');
      try {
        const until = Date.now()+10000;
        while (!output.includes('pi-console http:') && proc.exitCode === null && Date.now()<until) await new Promise(resolve => setTimeout(resolve,50));
        assert.ok(output.includes('pi-console http:'), 'isolated test server failed to start');
        const base = `http://127.0.0.1:${port}`;
        const authHeaders:Record<string,string>=authenticated?{[readOnlyMcpAuthHeader]:dummyMcpKey}:{};
        const requestHeaders:Record<string,string>={'content-type':'application/json',accept:'application/json, text/event-stream','x-pi-console-isolation-ready':'true',...authHeaders};
        if(authenticated)requestHeaders['x-forwarded-for']='192.0.2.1';
        const response = await fetch(base+'/mcp/readonly',{method:'POST',headers:requestHeaders,
          body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_status',arguments:{}}})});
        // Console-hosted MCP is excluded from this release, not advertised as
        // an installed adapter waiting for activation. Env/key/proxy hints do
        // not reopen it; normal browser authentication remains independent.
        assert.equal(response.status,404);
        assert.equal(await response.text(),'');
        for(const path of ['/mcp','/mcp/dots','/mcp/control','/.well-known/oauth-protected-resource/mcp/readonly','/.well-known/oauth-protected-resource']) {
          assert.equal((await fetch(base+path,{headers:authHeaders})).status,404);
          assert.equal((await fetch(base+path,{headers:{origin:base}})).status,404);
        }
        assert.equal((await fetch(base+'/api/workspaces',{headers:authHeaders})).status,403);
        const protectedStatus = await new Promise<number | undefined>((resolve,reject) => {
          const request = httpRequest(base+'/api/workspaces',{headers:{host:'console.test',...authHeaders}},res => {res.resume();resolve(res.statusCode)});
          request.on('error',reject); request.end();
        });
        assert.equal(protectedStatus,401);
        assert.ok(!output.includes(dummyMcpKey));
      } finally { proc.kill(); await closed; }
    }
  } finally { await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }
});

test('scope hides other workspaces and sessions, including runtime counts; registry drift fails closed', async () => {
  const f = await fixture(true, true); try {
    (f.runtime as any).kitRuns.set('observed', { workspaceId: f.workspace.id, running: true, request: secret });
    const status = (await f.call('get_status')).result.structuredContent;
    assert.equal(status.workspaces.length, 1);
    assert.equal(status.runtime.runningWorkers, 0); assert.equal(status.runtime.busyPiSessions, 0); assert.equal(status.runtime.runningOrchestrators, 0);
    const target = { serverId: status.serverId, workspaceId: status.workspaces[0].workspaceId };
    const list = (await f.call('list_sessions', target)).result.structuredContent;
    assert.equal(list.sessions.length, 1); assert.equal(list.sessions[0].observation, 'unobserved');
    assert.equal((await f.call('list_sessions', { ...target, workspaceId: f.other.id })).error.code, -32602);
    f.scope.workspaces[0].sessionIds.push('observed');
    assert.equal((await f.call('list_sessions', target)).result.structuredContent.sessions.length, 1, 'scope must not be mutable via the constructor object');
    f.workspace.path = f.other.path;
    assert.equal((await f.call('get_status')).error.code, -32602);
    assert.equal((await f.call('list_sessions', target)).error.code, -32602);
    assert.equal(f.mutations(), 0);
  } finally { await f.close(); }
});

test('scoped completeness is separate from global truncation and never substitutes another session', async () => {
  const f=await fixture(true,true);
  try {
    const original=f.runtime.readOnlySessions.bind(f.runtime);
    let includeApproved=true, scanUnavailable=false;
    f.runtime.readOnlySessions=async(wid,ids)=>{
      assert.deepEqual(ids,['closed']);
      const listing=await original(wid,ids);
      return {...listing,sessions:includeApproved?listing.sessions:[],truncated:true,unavailable:scanUnavailable};
    };
    const status=(await f.call('get_status')).result.structuredContent;
    const target={serverId:status.serverId,workspaceId:status.workspaces[0].workspaceId};
    const listing=(await f.call('list_sessions',target)).result.structuredContent;
    assert.equal(listing.scanTruncated,true);assert.equal(listing.scanUnavailable,false);
    assert.equal(listing.scopeComplete,true);assert.equal(listing.sessions.length,1);
    const exact={...target,sessionId:listing.sessions[0].sessionId,generation:null,runId:null};
    assert.equal((await f.call('get_progress',exact)).result.structuredContent.currentStatus,'unknown');
    scanUnavailable=true;
    const unreadable=(await f.call('list_sessions',target)).result.structuredContent;
    assert.equal(unreadable.scanUnavailable,true);assert.equal(unreadable.scopeComplete,false);assert.equal(unreadable.sessions.length,1);
    scanUnavailable=false;includeApproved=false;
    const missing=(await f.call('list_sessions',target)).result.structuredContent;
    assert.equal(missing.scanTruncated,true);assert.equal(missing.scopeComplete,false);assert.deepEqual(missing.sessions,[]);
    assert.equal((await f.call('get_progress',exact)).error.code,-32602);
    assert.equal(f.mutations(),0);
  }finally{await f.close()}
});

test('readonly runtime applies the exact session allowlist before its 1024-result cap', async () => {
  const f=await fixture();
  try {
    const active=(f.runtime as any).active;
    const selected=active.get('observed');active.clear();
    for(let i=0;i<1030;i++)active.set('unapproved-'+i,{...selected,session:{...selected.session,id:'unapproved-'+i}});
    active.set('observed',selected);
    const listing=await f.runtime.readOnlySessions(f.workspace.id,['observed']);
    assert.deepEqual(listing.sessions.map(s=>s.id),['observed']);
    assert.equal(listing.truncated,false);assert.equal(f.mutations(),0);
  }finally{await f.close()}
});

test('scoped completeness is computed before paging and remains false for a missing allowed ID', async () => {
  const f=await fixture();
  try {
    const status=(await f.call('get_status')).result.structuredContent;
    let target:any;
    for(const w of status.workspaces){
      const candidate={serverId:status.serverId,workspaceId:w.workspaceId};
      const listing=(await f.call('list_sessions',candidate)).result.structuredContent;
      if(listing.sessions.some((s:any)=>s.observation==='observed'))target=candidate;
      else assert.equal(listing.scopeComplete,false);
    }
    const first=(await f.call('list_sessions',{...target,limit:1})).result.structuredContent;
    assert.equal(first.scopeComplete,true);assert.equal(first.sessions.length,1);assert.equal(first.nextOffset,1);
    const second=(await f.call('list_sessions',{...target,limit:1,offset:1})).result.structuredContent;
    assert.equal(second.scopeComplete,true);assert.equal(second.sessions.length,1);assert.equal(second.nextOffset,null);
    assert.notEqual(first.sessions[0].sessionId,second.sessions[0].sessionId);assert.equal(f.mutations(),0);
  }finally{await f.close()}
});
