import {PassThrough} from 'node:stream';
import type {IsolationAdapter,RestrictedAgentHandle,RestrictedAgentRequest} from '../../server/isolation-adapter.ts';
import type {IsolationBinding,IsolationInspection} from '../../shared/external-mcp.ts';
import {isolationChecks} from '../../shared/external-mcp.ts';
/** TEST ONLY. No OS inspection/setup/launch occurs. No production import of this module. */
export function isolationFixture(now=Date.now){
  let listener=()=>{};let result:((b:IsolationBinding)=>unknown)=b=>({supported:true,setup:{decision:'approved',receiptId:'dummy-setup-receipt',installationId:b.installationId,policyGeneration:b.policyGeneration,administratorApproved:true},verification:{outcome:'verified',binding:{...b},checkedAt:now(),expiresAt:now()+60000,checks:Object.fromEntries(isolationChecks.map(k=>[k,true])) as IsolationInspection['verification']['checks']}} satisfies IsolationInspection);
  let inspectCount=0,launchCount=0,stopCount=0;let pause:(()=>Promise<void>)|undefined;
  const adapter:IsolationAdapter={inspect:async b=>{inspectCount++;await pause?.();return result({...b});},onInvalidated:fn=>{listener=fn;return()=>{listener=()=>{};};},launch:async(r:RestrictedAgentRequest,authorize)=>{authorize();launchCount++;return {id:`dummy-${launchCount}`,binding:{...r.binding},stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),closed:Promise.resolve()} satisfies RestrictedAgentHandle;},stop:async()=>{stopCount++;}};
  return {adapter,setResult:(fn:typeof result)=>{result=fn;},pause:(fn:typeof pause)=>{pause=fn;},revoke:()=>listener(),counts:()=>({inspectCount,launchCount,stopCount}),valid:(b:IsolationBinding):IsolationInspection=>({supported:true,setup:{decision:'approved',receiptId:'dummy-setup-receipt',installationId:b.installationId,policyGeneration:b.policyGeneration,administratorApproved:true},verification:{outcome:'verified',binding:{...b},checkedAt:now(),expiresAt:now()+60000,checks:Object.fromEntries(isolationChecks.map(k=>[k,true])) as IsolationInspection['verification']['checks']}} satisfies IsolationInspection)};
}
