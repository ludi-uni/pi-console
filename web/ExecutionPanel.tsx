import React, { memo, useMemo, useState } from 'react';
import type { ExecutionNode, ExecutionStateSnapshot, ExecutionEvent } from '../shared/types.ts';
const line = (node:ExecutionNode) => [node.action,node.attempt&&node.attempt>1?`attempt ${node.attempt}`:undefined,node.model,node.provider,node.blockedReason].filter(Boolean).join(' · ');
function Panel({state,events}:{state?:ExecutionStateSnapshot;events:ExecutionEvent[]}) {
  const [view,setView]=useState<'tree'|'history'>('tree');
  const [open,setOpen]=useState<Set<string>>(new Set());const [collapsed,setCollapsed]=useState<Set<string>>(new Set());const [limit,setLimit]=useState(200);
  const [notice,setNotice]=useState('');
  const rows=useMemo(()=>{
    const visible:ExecutionStateSnapshot['rows']=[],ancestors:string[]=[];
    for(const row of state?.rows??[]){
      ancestors.length=row.depth;
      if(ancestors.some(id=>collapsed.has(id)))continue;
      if(row.node.kind==='tool'&&row.node.status!=='running'&&!open.has(row.node.parentId??'')){ancestors[row.depth]=row.node.id;continue;}
      visible.push(row);ancestors[row.depth]=row.node.id;
    }
    return visible;
  },[state,open,collapsed]);
  const shown=useMemo(()=>events.slice(-limit),[events,limit]);
  const toggle=(id:string)=>setOpen(previous=>{const next=new Set(previous);next.has(id)?next.delete(id):next.add(id);return next});
  const toggleCollapsed=(id:string)=>setCollapsed(previous=>{const next=new Set(previous);next.has(id)?next.delete(id):next.add(id);return next});
  const copyContext=async(node:ExecutionNode)=>{try{await navigator.clipboard.writeText([node.label,node.status,node.blockedReason,node.details?.reason].filter(Boolean).join(' · '));setNotice('Context copied');}catch{setNotice('Copy failed')}};
  const running=state?.nodes.filter(n=>n.status==='running').length??0;
  const blocked=state?.nodes.filter(n=>n.status==='blocked').length??0;
  return <section className="execution" aria-label="Execution panel"><div className="row"><h2>Activity</h2><button className={view==='tree'?'selected':''} aria-label="Tree / Current State" onClick={()=>setView('tree')}>Now</button><button className={view==='history'?'selected':''} aria-label="History / Canonical Events" onClick={()=>setView('history')}>History</button></div>
    <div className="execution-summary" role="status">{running} running · {state?.failedCount??0} failed · {blocked} blocked · {state?.decisionCount??0} need input</div>{notice&&<span role="status">{notice}</span>}
    {view==='tree'?<div className="timeline" aria-label="Execution Timeline">{!rows.length&&<p>Nothing running yet. Activity will appear here when Pi starts working.</p>}
      {rows.slice(0,limit).map(({node,depth,unattached},index)=><article key={node.id} className="execution-node" data-status={node.status} style={{paddingLeft:`${Math.min(depth,5)*13+7}px`}}>
        {unattached&&(index===0||!rows[index-1].unattached)&&<strong>Unattached · no verified parent</strong>}
        <div className="node-heading"><span>{node.label}</span><b>{node.status}</b></div>
        <div className="node-meta">{node.kind}{line(node)?` · ${line(node)}`:''}{node.startedAt&&node.status==='running'?` · ${Math.max(0,Math.floor((Date.now()-Date.parse(node.startedAt))/1000))}s`:''}</div>
        {node.status==='blocked'&&node.dependencies?.length?<div className="node-meta">Waiting for {node.dependencies.join(', ')}</div>:null}
        {node.attempts?.length&&node.status==='failed'?<div className="node-meta">{node.attempts.length} attempts · latest: {node.attempts.at(-1)?.failureClass??'reason unavailable'}</div>:null}
        {node.kind!=='tool'&&<button className="detail-toggle" aria-label="Show tool details / metadata" onClick={()=>toggle(node.id)} aria-expanded={open.has(node.id)}>{open.has(node.id)?'Hide details':'Details & tool history'} ↗</button>}
        {node.status==='completed'&&(node.kind==='agent'||node.kind==='task')&&<button className="detail-toggle" onClick={()=>toggleCollapsed(node.id)}>{collapsed.has(node.id)?'Show steps':'Hide steps'}</button>}
        {(node.status==='failed'||node.status==='blocked'||node.kind==='decision')&&<button className="detail-toggle" onClick={()=>void copyContext(node)}>Copy context</button>}
        {open.has(node.id)&&<div className="node-details"><div>Source: {node.sourceKind} · relation: {node.correlation}</div>{node.dependencies?.length?<div>Depends on: {node.dependencies.join(', ')}</div>:null}{node.attempts?.length?<div>Attempts: {node.attempts.map(a=>`${a.attempt} ${a.model??''} ${a.failureClass??''}`).join(' · ')}</div>:null}{node.nativeId&&<div>Native ID: {node.nativeId}</div>}{node.details&&<pre>{JSON.stringify(node.details,null,2)}</pre>}</div>}
      </article>)}{rows.length>limit&&<button onClick={()=>setLimit(limit+200)}>Show next 200 ({rows.length-limit} remaining)</button>}
    </div>:<div className="log" aria-label="Execution Event Log">{shown.map(e=><div key={e.eventId}>{new Date(e.timestamp).toLocaleTimeString()} · {e.type} · {e.sourceRef?.kind??e.source} · {e.status??''} · {String(e.payload.summary??e.payload.toolName??'')}</div>)}{events.length>limit&&<button onClick={()=>setLimit(limit+200)}>Show older events</button>}</div>}
  </section>;
}
export default memo(Panel);
