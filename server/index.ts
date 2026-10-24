import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDirectories, createDirectory } from './runtime/directories.ts';
import { openWorkspaceInExplorer } from './runtime/explorer.ts';
import { listPets, petFile } from './runtime/pets.ts';
import { createFinalOwnerComposition } from './final-owner-composition.ts';
import { orchestratorSettings, updateOrchestratorSettings } from './adapters/orchestrator/settings.ts';
import { SessionRecycling } from './runtime/session-recycling.ts';
import { startupStatus, setStartup } from '../package/startup-manager.mjs';
import { WorkspaceStore } from './runtime/workspaces.ts';
import { readWorkspaceText } from './runtime/workspace-text.ts';
import {openWorkspaceMedia,mediaRange} from './runtime/workspace-media.ts';
import { accessConfig, allowedHost, allowedPost, createAccessPrincipalVerifier, accessToken, type VerifiedAccessPrincipal } from './access.ts';
import { readJsonBody } from './body.ts';
import { PromptReceipts } from './runtime/prompt-receipts.ts';
import { createHmac, randomBytes } from 'node:crypto';
import { createReadOnlyMcp, readOnlyMcpEnabled } from './readonly-mcp.ts';
import { loadReadOnlyMcpScope } from './readonly-mcp-scope.ts';
import { loadReadOnlyMcpAuthentication } from './readonly-mcp-auth.ts';
import { WorkspacePermissions } from './workspace-permissions.ts';
import { createDotsPermissionsApi } from './dots-permissions-api.ts';
import {ExternalMcpGate} from './external-mcp-gate.ts';
import {createExternalMcpBoundary} from './external-mcp-boundary.ts';
import {createTrustedLocalMcp,denyPublicMcp,startTrustedLocalListener,trustedLocalConfigured,type TrustedLocalMcpConfig} from './trusted-local-mcp.ts';
import {createLocalMcpOwner} from './local-mcp-owner.ts';
import {createLocalOwnerBootstrap} from './local-owner-bootstrap.ts';
import {loadLocalFolderMcp} from './local-folder-composition.ts';
import {createSettingsMcp} from './settings-mcp.ts';
import {ownerFileStore} from './settings-owner.ts';
import {verifyManagedOwnerServer} from '../package/server-manager.mjs';
import {createWindowsOwnerDialog} from '../package/owner-gui-dialog.mjs';
import {createWindowsTunnelLauncher} from '../package/tunnel-key-dialog.mjs';
import {createLocalMcpInstallation} from './local-mcp-installation.mjs';
import {createManagedResumeOpen} from './managed-resume-open.ts';
import {createPiControlComposition} from './pi-control-composition.ts';
import {piControlHttp} from './pi-control-http.ts';

const dataDir = process.env.PI_CONSOLE_DATA_DIR ?? join(process.cwd(), '.pi-console');
const assetsDir = fileURLToPath(new URL('../dist/', import.meta.url));
const store = new WorkspaceStore(join(dataDir, 'workspaces.json'));
await store.load();
const access = accessConfig(process.env);
const workspacePermissions = new WorkspacePermissions(join(dataDir,'workspace-permissions.json'));
const mcpEnabled = readOnlyMcpEnabled(process.env.PI_CONSOLE_READONLY_MCP);
const mcpScope = mcpEnabled ? await loadReadOnlyMcpScope(join(dataDir,'readonly-mcp-scope.json')) : undefined;
const mcpAuthentication = mcpEnabled ? await loadReadOnlyMcpAuthentication(process.env, dataDir) : undefined;
const manageToken = process.env.PI_CONSOLE_MANAGEMENT_TOKEN;
const manageNonce = randomBytes(16).toString('hex');
const knownLegacyKeys:string[]=[mcpAuthentication?.key,process.env.PI_CONSOLE_CONTROL_MCP_KEY].filter((key):key is string=>typeof key==='string'&&/^[0-9a-f]{64}$/.test(key));
// Fixed installed descriptor defaults OFF; explicit reviewed binding enables only this management provider.
const {folders:localFolders,provider:localFolderProvider} = await loadLocalFolderMcp(store);
// Installed feature gate remains OFF. No profile migration or credential creation.
let reservedLocalProfileKeys:string[]=[],reservedLocalProfileAvailable=true;
const localResume=createLocalMcpInstallation({enabled:true,authorizedOS:true,dataDir,provider:localFolderProvider,reserved:()=>{if(!reservedLocalProfileAvailable)throw Error('credential_separation_unknown');return [...knownLegacyKeys,...reservedLocalProfileKeys]},readOwnerBinding:()=>{const v=settingsMcp.owners.localView();if(!v.available||v.recordState==='revoked')throw Error('registered_owner_unavailable');return v.recordState==='registered'?{owner:v.owner,requestId:v.recordRequestId}:'local-only'}});
const localOwnerBootstrap=createLocalOwnerBootstrap({consolePort:Number(process.env.PORT ?? 31717),folders:localFolders,settings:(req,res)=>settingsMcp.handleLocal(req,res),control:(req,res)=>controlHttp(req,res),enabled:!!manageToken,managementToken:manageToken,nonce:manageNonce,resume:localResume,profileFile:join(dataDir,'trusted-local-credentials.json'),legacyKeys:knownLegacyKeys,assetsRoot:assetsDir,delegate:async(req,res)=>await trustedLocal!.handleOwner(req,res)||await trustedLocal!.handleOwnerScope(req,res)||await finalOwner.owner(req,res)});
// Credential provisioning never enables MCP or grants a scope. Default remains OFF.
const trustedLocalConfig:TrustedLocalMcpConfig={enabled:false};
trustedLocalConfig.legacyCredentialKeys=knownLegacyKeys;
try{const profile=await localOwnerBootstrap.profile.read();if(profile)reservedLocalProfileKeys=[profile.credentials.read,profile.credentials.control,profile.credentials.final];if(profile&&profile.credentials.expiresAt>Date.now())trustedLocalConfig.credentials={...profile.credentials};}catch{reservedLocalProfileAvailable=false;console.warn('trusted_local_credentials_unavailable');}
trustedLocalConfig.owner={mode:'local-session',verify:localOwnerBootstrap.verify};
const accessPrincipals=new WeakMap<IncomingMessage,VerifiedAccessPrincipal>();
let trustedLocal:ReturnType<typeof createTrustedLocalMcp>|undefined;
let localListener:ReturnType<typeof createServer>|undefined;
const localOwner=createLocalMcpOwner(trustedLocalConfig.owner,()=>trustedLocal?.status().enabled===true);
// No credential generation/export. Explicit owner-provisioned profile is separate.
// Source opt-in composition is shared with isolated acceptance; deployment is separate approval.
const finalOwner = createFinalOwnerComposition(store,workspacePermissions,{reportRecoveryDir:join(dataDir,'report-recovery'),queueDir:join(dataDir,'queue'),journalDir:join(dataDir,'final-answers'),orchestratorHistoryDir:join(dataDir,'orchestrator-history')},{enabled:trustedLocalConfig.enabled===true&&trustedLocalConfigured(trustedLocalConfig),accessMode:access?'access':'local',authentication:trustedLocalConfig.credentials?{mode:'shared_secret',key:trustedLocalConfig.credentials.final}:undefined,legacyCredentialKeys:trustedLocalConfig.legacyCredentialKeys? [...trustedLocalConfig.legacyCredentialKeys,...(trustedLocalConfig.credentials?[trustedLocalConfig.credentials.read,trustedLocalConfig.credentials.control]:[])]:undefined,ownerRequest:localOwner.verify});
const runtime = finalOwner.runtime;
const promptReceipts = new PromptReceipts(join(dataDir, 'prompt-receipts'));
const recycling = new SessionRecycling(join(dataDir,'session-retention.json'),runtime);
await recycling.load();
const port = Number(process.env.PORT ?? 31717);
const tunnelLauncher=createWindowsTunnelLauncher();
const settingsMcp = await createSettingsMcp({resumeRevokeOwner:async(requestId,check)=>localResume.revokeOwner(requestId,check),store:ownerFileStore(join(dataDir,'settings-owner.json')),access,principal:req=>accessPrincipals.get(req),localVerify:localOwnerBootstrap.verify,localExpiry:localOwnerBootstrap.expiresAt,folders:localFolders,startBroker:()=>localOwnerBootstrap.startBroker(),broker:localOwnerBootstrap.status,consolePort:port,piControl:()=>piControl,ownerGui:{available:!!manageToken&&process.platform==='win32',generation:()=>({pid:process.pid,startedAt,port,generation:manageNonce}),verifyIdentity:expected=>verifyManagedOwnerServer({expected}),dialog:createWindowsOwnerDialog()},tunnel:{available:!!manageToken&&process.platform==='win32',generation:()=>({pid:process.pid,startedAt,port,generation:manageNonce}),verifyIdentity:expected=>verifyManagedOwnerServer({expected}),launch:tunnelLauncher,verifyConnection:tunnelLauncher.verifyConnection}});
const host = '127.0.0.1'; // Tunnel connects outbound to this loopback listener; never bind to 0.0.0.0.
const verifyAccess = access && createAccessPrincipalVerifier(access);
const packageVersion = JSON.parse(await fs.readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version;
const readOnlyMcp = createReadOnlyMcp(runtime, {
  enabled: mcpEnabled, scope: mcpScope, authentication: mcpAuthentication, version: packageVersion,
  onNativeDenial: reasons => console.warn(JSON.stringify({ event: 'readonly_mcp_native_denial', reasons })),
});
// New permission data is stable owner configuration, never an update snapshot.
const dotsPermissions = createDotsPermissionsApi(runtime,workspacePermissions,new PromptReceipts(join(dataDir,'dots-permission-receipts')), {
  authentication:mcpAuthentication, controlKey:process.env.PI_CONSOLE_CONTROL_MCP_KEY,
});
// No isolation dependency is installed/configured. Only trusted future bootstrap code may
// supply an adapter; no environment, header or persisted-ready override is accepted.
const externalMcpGate = new ExternalMcpGate({installationId:'unconfigured',instanceId:workspacePermissions.instance,policyGeneration:'unconfigured'});
runtime.setExternalAdmissionGuard(async()=>{const ticket=await externalMcpGate.admit();return()=>externalMcpGate.assert(ticket);});
const externalMcp = createExternalMcpBoundary(externalMcpGate,async(req,res)=>{
  const url=new URL(req.url??'/','http://localhost');
  if(finalOwner.claimsDots&&(url.pathname==='/mcp/dots'||url.pathname.startsWith('/.well-known/oauth-protected-resource'))&&await finalOwner.handle(req,res))return true;
  if(await readOnlyMcp.handle(req,res))return true;
  return url.pathname==='/mcp/dots'&&await dotsPermissions.handle(req,res);
});
trustedLocal=createTrustedLocalMcp(runtime,workspacePermissions,new PromptReceipts(join(dataDir,'dots-permission-receipts')),{grantFile:join(dataDir,'local-mcp-grants.json'),finalAdapter:finalOwner},trustedLocalConfig);
const dormantControl=()=>createTrustedLocalMcp(runtime,workspacePermissions,new PromptReceipts(join(dataDir,'dots-permission-receipts')),{grantFile:join(dataDir,'local-mcp-grants.json'),finalAdapter:finalOwner},trustedLocalConfig);
const piControl=createPiControlComposition({runtime,permissions:workspacePermissions,receipts:new PromptReceipts(join(dataDir,'dots-permission-receipts')),grantFile:join(dataDir,'local-mcp-grants.json'),owner:trustedLocalConfig.owner!,legacyKeys:[...knownLegacyKeys,...(trustedLocalConfig.credentials?[trustedLocalConfig.credentials.read,trustedLocalConfig.credentials.control,trustedLocalConfig.credentials.final]:[])],consolePort:port,current:()=>trustedLocal!,inactive:dormantControl,installed:app=>{trustedLocal?.dispose();trustedLocal=app}});
const controlHttp=piControlHttp(piControl,localOwnerBootstrap.verify);
// Optional loopback-only management channel: the detached manager (package/server-manager.mjs)
// proves process ownership through /api/manage/identity (pid + startedAt + a per-start nonce)
// and requests shutdown by answering a challenge with HMAC(nonce, manageToken) — the token is
// never sent on the wire, so a malicious listener that snoops identity cannot replay proof.
// Every manage request requires a literal 127.0.0.1 Host AND no proxy/tunnel headers: a
// Cloudflare-routed request can forge Host when remote mode pins it, so forwarded headers
// disqualify it outright.
const manageHost = (req: IncomingMessage) => /^127\.0\.0\.1(:\d+)?$/.test(String(req.headers.host ?? ''));
const manageUnproxied = (req: IncomingMessage) => !['cf-connecting-ip','cf-ray','x-forwarded-for','x-forwarded-host','x-forwarded-proto','forwarded','via'].some(name => req.headers[name]);
const manageProof = (req: IncomingMessage, challenge: unknown) =>
  typeof manageToken === 'string' && /^[0-9a-f]{48}$/.test(manageToken) && typeof challenge === 'string' && /^[0-9a-f]{32,64}$/.test(challenge) &&
  req.headers['x-pi-console-manage-proof'] === createHmac('sha256', manageToken).update(`pi-console-manage:${challenge}`).digest('hex');
const streams = new Set<ServerResponse>();
const respond = (res: ServerResponse, code: number, value: unknown) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
const managedResumeOpen=createManagedResumeOpen({enabled:()=>localResume.status().enabled,token:manageToken,identity:()=>({pid:process.pid,startedAt,nonce:manageNonce,port}),open:()=>localOwnerBootstrap.startBroker(),status:localOwnerBootstrap.status});

const server = createServer(async (req, res) => {
  try {
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; media-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const url = new URL(req.url ?? '/', 'http://localhost');
    // Public UI never serves MCP, regardless of Tunnel peer address or OS readiness.
    if (denyPublicMcp(req,res)) return;
    if (settingsMcp.discovery(req,res)) return;
    // Loopback management runs before the public Host/Access gates: remote mode rejects a
    // 127.0.0.1 Host for browser traffic, but the manager must still reach identity/shutdown.
    // Both routes additionally reject any request carrying proxy/tunnel headers, so a tunnel
    // cannot reach them even when the configured Host happens to be loopback.
    if (url.pathname.startsWith('/api/manage/')) {
      if (!manageHost(req) || !manageUnproxied(req)) return respond(res, 404, { error: 'not found' });
      if(await managedResumeOpen.handle(req,res))return;
      if(req.method==='POST'&&req.url==='/api/manage/local-owner/open'){const body=await readJsonBody(req,4096);await localOwnerBootstrap.issue(req,res,body);return;}
      if (req.method === 'GET' && url.pathname === '/api/manage/identity') {
        const challenge = req.headers['x-pi-console-manage-challenge'];
        const proof = typeof challenge === 'string' && /^[0-9a-f]{48}$/.test(challenge) && manageToken
          ? createHmac('sha256', manageToken).update(`pi-console-identity:${challenge}`).digest('hex') : undefined;
        const ownerProof = proof && createHmac('sha256', manageToken!).update('pi-console-owner-gui-identity:' + JSON.stringify([challenge, process.pid, startedAt, port, manageNonce])).digest('hex');
        const resumePort=localResume.status().enabled?localOwnerBootstrap.status().port:null;
        const resumeBroker=proof&&resumePort?{port:resumePort,signature:createHmac('sha256',manageToken!).update('pi-console-resume-broker:'+JSON.stringify([challenge,process.pid,startedAt,port,manageNonce,resumePort])).digest('hex')}:undefined;
        return respond(res, 200, { service: 'pi-console', version: packageVersion, pid: process.pid, startedAt, nonce: manageNonce, proof, ownerProof,resumeBroker });
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
    if (verifyAccess) {
      // accessToken rejects duplicated/combined assertion headers before verification.
      const principal = await verifyAccess(accessToken(req));
      if (!principal) return respond(res, 401, { error: 'Cloudflare Access authentication required' });
      accessPrincipals.set(req, principal);
    }
    if (req.method === 'POST') {
      if (!allowedPost(req,access)) return respond(res, 403, { error: 'cross-origin request' });
      if (!req.headers['content-type']?.startsWith('application/json')) return respond(res, 415, { error: 'JSON required' });
    }
    const wid = url.searchParams.get('workspaceId') ?? '';
    if (await settingsMcp.handlePublic(req,res)) return;
    const sid = url.searchParams.get('sessionId') ?? '';
    if (await externalMcp.owner(req,res)) return;
    if (await trustedLocal!.handleOwner(req,res)) return;
    if (await trustedLocal!.handleOwnerScope(req,res)) return;
    if (await finalOwner.handle(req,res)) return;
    if (await dotsPermissions.handle(req,res)) return;
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
    if (req.method === 'POST' && url.pathname === '/api/prompt') {
      const b = await readJsonBody(req, 12 * 1024 * 1024);
      const dispatch = () => runtime.prompt(b.workspaceId, b.sessionId, b.message, b.attachments ?? [], b.mode);
      const runId = b.requestId === undefined ? await dispatch() : await promptReceipts.execute(b.requestId, { workspaceId: b.workspaceId, sessionId: b.sessionId, message: b.message, attachments: b.attachments ?? [], mode: b.mode ?? null }, dispatch);
      return respond(res, 200, { runId });
    }
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
server.listen(port, host, () => {console.log(`pi-console http://${host}:${port}`);recycling.start();
  // A future reviewed bootstrap must supply credentials/owner and an explicit fixed port.
  // Do not create a listener or discover a secret when this source is default OFF.
  if(trustedLocalConfig.enabled===true)void startTrustedLocalListener(trustedLocal!,31719,port).then(s=>{localListener=s;}).catch(()=>{trustedLocal!.disable();console.warn('trusted_local_mcp_listener_refused');});
});
let closing = false;
async function shutdown() { if (closing) return; closing = true; managedResumeOpen.dispose();await settingsMcp.dispose();await piControl.dispose(); await localOwnerBootstrap.dispose();trustedLocal?.dispose();localOwner.dispose();localListener?.closeAllConnections();if(localListener?.listening)await new Promise<void>(r=>localListener!.close(()=>r()));externalMcpGate.dispose(); finalOwner.dispose(); readOnlyMcp.dispose(); dotsPermissions.dispose(); recycling.stop(); for (const stream of streams) stream.end(); server.close(); await runtime.shutdown(); server.closeAllConnections(); process.exitCode = 0; }
process.on('SIGINT', () => void shutdown()); process.on('SIGTERM', () => void shutdown());
