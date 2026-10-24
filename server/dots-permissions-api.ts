import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PermissionInventory, PermissionReview } from '../shared/workspace-permissions.ts';
import type { RuntimeManager } from './runtime/manager.ts';
import { PromptReceipts } from './runtime/prompt-receipts.ts';
import { createReadOnlyMcpAuthentication, type ReadOnlyMcpAuthentication } from './readonly-mcp-auth.ts';
import { readOnlyMcpNativeDenialReasons } from './readonly-mcp.ts';
import { readJsonBody } from './body.ts';
import { pathKey } from './runtime/workspaces.ts';
import { canonicalPermissionPath, PermissionFault, strictPermissionObject, WorkspacePermissions } from './workspace-permissions.ts';
import {localControlExpectation} from './runtime/local-control-ticket.ts';

// Forward-ported localIntegrationRequest/integrationAdminRequest boundary only.
// No channel, keys, connection, Events, or identity-management API.
export function permissionOwnerRequest(req: IncomingMessage) {
  const host = `127.0.0.1:${req.socket.localPort}`;
  return ['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') && req.headers.host === host &&
    !Object.keys(req.headers).some(k => k === 'forwarded' || k === 'via' || k === 'x-real-ip' || k.startsWith('x-forwarded-') || k.startsWith('cf-')) &&
    req.method === 'POST' && req.headers.origin === `http://${host}` && req.headers['sec-fetch-site'] === 'same-origin' &&
    req.headers['x-pi-console-admin'] === '1' && req.headers['content-type'] === 'application/json' &&
    ['host','origin','sec-fetch-site','content-type','x-pi-console-admin'].every(name => req.rawHeaders.filter((v,i) => i % 2 === 0 && v.toLowerCase() === name).length === 1);
}
const keyValid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const requestIdValid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const fail = (code: string): never => { throw new PermissionFault(code); };
const targetKeys = ['instance','revision','workspaceId','sessionId','generation'];
const tools = [
  ['get_status', []], ['get_progress', targetKeys], ['submit_instruction', [...targetKeys,'requestId','message']],
  ['start_execution', [...targetKeys,'requestId']], ['cancel_instruction', [...targetKeys,'requestId']],
  ['stop_execution', [...targetKeys,'requestId','runId']], ['get_request', [...targetKeys,'requestId']],
] as const;
export interface TrustedLocalControlService {
  available:()=>boolean;
  admission:(target:unknown)=>Promise<()=>void>;
  owner:(req:IncomingMessage)=>boolean;
}
export function createDotsPermissionsApi(runtime: RuntimeManager, permissions: WorkspacePermissions, receipts: PromptReceipts, options: { authentication?: ReadOnlyMcpAuthentication; controlKey?: string; trustedLocal?:TrustedLocalControlService } = {}) {
  if (options.controlKey !== undefined && (!keyValid(options.controlKey) || options.controlKey === options.authentication?.key)) fail('invalid_control_authentication');
  const auth = createReadOnlyMcpAuthentication(options.authentication);
  const controlKey = options.controlKey ? Buffer.from(options.controlKey, 'hex') : undefined;
  let disposed = false;
  const controlAvailable = () => !!controlKey && (options.trustedLocal?options.trustedLocal.available():runtime.controlIsolationVerified());
  const grants = new Map<string, { revision: number; expires: number }>();
  const staged = new Map<string, { binding: string; action: 'instruction' | 'stop'; message: string; state: 'staged' | 'cancelled' | 'accepted' | 'uncertain'; runId?: string }>();
  const uncertain = new Set<string>();
  const inventory = async (): Promise<PermissionInventory[]> => {
    const registered = runtime.workspaces.list();
    const paths = await Promise.all(registered.map(w => canonicalPermissionPath(w.path).catch(() => null)));
    return Promise.all(registered.slice(0,100).map(async (w, index) => {
      const actual = paths[index];
      const unique = actual && paths.filter(p => p && pathKey(p) === pathKey(actual)).length === 1 && registered.filter(r => r.id === w.id).length === 1;
      const listing = unique ? await runtime.readOnlySessions(w.id) : null;
      const counts = new Map<string, number>();
      for (const s of listing?.sessions ?? []) counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
      const sessions = !listing || listing.unavailable || listing.truncated ? [] : listing.sessions.flatMap(s => {
        const observed = runtime.readOnlyObservation(w.id,s.id);
        return counts.get(s.id) === 1 && !listing.ambiguousSessionIds.includes(s.id) && observed?.observation === 'observed' && observed.generation && !observed.truncated ? [{id:s.id,generation:observed.generation}] : [];
      }).slice(0,64);
      return {id:w.id,path:actual ?? w.path,eligible:!!unique && sessions.length > 0,sessions};
    }));
  };
  const review = async (): Promise<PermissionReview> => {
    const snapshot = await permissions.snapshot();
    const candidates = await inventory();
    for (const [key, g] of grants) if (g.expires <= Date.now() || g.revision !== snapshot.revision) grants.delete(key);
    if (grants.size >= 16) grants.delete(grants.keys().next().value!);
    const grant = randomUUID(); grants.set(grant, {revision:snapshot.revision,expires:Date.now()+15*60*1000});
    return {instance:permissions.instance,snapshot,inventory:candidates,grant,controlAvailable:controlAvailable()};
  };
  const controlAuthenticated = (req: IncomingMessage) => {
    const value = req.headers['x-pi-console-control-key'];
    const candidate = keyValid(value) ? Buffer.from(value,'hex') : Buffer.alloc(32);
    const match = timingSafeEqual(controlKey ?? Buffer.alloc(32),candidate); candidate.fill(0);
    return !disposed && !!controlKey && keyValid(value) && match && req.rawHeaders.filter((v,i) => i%2===0 && v.toLowerCase()==='x-pi-console-control-key').length===1;
  };
  const readAuthenticated = (req: IncomingMessage) => !disposed && (controlAuthenticated(req) || (auth.required || auth.supplied(req) ? auth.verify(req) : true));
  const call = async (name: string, args: unknown) => {
    const schema = tools.find(t => t[0] === name); if (!schema) return fail('invalid_arguments');
    strictPermissionObject(args, [...schema[1]]);
    if (name === 'get_status') {
      const snapshot = await permissions.snapshot(), candidates = await inventory();
      return {instance:permissions.instance,revision:snapshot.revision,controlAvailable:controlAvailable(),
        workspaces:snapshot.workspaces.flatMap(w => {
          const candidate=candidates.find(c=>c.id===w.id&&c.eligible&&pathKey(c.path)===pathKey(w.path));
          if(!candidate)return [];
          return [{workspaceId:w.id,scope:w.scope,sessions:w.sessions.filter(s=>candidate.sessions.some(c=>s.id===c.id&&s.generation===c.generation)).map(s=>({sessionId:s.id,generation:s.generation}))}];
        })};
    }
    if (typeof args.workspaceId !== 'string' || typeof args.sessionId !== 'string' || typeof args.generation !== 'string') return fail('invalid_arguments');
    if (name !== 'get_progress' && !requestIdValid(args.requestId)) return fail('invalid_arguments');
    const assertLocal=options.trustedLocal&&name!=='get_progress'?await options.trustedLocal.admission(args):undefined;
    assertLocal?.();
    return permissions.admit(args.instance,args.revision,args as any,name==='get_progress'?'read':'control',async w => {
      const candidate=(await inventory()).find(c=>c.id===w.id&&c.eligible&&pathKey(c.path)===pathKey(w.path));
      if(!candidate?.sessions.some(s=>s.id===args.sessionId&&s.generation===args.generation)) fail('target_unavailable');
    }, async w => {
      const observation=runtime.readOnlyObservation(w.id,args.sessionId);
      if(observation?.observation!=='observed'||observation.generation!==args.generation||observation.truncated) return fail('target_unavailable');
      if(name==='get_progress') return {generation:observation.generation,seq:observation.seq,runtime:observation.runtime,nodes:observation.nodes};
      const binding=JSON.stringify({instance:permissions.instance,revision:args.revision,workspaceId:w.id,path:w.path,sessionId:args.sessionId,generation:args.generation});
      const sessionKey=JSON.stringify([w.id,args.sessionId]);
      assertLocal?.();
      const expected=assertLocal?localControlExpectation({generation:args.generation,requestId:args.requestId},assertLocal):{generation:args.generation,requestId:args.requestId};
      if(name==='submit_instruction') {
        if(typeof args.message!=='string'||!args.message.trim()||args.message.length>20000||args.message.trimStart().startsWith('/')||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(args.message)) return fail('invalid_arguments');
        const old=staged.get(args.requestId);
        if(old&&(old.action!=='instruction'||old.binding!==binding||old.message!==args.message))return fail('request_conflict');
        if(!old) {if(staged.size>=1024)return fail('request_capacity');staged.set(args.requestId,{binding,action:'instruction',message:args.message,state:'staged'});}
        return {requestId:args.requestId,state:staged.get(args.requestId)!.state};
      }
      const item=staged.get(args.requestId);
      if(name==='get_request'||name==='cancel_instruction'||name==='start_execution') {
        // Hash-only durable receipts cannot prove this target's binding without
        // the original instruction. Never infer a run from a caller's UUID,
        // resurrect staging, or treat missing state as permission to resend.
        // Current local authority/scope/generation admission has already passed.
        if(name==='get_request'&&options.trustedLocal&&(!item||item.binding!==binding))return {requestId:args.requestId,state:'unknown',runId:null,reason:'request_binding_unavailable',retryAllowed:false};
        if(!item||item.binding!==binding)return fail('binding_changed');
        if(name==='get_request')return {requestId:args.requestId,state:item.state,runId:item.runId??null};
        if(item.action!=='instruction')return fail('not_startable');
        if(name==='cancel_instruction') {if(item.state!=='staged')return fail('not_cancellable');item.state='cancelled';return {state:item.state};}
        if(item.state==='cancelled')return fail('not_startable');
      }
      if(uncertain.has(sessionKey))return fail('delivery_unconfirmed');
      if(name==='start_execution') {
        try {
          const runId=await receipts.execute(args.requestId,{binding,action:'start',message:item!.message},async()=>{await runtime.controlAdmission(w.id,args.sessionId,expected);assertLocal?.();return runtime.prompt(w.id,args.sessionId,item!.message,[],undefined,expected);});
          assertLocal?.();
          item!.state='accepted'; item!.runId=runId;return {state:'accepted',runId};
        } catch {item!.state='uncertain';uncertain.add(sessionKey);return fail('delivery_unconfirmed');}
      }
      if(name==='stop_execution') {
        if(item&&(item.action!=='stop'||item.binding!==binding||item.runId!==args.runId))return fail('request_conflict');
        if(!item&&staged.size>=1024)return fail('request_capacity');
        const receipt=item??{binding,action:'stop' as const,message:'',state:'uncertain' as const,runId:args.runId};
        staged.set(args.requestId,receipt);
        try {
          await receipts.execute(args.requestId,{binding,action:'stop',runId:args.runId},async()=>{
            const state=runtime.controlState(w.id,args.sessionId),node=observation.nodes.find(n=>n.id===args.runId);
            if(state.generation!==args.generation||state.activeRunId!==args.runId||!node||node.kind!=='run'||node.sourceKind!=='pi')return fail('run_not_active');
            assertLocal?.();const stopExpected=assertLocal?localControlExpectation({...expected,runId:args.runId},assertLocal):{...expected,runId:args.runId};
            await runtime.stop(w.id,args.sessionId,stopExpected);return args.runId;
          });
          assertLocal?.();
          receipt.state='accepted';return {state:'accepted',stopRequested:true};
        } catch {receipt.state='uncertain';uncertain.add(sessionKey);return fail('delivery_unconfirmed');}
      }
      return fail('invalid_arguments');
    });
  };
  const handle = async (req: IncomingMessage,res: ServerResponse) => {
    const url=new URL(req.url??'/','http://127.0.0.1');
    const owner=url.pathname.startsWith('/api/workspace-permissions/');
    if(!owner&&url.pathname!=='/mcp/dots')return false;
    const send=(status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
    let id: string | number | null = null;
    try {
      if(disposed||url.search)return fail('invalid_arguments');
      if(owner) {
        if(!(options.trustedLocal?options.trustedLocal.owner(req):permissionOwnerRequest(req))) {send(403,{error:'local_owner_required'});return true;}
        const body=await readJsonBody(req,128*1024);
        if(url.pathname==='/api/workspace-permissions/session') {strictPermissionObject(body,[]);send(200,await review());return true;}
        if(url.pathname!=='/api/workspace-permissions/save') {send(404,{error:'not_found'});return true;}
        strictPermissionObject(body,['instance','revision','workspaces','confirmed']);
        const grant=typeof req.headers['x-pi-console-permission-grant']==='string'?grants.get(req.headers['x-pi-console-permission-grant']):undefined;
        if(!grant||grant.expires<=Date.now()||grant.revision!==body.revision||body.confirmed!==true||req.rawHeaders.filter((v,i)=>i%2===0&&v.toLowerCase()==='x-pi-console-permission-grant').length!==1)return fail('owner_confirmation_required');
        grants.clear();
        await permissions.replace(body.instance,body.revision,body.workspaces,inventory);
        send(200,await review());return true;
      }
      if(readOnlyMcpNativeDenialReasons(req).length) {send(403,{error:'native_boundary_rejected'});return true;}
      if(!readAuthenticated(req)) {send(401,{error:'authentication_required'});return true;}
      if(req.method!=='POST'||req.headers['content-type']!=='application/json') {send(405,{error:'JSON_POST_required'});return true;}
      const body=await readJsonBody(req,128*1024);
      strictPermissionObject(body,['jsonrpc','id','method','params']);
      if(body.jsonrpc!=='2.0'||!(typeof body.id==='string'&&body.id.length<=128||typeof body.id==='number'&&Number.isSafeInteger(body.id)))return fail('invalid_arguments');
      id=body.id;
      let result:unknown;
      if(body.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'pi-console-dots',version:'1'}};
      else if(body.method==='tools/list') {strictPermissionObject(body.params,[]);result={tools:tools.map(([name,keys])=>({name,inputSchema:{type:'object',properties:Object.fromEntries(keys.map(k=>[k,k==='revision'?{type:'integer',minimum:0}:{type:'string'}])),required:keys,additionalProperties:false},annotations:{readOnlyHint:['get_status','get_progress','get_request'].includes(name),openWorldHint:false}}))};}
      else if(body.method==='tools/call') {
        strictPermissionObject(body.params,['name','arguments']);
        if(!['get_status','get_progress'].includes(body.params.name)&&!controlAuthenticated(req)) {send(403,{error:'dedicated_control_authentication_required'});return true;}
        if(!['get_status','get_progress'].includes(body.params.name)&&!controlAvailable())return fail('worker_isolation_unverified');
        const data=await call(body.params.name,body.params.arguments);
        result={content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};
      } else return fail('method_not_supported');
      send(200,{jsonrpc:'2.0',id,result});
    } catch(e) {
      const code=e instanceof PermissionFault?e.code:'request_unavailable';
      send(409,owner?{error:code}:{jsonrpc:'2.0',id,error:{code:-32602,message:code}});
    }
    return true;
  };
  return {handle,inventory,call,dispose(){disposed=true;auth.dispose();controlKey?.fill(0);grants.clear();staged.clear();}};
}
