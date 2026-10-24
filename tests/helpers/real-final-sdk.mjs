// Test-only public SDK services injection. Never selected by production discovery.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import dgram from 'node:dgram';
import {syncBuiltinESMExports} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.FINAL_AGENT_FIXTURE_ROOT;
assert(root && resolve(process.cwd()).startsWith(resolve(root)+ '\\'));
assert.equal(process.env.PI_OFFLINE,'1');
for(const k of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','PI_CODING_AGENT_DIR','PI_CODING_AGENT_SESSION_DIR'])assert(resolve(process.env[k]).startsWith(resolve(root)));
const trace={sdkVersion:'1.0.2',realAgentSession:false,requests:0,blockedNetwork:0,wrongModel:0,aborted:0,completed:0};
const flush=()=>fs.writeFileSync(join(root,'provider-trace.json'),JSON.stringify(trace));
const deny=()=>{trace.blockedNetwork++;flush();throw Error('FIXTURE_NETWORK_FORBIDDEN');};
globalThis.fetch=deny;net.Socket.prototype.connect=deny;net.connect=deny;net.createConnection=deny;http.request=deny;http.get=deny;https.request=deny;https.get=deny;tls.connect=deny;dgram.createSocket=deny;syncBuiltinESMExports();
const entry=process.env.FINAL_TEST_SDK_ENTRY;assert(entry);
assert.equal(JSON.parse(fs.readFileSync(join(dirname(dirname(entry)),'package.json'),'utf8')).version,'1.0.2');
const sdk=await import(pathToFileURL(entry).href);
const {createAssistantMessageEventStream}=await import(pathToFileURL(join(dirname(dirname(entry)),'node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js')).href);
const model={type:'chat',id:'fixed-local-final',name:'Fixed local final fixture',provider:'console-fixed-local',api:'console-fixed-local-api',baseUrl:'fixture:in-process',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1024};
const answer='REAL_AGENT_SESSION_FIXED_RESPONSE 日本語😀\nNo external model or credentials.\n';
function stream(m,context,options={}){
  if(m.provider!==model.provider||m.id!==model.id){trace.wrongModel++;flush();throw Error('FIXTURE_MODEL_FORBIDDEN');}
  assert(!options.apiKey);assert(!options.headers || Object.keys(options.headers).length===0);
  trace.requests++;const request=trace.requests;flush();
  const out=createAssistantMessageEventStream();
  void (async()=>{
    const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),content:[{type:'text',text:''}],stopReason:'pending',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
    try{
      out.push({type:'start',partial:message});out.push({type:'text_start',contentIndex:0,partial:message});
      message.content[0].text=request===1?answer:'INCOMPLETE_ABORTED_FIXTURE_ONLY';out.push({type:'text_delta',contentIndex:0,delta:message.content[0].text,partial:message});
      fs.writeFileSync(join(root,`provider-started-${request}`),'started');
      // Own bounded barrier: never substitutes AgentSession persistence/settled/ACK.
      const deadline=Date.now()+15000;
      while(!fs.existsSync(join(root,`provider-release-${request}`))){options.signal?.throwIfAborted();if(Date.now()>deadline)throw Error('FIXTURE_BARRIER_TIMEOUT');await new Promise(r=>setTimeout(r,20));}
      options.signal?.throwIfAborted();out.push({type:'text_end',contentIndex:0,content:message.content[0].text,partial:message});message.stopReason='stop';trace.completed++;flush();out.push({type:'done',reason:'stop',message});out.end();
    }catch(e){message.stopReason=options.signal?.aborted?'aborted':'error';message.errorMessage=options.signal?.aborted?'Fixture aborted':'Fixture failed';if(options.signal?.aborted)trace.aborted++;flush();out.push({type:'error',reason:message.stopReason,error:message});out.end();}
  })();return out;
}
export async function createAgentSessionServices(options){
  const runtime=await sdk.ModelRuntime.create({authPath:join(root,'agent/auth.json'),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
  runtime.registerNativeProvider({id:model.provider,name:'Fixed in-process (no authentication)',getModels:()=>[model],auth:{apiKey:{check:async()=>({type:'api_key',source:'keyless fixture'}),resolve:async()=>({auth:{},source:'keyless fixture'})}},stream,streamSimple:stream});
  const nativeStream=runtime.streamSimple.bind(runtime);
  runtime.streamSimple=(m,...args)=>{if(m.provider!==model.provider||m.id!==model.id){trace.wrongModel++;flush();throw Error('FIXTURE_FALLBACK_FORBIDDEN');}return nativeStream(m,...args);};
  const settingsManager=sdk.SettingsManager.inMemory({defaultProvider:model.provider,defaultModel:model.id,defaultThinkingLevel:'off',compaction:{enabled:false},retry:{enabled:false},cacheWarming:{enabled:false}});
  return sdk.createAgentSessionServices({...options,modelRuntime:runtime,settingsManager,resourceLoaderOptions:{...options.resourceLoaderOptions,noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,systemPrompt:'Fixed-response isolated SDK verification.',appendSystemPrompt:[]}});
}
export async function createAgentSessionFromServices(options){
  const created=await sdk.createAgentSessionFromServices({...options,model,thinkingLevel:'off',tools:[],noTools:'all'});
  assert(created.session instanceof sdk.AgentSession);assert.equal(created.session.model.provider,model.provider);assert.equal(created.session.model.id,model.id);assert.deepEqual(created.session.getActiveToolNames(),[]);trace.realAgentSession=true;flush();return created;
}
