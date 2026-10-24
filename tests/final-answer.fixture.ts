import {mkdir,readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {WorkspaceStore} from '../server/runtime/workspaces.ts';
import {RuntimeManager} from '../server/runtime/manager.ts';
import {WorkspacePermissions} from '../server/workspace-permissions.ts';
import {ResultsReadService} from '../server/results-read.ts';
import {FinalAnswerEvidence} from '../package/final-answer-evidence.mjs';
import {createFinalAnswerMcp} from '../server/final-answer-mcp.ts';
import type {ResultTarget} from '../shared/results-read.ts';
export const dummyReadKey='d7'.repeat(32),dummySecret='DUMMY_FINAL_SECRET_0123456789';
export const sampleAnswer='隔離された最終回答です。実provider・実履歴は使用していません。\n保存済み回答をDots側のclientが直接取得します。';
export async function finalFixture(root:string,{text=sampleAnswer,ack=true,stopReason='stop',persist=true,settle=true}={}){
  const sdkEntry=process.env.FINAL_TEST_SDK_ENTRY;if(!sdkEntry)throw Error('EXPLICIT_EXISTING_SDK_REQUIRED');
  const sdkPackage=JSON.parse(await readFile(join(dirname(dirname(sdkEntry)),'package.json'),'utf8'));if(sdkPackage.name!=='@earendil-works/pi-coding-agent'||sdkPackage.version!=='1.0.2')throw Error('PINNED_SDK_VERSION_REQUIRED');
  const {SessionManager}=await import(pathToFileURL(sdkEntry).href);
  const workspacePath=join(root,'workspace'),sessions=join(root,'sessions');await mkdir(workspacePath);await mkdir(sessions);
  // Same public SDK persistence class used by sdk-worker. No AgentSession, model,
  // settings/credential store, extensions, provider, prompt or tool execution.
  const sdk=SessionManager.create(workspacePath,sessions);const sid=sdk.getSessionId();
  const workspaces=new WorkspaceStore(join(root,'workspaces.json')),workspace=await workspaces.add(workspacePath);
  const runtime=new RuntimeManager(workspaces,sessions,join(root,'reports'),join(root,'queue'),join(root,'final-answers'));
  let mutations=0;const worker={state:'running',onRecord:(_r:any)=>{},onState:()=>{},call(){mutations++;throw Error('FORBIDDEN_WORKER_CALL');}};
  for(const name of ['open','resume','prompt','stop','options','startOrchestrator']) (runtime as any)[name]=()=>{mutations++;throw Error('FORBIDDEN_MUTATION');};
  const session={id:sid,workspaceId:workspace.id,filePath:sdk.getSessionFile(),name:'Dummy final session'};
  const entry=(runtime as any).attach(worker,session);const state=entry.state;
  const runId=state.preparePrompt('dummy request');const evidence=new FinalAnswerEvidence();evidence.start(runId,sdk);
  worker.onRecord({type:'agent_start'});if(ack)state.accepted(runId);
  const user={role:'user',content:'dummy request',timestamp:1};sdk.appendMessage(user);
  const message={role:'assistant',content:[{type:'text',text}],api:'dummy-api',provider:'dummy-provider',model:'dummy-model',timestamp:2,stopReason,
    usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
  const response={type:'message_end',message};evidence.observe(response);worker.onRecord(response);
  if(persist)sdk.appendMessage(message);
  if(settle){const proof=evidence.finish(sdk);if(proof)worker.onRecord(proof);worker.onRecord({type:'agent_settled'});}
  await state.flushFinalAnswers();
  const permissions=new WorkspacePermissions(join(root,'permissions.json'));
  await permissions.replace(permissions.instance,0,[{id:workspace.id,path:workspace.path,scope:'read',sessions:[{id:sid,generation:state.generation}]}],async()=>[{id:workspace.id,path:workspace.path,eligible:true,sessions:[{id:sid,generation:state.generation}]}]);
  const target:ResultTarget={instance:permissions.instance,revision:1,workspaceId:workspace.id,sessionId:sid,generation:state.generation,runId};
  const service=new ResultsReadService(permissions,runtime,{enabled:true,grants:[{target,features:['final_answer'],expiresAt:Date.now()+60000}],knownSecrets:[dummySecret,dummyReadKey]});
  const adapter=createFinalAnswerMcp(service,{enabled:true,authentication:{mode:'shared_secret',key:dummyReadKey}});
  return {sdk,runtime,worker,state,evidence,permissions,target,service,adapter,mutations:()=>mutations};
}
