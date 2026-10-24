import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {WorkspaceStore} from '../server/runtime/workspaces.ts';
import {WorkspacePermissions} from '../server/workspace-permissions.ts';
import {createFinalOwnerComposition,type FinalOwnerConfig} from '../server/final-owner-composition.ts';
import {FinalAnswerEvidence} from '../package/final-answer-evidence.mjs';
import {dummyReadKey,sampleAnswer} from './final-answer.fixture.ts';
export async function ownerFixture(config:Partial<FinalOwnerConfig>={}){
  const root=await mkdtemp(join(tmpdir(),'final-owner-')),workspacePath=join(root,'workspace'),sessionsRoot=join(root,'sessions');await mkdir(workspacePath);await mkdir(sessionsRoot);
  const entry=process.env.FINAL_TEST_SDK_ENTRY;if(!entry)throw Error('EXPLICIT_SDK_REQUIRED');const pkg=JSON.parse(await readFile(join(dirname(dirname(entry)),'package.json'),'utf8'));if(pkg.version!=='1.0.2')throw Error('SDK_VERSION');
  const {SessionManager}=await import(pathToFileURL(entry).href),sdk=SessionManager.create(workspacePath,sessionsRoot);
  const workspaces=new WorkspaceStore(join(root,'workspaces.json')),w=await workspaces.add(workspacePath),permissions=new WorkspacePermissions(join(root,'permissions.json'));
  const paths={sessionsRoot,reportRecoveryDir:join(root,'reports'),queueDir:join(root,'queue'),journalDir:join(root,'journal')};
  const options:FinalOwnerConfig={enabled:true,accessMode:'local',authentication:{mode:'shared_secret',key:dummyReadKey},legacyCredentialKeys:['a1'.repeat(32),'b2'.repeat(32)],...config};
  const composition=createFinalOwnerComposition(workspaces,permissions,paths,options),runtime=composition.runtime;let mutations=0;
  const worker={state:'running',onRecord:(_r:any)=>{},onState:()=>{},call(){mutations++;throw Error('FORBIDDEN_WORKER_CALL');}};
  for(const name of ['open','resume','prompt','stop','options','startOrchestrator']) (runtime as any)[name]=()=>{mutations++;throw Error('FORBIDDEN_MUTATION');};
  const session={id:sdk.getSessionId(),workspaceId:w.id,filePath:sdk.getSessionFile(),name:'Dummy final owner'},state=(runtime as any).attach(worker,session).state;
  const populate=async(text=sampleAnswer,ack=true,settle=true)=>{
    const runId=state.preparePrompt('DUMMY_PROMPT_NOT_PUBLIC');const evidence=new FinalAnswerEvidence();evidence.start(runId,sdk);worker.onRecord({type:'agent_start'});if(ack)state.accepted(runId);sdk.appendMessage({role:'user',content:'DUMMY_PROMPT_NOT_PUBLIC',timestamp:1});
    const message={role:'assistant',content:[{type:'text',text}],api:'dummy-api',provider:'dummy-provider',model:'dummy-model',timestamp:2,stopReason:'stop',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};const event={type:'message_end',message};evidence.observe(event);worker.onRecord(event);sdk.appendMessage(message);
    if(settle){const proof=evidence.finish(sdk);if(proof)worker.onRecord(proof);worker.onRecord({type:'agent_settled'});}await state.flushFinalAnswers();return runId;
  };
  const runId=await populate();await permissions.replace(permissions.instance,0,[{id:w.id,path:w.path,scope:'read',sessions:[{id:session.id,generation:state.generation}]}],async()=>[{id:w.id,path:w.path,eligible:true,sessions:[{id:session.id,generation:state.generation}]}]);
  return {root,paths,options,workspaces,permissions,composition,runtime,worker,state,sdk,populate,runId,mutations:()=>mutations,cleanup:async()=>{composition.dispose();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}};
}
