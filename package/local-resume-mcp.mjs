import{diagnosticContext,atStage,atStageSync,stageError,diagnosticCodec,diagnosticBackend,startupDiagnosticLine}from'../server/local-mcp-diagnostic.mjs';
import path from'node:path';import{createInterface}from'node:readline';import{pathToFileURL}from'node:url';
import{consoleDataDir}from'./data-directory.mjs';import{ensureManagedResumeBroker}from'./server-manager.mjs';import{createLocalFileBackend as createFileBackend}from'../server/local-mcp-file-backend.mjs';import{createWindowsProtection}from'../server/local-mcp-windows.mjs';import{createLocalClientState}from'./local-mcp-client-state.mjs';import{createResumeStdioSession}from'./local-resume-session.mjs';
import{createLocalEnrollmentState}from'./local-mcp-enrollment.mjs';import{unknownLocalClientInspection}from'./local-mcp-client-state.mjs';import{hash}from'../server/local-mcp-identity.mjs';
const createLocalFileBackend=options=>atStageSync('STORE_RESOLVE',()=>diagnosticBackend(createFileBackend(options)));
import{privateResumePost}from'./local-resume-transport.mjs';export{privateResumePost};
import{MCP_RELEASE_ENABLED}from'../shared/release-availability.mjs';
export async function runLocalResumeMcp(clientId){if(!/^[\w-]{1,100}$/.test(clientId??''))throw Error('invalid local-resume client id');const dataDir=atStageSync('STORE_RESOLVE',()=>consoleDataDir()),codec=atStageSync('STORE_RESOLVE',()=>diagnosticCodec(createWindowsProtection({authorized:true}))),serverStore=createLocalFileBackend({directory:path.join(dataDir,'local-mcp-resume')});let pinned,session;
 const verifyServer=async()=>{const v=await atStage('BROKER_VERIFY',()=>ensureManagedResumeBroker({directory:dataDir}));pinned=v;return v};
 try{let loaded,sid;const getSid=()=>sid??=codec.currentSid(),need=async required=>{if(loaded)return loaded;const owner=await serverStore.peekOwner();if(!owner){if(required)throw stageError('IDENTITY_CHECK',Error('owner_binding_unavailable'));return null}if(owner.sid!==await getSid())throw stageError('IDENTITY_CHECK',Error('owner_binding_unavailable'));return loaded=createLocalClientState({owner,codec,backend:createLocalFileBackend({directory:path.join(dataDir,'local-mcp-client-state'),createOnCommit:true})})};
  let enrollmentStore;const pendingStore=async()=>enrollmentStore??=createLocalEnrollmentState({owner:{sid:await getSid(),installationId:hash(path.resolve(dataDir).toLowerCase()),ownerId:'same-user-enrollment'},codec,backend:createLocalFileBackend({directory:path.join(dataDir,'local-mcp-enrollment'),createOnCommit:true})});
  const enrollment={inspect:async(...a)=>(await pendingStore()).inspect(...a),get:async(...a)=>(await pendingStore()).get(...a),begin:async(...a)=>(await pendingStore()).begin(...a),cancelling:async(...a)=>(await pendingStore()).cancelling(...a),close:async(...a)=>(await pendingStore()).close(...a),dispose:async()=>enrollmentStore?.dispose()};
  const state={inspect:async id=>(await need(false))?.inspect(id)??unknownLocalClientInspection(),get:async id=>(await need(false))?.get(id)??null,accept:async(...a)=>(await need(true)).accept(...a),beginRenewal:async(...a)=>(await need(true)).beginRenewal(...a),forget:async(...a)=>(await need(true)).forget(...a),dispose:async()=>loaded?.dispose()},post=(route,body,token)=>privateResumePost(pinned.origin,route,body,token);
  session=createResumeStdioSession({clientId,state,enrollment,verifyServer,transport:{request:b=>post('request',b),claim:b=>post('claim',b),resume:b=>post('resume',b),renew:b=>post('renew',b),cancel:b=>post('cancel-request',b),rpc:(token,name,args)=>post('rpc',{name,args},token)}});
  const input=createInterface({input:process.stdin,crlfDelay:Infinity});for await(const line of input){if(Buffer.byteLength(line)>8192){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32600,message:'request_limit'}})+'\n');continue}let m;try{m=JSON.parse(line)}catch{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'parse_error'}})+'\n');continue}const response=await session.message(m);if(response)process.stdout.write(JSON.stringify(response)+'\n')}
 }finally{await session?.dispose();await serverStore.close()}
}
// Shared failure path: the CLI subprocess and a direct `node local-resume-mcp.mjs`
// invocation both keep stdout clean and report only the sanitized stage on
// stderr — never raw error details.
const failLaunch=error=>{process.stderr.write('Local resume requires an explicitly enabled managed Console, verified owner broker, and prior owner approval.\n');process.stderr.write(startupDiagnosticLine(error));process.exitCode=1};
/** Runs the MCP stdio session inside one diagnostic context; the caller only
 * waits for the returned promise (exit code is set on failure). */
export const runLocalResumeMcpSession=clientId=>diagnosticContext(()=>runLocalResumeMcp(clientId).catch(failLaunch));
const invoked=()=>{if(!process.argv[1]||import.meta.url!==pathToFileURL(process.argv[1]).href)return{direct:false};const args=process.argv.slice(2);if(args.length===2&&(args[0]==='--local-resume'||args[0]==='local-resume'))return{direct:true,clientId:args[1]};return{direct:true,invalid:true}};
const direct=invoked();
// Gate the executable entry only: direct stdio invocation cannot reopen the
// release boundary, while the exported session runner stays usable in tests.
if(direct.direct){if(MCP_RELEASE_ENABLED!==true){process.stderr.write('local-resume is not available in this release.\n');process.exitCode=1}else if(direct.invalid||!/^[\w-]{1,100}$/.test(direct.clientId??'')){process.stderr.write('invalid local-resume arguments: expected --local-resume <client id>\n');process.exitCode=2}else void runLocalResumeMcpSession(direct.clientId)}
