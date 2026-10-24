import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkspacePermissions} from '../server/workspace-permissions.ts';
import {ResultsReadService} from '../server/results-read.ts';
import type {ResultProjection,ResultTarget} from '../shared/results-read.ts';

test('artifact content release rechecks generation and expiry; cycles cannot confirm completion',async()=>{
  const root=await mkdtemp(join(tmpdir(),'results-races-dummy-'));try{
    const path=join(root,'workspace');await mkdir(path);await writeFile(join(path,'answer.txt'),'only dummy content');
    const permissions=new WorkspacePermissions(join(root,'permissions.json'));
    await permissions.replace(permissions.instance,0,[{id:'w',path,scope:'read',sessions:[{id:'s',generation:'g'}]}],async()=>[{id:'w',path,eligible:true,sessions:[{id:'s',generation:'g'}]}]);
    const t:ResultTarget={instance:permissions.instance,revision:1,workspaceId:'w',sessionId:'s',generation:'g',runId:'run'};
    const p:ResultProjection={generation:'g',seq:0,observedAt:100,live:true,truncated:false,historyState:'available',events:[],metadata:{sessionName:null,savedModel:null},coverage:{pi:'complete',subagents:'complete',orchestrator:'complete',queue:'complete',background:'complete'},nodes:[{id:'run',kind:'run',status:'completed',sourceKind:'pi',correlation:'explicit'}]};
    let calls=0,mutate=false,clock=100,expire=false;
    const service=new ResultsReadService(permissions,{workspaces:{get:()=>({id:'w',name:'Dummy',path})},readOnlyResultProjection:()=>{calls++;if(mutate&&calls%3===0)p.generation='changed';if(expire&&calls%3===0)clock=1000;return p;}},{enabled:true,now:()=>clock,grants:[{target:t,features:['artifacts','aggregate'],expiresAt:1000}]});
    const a=await service.registerArtifact(t,{relativePath:'answer.txt',name:'answer.txt',mime:'text/plain',kind:'generated'});
    calls=0;mutate=true;await assert.rejects(service.readArtifact(t,a.artifactId,a.version),/target_unavailable/);p.generation='g';mutate=false;
    calls=0;expire=true;await assert.rejects(service.readArtifact(t,a.artifactId,a.version),/content_scope_denied/);expire=false;clock=100;
    p.nodes[0].parentId='child';p.nodes.push({id:'child',parentId:'run',kind:'agent',status:'completed',sourceKind:'pi-subagents',correlation:'explicit'});
    assert.equal((await service.aggregate(t)).completionConfirmed,false);
  }finally{await rm(root,{recursive:true,force:true});}
});
