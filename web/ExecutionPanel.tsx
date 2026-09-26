import React, { memo, useMemo, useState } from 'react';
import type { ExecutionNode, ExecutionStateSnapshot, ExecutionEvent } from '../shared/types.ts';
import { visibleExecutionRows } from './ui-logic.ts';
const line = (node:ExecutionNode) => [node.action,node.attempt&&node.attempt>1?`attempt ${node.attempt}`:undefined,node.model,node.provider,node.blockedReason].filter(Boolean).join(' · ');
const inspectable = (node:ExecutionNode) => {if(node.sourceKind!=='pi-subagents'||!node.id.startsWith('pi-subagent-async:'))return false;try{const path=JSON.parse(node.id.slice('pi-subagent-async:'.length));return Array.isArray(path)&&path.length>=1&&path.length<=2}catch{return false}};
type InspectReply = { status?: string; finalOutput?: string; task?: string; truncated?: { finalOutput?: boolean } };
function Panel({state,events,focusRootId,onInspect}:{state?:ExecutionStateSnapshot;events:ExecutionEvent[];focusRootId?:string;onInspect?: (nodeId:string)=>Promise<InspectReply>}) {
  const [view,setView]=useState<'tree'|'history'>('tree');
  const [open,setOpen]=useState<Set<string>>(new Set());const [collapsed,setCollapsed]=useState<Set<string>>(new Set());const [limit,setLimit]=useState(200);
  const [notice,setNotice]=useState('');
  const [inspection,setInspection]=useState<Record<string,{busy?:boolean;reply?:InspectReply;error?:string}>>({});
  const inspect=async(id:string)=>{if(!onInspect||inspection[id]?.busy)return;setInspection(old=>({...old,[id]:{busy:true}}));try{const reply=await onInspect(id);setInspection(old=>({...old,[id]:{reply}}))}catch(e){setInspection(old=>({...old,[id]:{error:(e as Error).message}}))}};
  const rows=useMemo(()=>visibleExecutionRows(state,open,collapsed),[state,open,collapsed]);
  const orderedRows=useMemo(()=>{
    if(!focusRootId||!state)return rows;
    const byId=new Map(state.nodes.map(n=>[n.id,n]));
    const belongs=(id:string)=>{let next=byId.get(id);const seen=new Set<string>();while(next&&!seen.has(next.id)){if(next.id===focusRootId)return true;seen.add(next.id);next=next.parentId?byId.get(next.parentId):undefined}return false};
    return [...rows.filter(r=>belongs(r.node.id)),...rows.filter(r=>!belongs(r.node.id))];
  },[rows,state,focusRootId]);
  const shown=useMemo(()=>events.slice(-limit),[events,limit]);
  const toggle=(id:string)=>setOpen(previous=>{const next=new Set(previous);next.has(id)?next.delete(id):next.add(id);return next});
  const toggleCollapsed=(id:string)=>setCollapsed(previous=>{const next=new Set(previous);next.has(id)?next.delete(id):next.add(id);return next});
  const copyContext=async(node:ExecutionNode)=>{try{await navigator.clipboard.writeText([node.label,node.status,node.blockedReason,node.details?.reason].filter(Boolean).join(' · '));setNotice('Context copied');}catch{setNotice('Copy failed')}};
  const running=state?.nodes.filter(n=>n.status==='running').length??0;
  const blocked=state?.nodes.filter(n=>n.status==='blocked').length??0;
  return <section className="execution" aria-label="Execution panel"><div className="row"><h2>Activity</h2><button className={view==='tree'?'selected':''} aria-label="Tree / Current State" onClick={()=>setView('tree')}>Now</button><button className={view==='history'?'selected':''} aria-label="History / Canonical Events" onClick={()=>setView('history')}>History</button></div>
    <div className="execution-summary" role="status">{running} running · {state?.failedCount??0} failed · {blocked} blocked · {state?.decisionCount??0} need input</div>{notice&&<span role="status">{notice}</span>}
    {view==='tree'?<div className="timeline" aria-label="Execution Timeline">{!orderedRows.length&&<p>Nothing running yet. Activity will appear here when Pi starts working.</p>}
      {orderedRows.slice(0,limit).map(({node,depth,unattached},index)=><article key={node.id} className="execution-node" data-status={node.status} style={{paddingLeft:`${Math.min(depth,5)*13+7}px`}}>
        {unattached&&(index===0||!orderedRows[index-1].unattached)&&<strong>Unattached · no verified parent</strong>}
        <div className="node-heading"><span>{node.label}</span><b>{node.status}</b></div>
        <div className="node-meta">{node.kind}{line(node)?` · ${line(node)}`:''}{node.startedAt&&node.status==='running'?` · ${Math.max(0,Math.floor((Date.now()-Date.parse(node.startedAt))/1000))}s`:''}</div>
        {node.status==='blocked'&&node.dependencies?.length?<div className="node-meta">Waiting for {node.dependencies.join(', ')}</div>:null}
        {node.attempts?.length&&node.status==='failed'?<div className="node-meta">{node.attempts.length} attempts · latest: {node.attempts.at(-1)?.failureClass??'reason unavailable'}</div>:null}
        {node.kind!=='tool'&&<button className="detail-toggle" aria-label="Show tool details / metadata" onClick={()=>toggle(node.id)} aria-expanded={open.has(node.id)}>{open.has(node.id)?'Hide details':'Details & tool history'} ↗</button>}
        {onInspect&&inspectable(node)&&<button className="detail-toggle" disabled={!!inspection[node.id]?.busy} onClick={()=>void inspect(node.id)}>{inspection[node.id]?.busy?'Loading result…':'Inspect background result'}</button>}
        {inspection[node.id]&&!inspection[node.id].busy&&<div className="node-details" role="status">{inspection[node.id].error?<span>{inspection[node.id].error}</span>:<><strong>Background result · {inspection[node.id].reply?.status??'unknown'}</strong>{inspection[node.id].reply?.finalOutput?<pre>{inspection[node.id].reply?.finalOutput}</pre>:<p>No final output is available yet. Try again after completion.</p>}{inspection[node.id].reply?.truncated?.finalOutput&&<small>Output truncated by pi-subagents.</small>}</>}</div>}
        {node.status==='completed'&&(node.kind==='agent'||node.kind==='task')&&<button className="detail-toggle" onClick={()=>toggleCollapsed(node.id)}>{collapsed.has(node.id)?'Show steps':'Hide steps'}</button>}
        {(node.status==='failed'||node.status==='blocked'||node.kind==='decision')&&<button className="detail-toggle" onClick={()=>void copyContext(node)}>Copy context</button>}
        {open.has(node.id)&&<div className="node-details"><div>Source: {node.sourceKind} · relation: {node.correlation}</div>{node.dependencies?.length?<div>Depends on: {node.dependencies.join(', ')}</div>:null}{node.attempts?.length?<div>Attempts: {node.attempts.map(a=>`${a.attempt} ${a.model??''} ${a.failureClass??''}`).join(' · ')}</div>:null}{node.nativeId&&<div>Native ID: {node.nativeId}</div>}{node.details&&<pre>{JSON.stringify(node.details,null,2)}</pre>}</div>}
      </article>)}{orderedRows.length>limit&&<button onClick={()=>setLimit(limit+200)}>Show next 200 ({orderedRows.length-limit} remaining)</button>}
    </div>:<div className="log" aria-label="Execution Event Log">{shown.map(e=><div key={e.eventId}>{new Date(e.timestamp).toLocaleTimeString()} · {e.type} · {e.sourceRef?.kind??e.source} · {e.status??''} · {String(e.payload.summary??e.payload.toolName??'')}</div>)}{events.length>limit&&<button onClick={()=>setLimit(limit+200)}>Show older events</button>}</div>}
  </section>;
}
export default memo(Panel);
