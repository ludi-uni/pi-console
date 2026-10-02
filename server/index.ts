import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDirectories, createDirectory } from './runtime/directories.ts';
import { openWorkspaceInExplorer } from './runtime/explorer.ts';
import { listPets, petFile } from './runtime/pets.ts';
import { RuntimeManager } from './runtime/manager.ts';
import { orchestratorSettings, updateOrchestratorSettings } from './adapters/orchestrator/settings.ts';
import { SessionRecycling } from './runtime/session-recycling.ts';
import { startupStatus, setStartup } from '../package/startup-manager.mjs';
import { WorkspaceStore } from './runtime/workspaces.ts';
import { readWorkspaceText } from './runtime/workspace-text.ts';
import {openWorkspaceMedia,mediaRange} from './runtime/workspace-media.ts';
import { accessConfig, allowedHost, allowedPost, createAccessVerifier } from './access.ts';
import { readJsonBody } from './body.ts';
import { createHmac, randomBytes } from 'node:crypto';

const dataDir = process.env.PI_CONSOLE_DATA_DIR ?? join(process.cwd(), '.pi-console');
const assetsDir = fileURLToPath(new URL('../dist/', import.meta.url));
const store = new WorkspaceStore(join(dataDir, 'workspaces.json'));
await store.load();
const runtime = new RuntimeManager(store, undefined, join(dataDir,'report-recovery'), join(dataDir,'queue'));
const recycling = new SessionRecycling(join(dataDir,'session-retention.json'),runtime);
await recycling.load();
const port = Number(process.env.PORT ?? 31717);
const host = '127.0.0.1'; // Tunnel connects outbound to this loopback listener; never bind to 0.0.0.0.
const access = accessConfig(process.env);
const verifyAccess = access && createAccessVerifier(access);
const packageVersion = JSON.parse(await fs.readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version;
// Optional loopback-only management channel: the detached manager (package/server-manager.mjs)
// proves process ownership through /api/manage/identity (pid + startedAt + a per-start nonce)
// and requests shutdown by answering a challenge with HMAC(nonce, manageToken) — the token is
// never sent on the wire, so a malicious listener that snoops identity cannot replay proof.
// Every manage request requires a literal 127.0.0.1 Host AND no proxy/tunnel headers: a
// Cloudflare-routed request can forge Host when remote mode pins it, so forwarded headers
// disqualify it outright.
const manageToken = process.env.PI_CONSOLE_MANAGEMENT_TOKEN;
const manageNonce = randomBytes(16).toString('hex');
const manageHost = (req: IncomingMessage) => /^127\.0\.0\.1(:\d+)?$/.test(String(req.headers.host ?? ''));
const manageUnproxied = (req: IncomingMessage) => !['cf-connecting-ip','cf-ray','x-forwarded-for','x-forwarded-host','x-forwarded-proto','forwarded','via'].some(name => req.headers[name]);
const manageProof = (req: IncomingMessage, challenge: unknown) =>
  typeof manageToken === 'string' && /^[0-9a-f]{48}$/.test(manageToken) && typeof challenge === 'string' && /^[0-9a-f]{32,64}$/.test(challenge) &&
  req.headers['x-pi-console-manage-proof'] === createHmac('sha256', manageToken).update(`pi-console-manage:${challenge}`).digest('hex');
const streams = new Set<ServerResponse>();
const respond = (res: ServerResponse, code: number, value: unknown) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };

const server = createServer(async (req, res) => {
  try {
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; media-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const url = new URL(req.url ?? '/', 'http://localhost');
    // Loopback management runs before the public Host/Access gates: remote mode rejects a
    // 127.0.0.1 Host for browser traffic, but the manager must still reach identity/shutdown.
    // Both routes additionally reject any request carrying proxy/tunnel headers, so a tunnel
    // cannot reach them even when the configured Host happens to be loopback.
    if (url.pathname.startsWith('/api/manage/')) {
      if (!manageHost(req) || !manageUnproxied(req)) return respond(res, 404, { error: 'not found' });
      if (req.method === 'GET' && url.pathname === '/api/manage/identity') {
        const challenge = req.headers['x-pi-console-manage-challenge'];
        const proof = typeof challenge === 'string' && /^[0-9a-f]{48}$/.test(challenge) && manageToken
          ? createHmac('sha256', manageToken).update(`pi-console-identity:${challenge}`).digest('hex') : undefined;
        return respond(res, 200, { service: 'pi-console', version: packageVersion, pid: process.pid, startedAt, nonce: manageNonce, proof });
      }
      if (req.method === 'POST' && url.pathname === '/api/manage/shutdown') {
        let body: unknown;
        try { body = await readJsonBody(req, 64 * 1024); } catch { return respond(res, 400, { error: 'invalid management request' }); }
        const challenge = (body as { challenge?: unknown })?.challenge;
        if (challenge !== manageNonce || !manageProof(req, challenge)) return respond(res, 401, { error: 'management proof required' });
        respond(res, 200, { ok: true }); void shutdown(); return;
      }
      return respond(res, 404, { error: 'not found' });
    }
    if (!allowedHost(req.headers.host, access)) return respond(res, 403, { error: 'invalid host' });
    if (!access && ['cf-connecting-ip','cf-ray','x-forwarded-host','forwarded'].some(name=>req.headers[name])) return respond(res,403,{error:'remote mode not configured'});
    if (verifyAccess && !await verifyAccess(req.headers['cf-access-jwt-assertion'] as string | undefined)) return respond(res, 401, { error: 'Cloudflare Access authentication required' });
    if (req.method === 'POST') {
      if (!allowedPost(req,access)) return respond(res, 403, { error: 'cross-origin request' });
      if (!req.headers['content-type']?.startsWith('application/json')) return respond(res, 415, { error: 'JSON required' });
    }
    const wid = url.searchParams.get('workspaceId') ?? '';
    const sid = url.searchParams.get('sessionId') ?? '';
    if (req.method === 'GET' && url.pathname === '/api/workspaces') return respond(res, 200, { workspaces: await store.listWithValidity() });
    if (req.method === 'GET' && url.pathname === '/api/workspace/text') return respond(res, 200, await readWorkspaceText(store, wid, url.searchParams.get('path') ?? ''));
    if (req.method === 'GET' && (url.pathname === '/api/workspace/media/info'||url.pathname === '/api/workspace/media')) {
      const media=await openWorkspaceMedia(store,wid,url.searchParams.get('path')??'');
      if(url.pathname.endsWith('/info')){try{return respond(res,200,{path:media.path,format:media.format,mime:media.mime,size:media.size})}finally{await media.handle.close()}}
      const range=mediaRange(typeof req.headers.range==='string'?req.headers.range:Array.isArray(req.headers.range)?'invalid':undefined,media.size);
      if(range.status===416){await media.handle.close();res.writeHead(416,{'content-range':`bytes */${media.size}`,'accept-ranges':'bytes','cache-control':'no-store'});res.end();return}
      res.writeHead(range.status,{'content-type':media.mime,'content-length':range.end-range.start+1,'accept-ranges':'bytes','cache-control':'private, no-store',...(range.status===206?{'content-range':`bytes ${range.start}-${range.end}/${media.size}`}:{})});
      const stream=media.handle.createReadStream({start:range.start,end:range.end,autoClose:false});
      res.once('close',()=>{stream.destroy();void media.handle.close()});
      stream.on('error',error=>res.destroy(error));stream.pipe(res);return;
    }
    if (req.method === 'GET' && url.pathname === '/api/activity') return respond(res, 200, { sessions: await runtime.activity() });
    if (req.method === 'GET' && url.pathname === '/api/startup') return respond(res,200,await startupStatus());
    if (req.method === 'POST' && url.pathname === '/api/startup') {const b=await readJsonBody(req);return respond(res,200,await setStartup(b.enabled))}
    if (req.method === 'GET' && url.pathname === '/api/session-retention') return respond(res,200,recycling.settings());
    if (req.method === 'POST' && url.pathname === '/api/session-retention') return respond(res,200,await recycling.update(await readJsonBody(req)));
    if (req.method === 'POST' && url.pathname === '/api/session/recycle') {const b=await readJsonBody(req);return respond(res,200,await recycling.recycle(b.workspaceId,b.sessionId))}
    if (req.method === 'POST' && url.pathname === '/api/workspaces/update') { const b=await readJsonBody(req);return respond(res,200,{workspace:await store.update(b.id,{name:b.name,pinned:b.pinned,open:b.open})}); }
    if (req.method === 'POST' && url.pathname === '/api/workspaces/remove') { const b=await readJsonBody(req);await runtime.removeWorkspace(b.id);return respond(res,200,{ok:true}); }
    if (req.method === 'POST' && url.pathname === '/api/workspaces/explorer') { const b=await readJsonBody(req);await openWorkspaceInExplorer(store,b.id);return respond(res,200,{ok:true}); }
    if (req.method === 'GET' && url.pathname === '/api/directories') return respond(res, 200, await listDirectories(url.searchParams.get('path') ?? undefined));
    if (req.method === 'POST' && url.pathname === '/api/directories/create') { const b = await readJsonBody(req); return respond(res, 200, await createDirectory(b.parent, b.name)); }
    if (req.method === 'GET' && url.pathname === '/api/pets') return respond(res,200,{pets:await listPets()});
    if (req.method === 'GET' && url.pathname === '/api/pet/file') {try{const {data,mime}=await petFile(url.searchParams.get('pet')??'',url.searchParams.get('file')??'',undefined,url.searchParams.get('source')??undefined);res.writeHead(200,{'content-type':mime,'cache-control':'private, max-age=300'});res.end(data);return;}catch{return respond(res,404,{error:'pet not found'});}}
    if (req.method === 'GET' && url.pathname === '/api/quick-prompts') return respond(res,200,{prompts:store.quickPrompts()});
    if (req.method === 'POST' && url.pathname === '/api/quick-prompts') { const b=await readJsonBody(req);return respond(res,200,{prompts:await store.savePrompts(b.prompts)}); }
    if (req.method === 'POST' && url.pathname === '/api/workspaces') { const b = await readJsonBody(req); return respond(res, 200, { workspace: await store.add(b.path) }); }
    if (req.method === 'GET' && url.pathname === '/api/sessions') return respond(res, 200, { sessions: await runtime.sessions(wid) });
    if (req.method === 'POST' && url.pathname === '/api/sessions') { const b = await readJsonBody(req); return respond(res, 200, { session: (await runtime.create(b.workspaceId)).session }); }
    if (req.method === 'POST' && url.pathname === '/api/resume') { const b = await readJsonBody(req); return respond(res, 200, { snapshot: await runtime.resume(b.workspaceId, b.sessionId) }); }
    if (req.method === 'GET' && url.pathname === '/api/session/options') return respond(res, 200, await runtime.options(wid, sid));
    if (req.method === 'POST' && url.pathname === '/api/session/model') { const b = await readJsonBody(req); return respond(res, 200, await runtime.setModel(b.workspaceId, b.sessionId, b.provider, b.modelId)); }
    if (req.method === 'POST' && url.pathname === '/api/session/thinking') { const b = await readJsonBody(req); return respond(res, 200, await runtime.setThinking(b.workspaceId, b.sessionId, b.level)); }
    if (req.method === 'GET' && url.pathname === '/api/orchestrator/settings') return respond(res, 200, await orchestratorSettings());
    if (req.method === 'POST' && url.pathname === '/api/orchestrator/settings') return respond(res, 200, await updateOrchestratorSettings(await readJsonBody(req)));
    if (req.method === 'GET' && url.pathname === '/api/orchestrator') return respond(res, 200, await runtime.kitStatus(wid, sid));
    if (req.method === 'GET' && url.pathname === '/api/orchestrator/decisions') return respond(res, 200, await runtime.kitDecisions(wid, sid));
    if (req.method === 'POST' && url.pathname === '/api/orchestrator/answer') { const b=await readJsonBody(req); return respond(res, 200, await runtime.answerOrchestrator(b.workspaceId,b.sessionId,b.runId,b.decisionId,b.answer)); }
    if (req.method === 'POST' && url.pathname === '/api/orchestrator/resume') { const b=await readJsonBody(req); return respond(res, 200, await runtime.retryOrchestrator(b.workspaceId,b.sessionId,b.runId)); }
    if (req.method === 'POST' && url.pathname === '/api/orchestrator/report/retry') { const b=await readJsonBody(req); return respond(res, 200, await runtime.retryKitReport(b.workspaceId,b.sessionId,b.runId)); }
    if (req.method === 'POST' && url.pathname === '/api/orchestrator/report/handled') { const b=await readJsonBody(req); return respond(res, 200, await runtime.markKitReportHandled(b.workspaceId,b.sessionId,b.runId,b.confirmed)); }
    if (req.method === 'POST' && url.pathname === '/api/subagents/inspect') { const b = await readJsonBody(req); return respond(res, 200, await runtime.inspectSubagent(b.workspaceId, b.sessionId, b.nodeId)); }
    if (req.method === 'POST' && url.pathname === '/api/orchestrator/start') { const b = await readJsonBody(req); return respond(res, 202, await runtime.startOrchestrator(b.workspaceId, b.sessionId, b.request)); }
    if (req.method === 'POST' && url.pathname === '/api/prompt') { const b = await readJsonBody(req, 12 * 1024 * 1024); return respond(res, 200, { runId: await runtime.prompt(b.workspaceId, b.sessionId, b.message, b.attachments ?? [], b.mode) }); }
    if (req.method === 'POST' && url.pathname === '/api/queue/edit') { const b = await readJsonBody(req, 256 * 1024); return respond(res, 200, { item: await runtime.editQueuedPrompt(b.workspaceId, b.sessionId, b.id, b.revision, b.text) }); }
    if (req.method === 'POST' && url.pathname === '/api/queue/remove') { const b = await readJsonBody(req); await runtime.removeQueuedPrompt(b.workspaceId, b.sessionId, b.id); return respond(res, 200, { ok: true }); }
    if (req.method === 'POST' && url.pathname === '/api/queue/resume') { const b = await readJsonBody(req); return respond(res, 200, { queue: await runtime.resumeQueuedPrompts(b.workspaceId, b.sessionId) }); }
    if (req.method === 'POST' && url.pathname === '/api/stop') { const b = await readJsonBody(req); await runtime.stop(b.workspaceId, b.sessionId); return respond(res, 200, { ok: true }); }
    if (req.method === 'POST' && url.pathname === '/api/close') { const b = await readJsonBody(req); await runtime.closeSession(b.workspaceId, b.sessionId); return respond(res, 200, { ok: true }); }
    if (req.method === 'GET' && url.pathname === '/api/state') return respond(res, 200, await runtime.snapshot(wid, sid));
    if (req.method === 'GET' && url.pathname === '/api/events') {
      const from = Number(url.searchParams.get('since') ?? 0);
      if (!Number.isSafeInteger(from) || from < 0) throw new Error('invalid cursor');
      const generation = url.searchParams.get('generation') ?? '';
      const replay: any[] = [];
      let live = false;
      // Subscribe first, then snapshot: events emitted in between land in `replay` instead
      // of silently skipping past the client's cursor.
      const { unsubscribe, snapshot } = await runtime.subscribedSnapshot(wid, sid, ev => { if (live && !res.destroyed) res.write(`id: ${ev.seq}\nevent: execution\ndata: ${JSON.stringify(ev)}\n\n`); else replay.push(ev); });
      if (generation && generation !== snapshot.generation) { unsubscribe(); return respond(res, 409, { error: 'event generation changed; reload snapshot' }); }
      if (snapshot.events.length && from < snapshot.events[0].seq - 1) { unsubscribe(); return respond(res, 409, { error: 'event gap; reload snapshot' }); }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' }); res.flushHeaders(); streams.add(res);
      for (const ev of snapshot.events) if (ev.seq > from) res.write(`id: ${ev.seq}\nevent: execution\ndata: ${JSON.stringify(ev)}\n\n`);
      live = true;
      for (const ev of replay) if (ev.seq > snapshot.seq) res.write(`id: ${ev.seq}\nevent: execution\ndata: ${JSON.stringify(ev)}\n\n`);
      const ping = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 15000);
      req.on('close', () => { clearInterval(ping); unsubscribe(); streams.delete(res); });
      return;
    }
    if (req.method !== 'GET') return respond(res, 404, { error: 'not found' });
    if (url.pathname === '/third-party-notices') { const notice = await fs.readFile(fileURLToPath(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url)));res.writeHead(200, {'content-type':'text/plain; charset=utf-8','cache-control':'no-cache'});res.end(notice);return; }
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!['index.html','manifest.webmanifest','sw.js','icon.svg','icon-maskable.svg','icon-192.png','icon-512.png'].includes(name) && !name.startsWith('assets/')) return respond(res, 404, { error: 'not found' });
    if (name.includes('..') || name.includes('\\')) return respond(res,404,{error:'not found'});
    const file = join(assetsDir, name);
    const content = await fs.readFile(file);
    res.writeHead(200, { 'content-type': ({'.html':'text/html','.js':'application/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'} as Record<string,string>)[extname(name)] ?? 'application/octet-stream', 'cache-control': name==='sw.js'||name==='index.html'?'no-cache':'public, max-age=3600' }); res.end(content);
  } catch (error) { const status = Number((error as Error & { status?: number }).status); respond(res, status === 404 || status === 409 ? status : 400, { error: (error as Error).message }); }
});
const startedAt = new Date().toISOString();
server.listen(port, host, () => {console.log(`pi-console http://${host}:${port}`);recycling.start()});
let closing = false;
async function shutdown() { if (closing) return; closing = true; recycling.stop(); for (const stream of streams) stream.end(); server.close(); await runtime.shutdown(); server.closeAllConnections(); process.exitCode = 0; }
process.on('SIGINT', () => void shutdown()); process.on('SIGTERM', () => void shutdown());
