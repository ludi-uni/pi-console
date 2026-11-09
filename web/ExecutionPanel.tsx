import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ExecutionNode, ExecutionStateSnapshot, ExecutionEvent } from '../shared/types.ts';
import { liveExecutionNodes } from '../shared/execution-activity.ts';
import { visibleExecutionRows } from './ui-logic.ts';
import { copyableExecutionEvent, serializeExecutionEvent, serializeExecutionNode, writeClipboardText } from './execution-copy.ts';
const inspectable = (node:ExecutionNode) => {if(node.sourceKind!=='pi-subagents'||!node.id.startsWith('pi-subagent-async:'))return false;try{const path=JSON.parse(node.id.slice('pi-subagent-async:'.length));return Array.isArray(path)&&path.length>=1&&path.length<=2}catch{return false}};
type InspectReply = { status?: string; finalOutput?: string; task?: string; truncated?: { finalOutput?: boolean } };
const attentionRank=(status:ExecutionNode['status'])=>status==='waiting'?0:status==='blocked'?1:status==='running'?2:status==='queued'?3:4;
const byUpdatedDesc=(a:ExecutionNode,b:ExecutionNode)=>b.updatedAt.localeCompare(a.updatedAt);
function Panel({state,events,focusRootId,focusIssue,onInspect,ja}:{state?:ExecutionStateSnapshot;events:ExecutionEvent[];focusRootId?:string;focusIssue?:{eventId:string};onInspect?: (nodeId:string)=>Promise<InspectReply>;ja?:boolean}) {
  const [view,setView]=useState<'tree'|'history'>('tree');
  const [open,setOpen]=useState<Set<string>>(new Set());const [collapsed,setCollapsed]=useState<Set<string>>(new Set());const [limit,setLimit]=useState(200);
  const [notice,setNotice]=useState('');
  const logRef=useRef<HTMLDivElement>(null);
  // Manual-copy fallback shown when the Clipboard API is unavailable or the
  // write is rejected: the user still gets the full text to select and copy.
  // `request` guards async completion; the panel remounts per session
  // (key=workspace:session in main.tsx) so unmounted updates cannot occur.
  const [copyFallback,setCopyFallback]=useState<{request:number;label:string;text:string}>();
  const copyRequest=useRef(0);const fallbackRef=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{if(!copyFallback)return;const box=fallbackRef.current;if(!box)return;box.focus({preventScroll:true});box.select()},[copyFallback]);
  useEffect(()=>{if(focusIssue)setView('history')},[focusIssue]);
  useEffect(()=>{if(view!=='history'||!focusIssue)return;const frame=requestAnimationFrame(()=>{const selected=logRef.current?.querySelector<HTMLElement>('[data-selected-issue="true"]');selected?.focus({preventScroll:true});selected?.scrollIntoView({block:'nearest'})});return()=>cancelAnimationFrame(frame)},[focusIssue,view]);
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
  const selectedIssue=focusIssue&&events.find(event=>event.eventId===focusIssue.eventId);
  const nodes=useMemo(()=>state?.nodes??[],[state]);
  const nodeById=useMemo(()=>new Map(nodes.map(node=>[node.id,node])),[nodes]);
  const eventRow=(event:ExecutionEvent,older=false)=><div key={event.eventId} className={event.eventId===focusIssue?.eventId?'selected-event':undefined} data-selected-issue={event.eventId===focusIssue?.eventId?'true':undefined} tabIndex={event.eventId===focusIssue?.eventId?-1:undefined}>{older&&<strong>{ja?'選択中の問題 · 直近のイベントより前':'Selected issue · older than recent events'}<br/></strong>}{new Date(event.timestamp).toLocaleTimeString()} · {event.type} · {event.sourceRef?.kind??event.source} · {event.status??''} · {String(event.payload.summary??event.payload.toolName??'')}{copyableExecutionEvent(event)&&<button className="event-copy" aria-label={ja?`この${event.type}イベントの完全なログをコピー`:`Copy full ${event.type} log`} onClick={()=>void copyText(serializeExecutionEvent(event,ja),ja?'イベントログ':'event log')}>{ja?'ログをコピー':'Copy log'}</button>}</div>;
  const toggle=(id:string)=>setOpen(previous=>{const next=new Set(previous);next.has(id)?next.delete(id):next.add(id);return next});
  const toggleCollapsed=(id:string)=>setCollapsed(previous=>{const next=new Set(previous);next.has(id)?next.delete(id):next.add(id);return next});
  // The node projection does not retain every payload field (RunFailed drops the
  // reason entirely), so failed/interrupted context copy appends the canonical
  // events for this entity — same runId for run-kind nodes — to carry the
  // recorded error summaries and output.
  const nodeRelatedEvents=(node:ExecutionNode)=>events.filter(event=>event.entityId===node.id||(node.kind==='run'&&event.runId===node.nativeId));
  const copyContext=(node:ExecutionNode)=>void copyText(serializeExecutionNode(node,nodeRelatedEvents(node),ja),ja?'ノードのコンテキスト':'node context');
  const copyText=async(text:string,label:string)=>{const request=++copyRequest.current;setNotice('');setCopyFallback(undefined);const result=await writeClipboardText(text);if(request!==copyRequest.current)return;if(result==='copied'){setNotice(ja?'コピーしました':'Copied');return}setCopyFallback({request,label,text});setNotice(ja?'自動コピーできませんでした — テキストを選択してコピーしてください':'Automatic copy failed — select the text below and copy it manually')};
  const live=useMemo(()=>liveExecutionNodes(nodes),[nodes]);
  // Summaries mirror the canonical state only: live nodes still count when the
  // run scope closed (missing parents are not evidence of completion), and a
  // decision waiting under a finished run keeps asking for input. No progress,
  // remaining-time, success or retryability is invented here.
  const running=live.filter(n=>n.status==='running').length;
  const blocked=live.filter(n=>n.status==='blocked'||n.status==='waiting').length;
  const attentionNodes=useMemo(()=>live.filter(n=>n.status==='waiting'||n.status==='blocked'),[live]);
  const runningNodes=useMemo(()=>live.filter(n=>n.status==='running'),[live]);
  const finishedSettled=useMemo(()=>nodes.filter(n=>['completed','cancelled'].includes(n.status)&&!attentionNodes.includes(n)&&!runningNodes.includes(n)).sort(byUpdatedDesc),[nodes,attentionNodes,runningNodes]);
  const finishedFailed=useMemo(()=>nodes.filter(n=>['failed','interrupted'].includes(n.status)&&!attentionNodes.includes(n)).sort(byUpdatedDesc),[nodes,attentionNodes]);
  const statusLabel=(node:ExecutionNode)=>ja?`· ${node.status}`:`${node.status} ·`;
  const resultNodeLine=(node:ExecutionNode)=><li key={node.id}><b data-status={node.status}>{statusLabel(node)}</b><span title={node.label}>{node.label}</span></li>;
  return <section className="execution" aria-label="Execution panel"><div className="row"><h2>Activity</h2><button className={view==='tree'?'selected':''} aria-label="Tree / Current State" onClick={()=>setView('tree')}>Now</button><button className={view==='history'?'selected':''} aria-label="History / Canonical Events" onClick={()=>setView('history')}>History</button></div>
    <div className="execution-summary" role="status">{ja?`${running} 実行中 · ${state?.failedCount??0} 失敗 · ${blocked} 待ち/ブロック · ${state?.decisionCount??0} 応答待ち`:`${running} running · ${state?.failedCount??0} failed · ${blocked} waiting/blocked · ${state?.decisionCount??0} need input`}</div>{notice&&<span role="status">{notice}</span>}
    {view==='tree'?<div className="timeline" aria-label="Execution Timeline">{!orderedRows.length&&!attentionNodes.length&&!finishedSettled.length&&!finishedFailed.length&&<p>{ja?'まだ実行中のものはありません。Piが動き始めるとここに表示されます。':'Nothing running yet. Activity will appear here when Pi starts working.'}</p>}
      <div className="exec-digest" aria-label={ja?'実行の要約':'Execution summary'}>
        {!!attentionNodes.length&&<div className="exec-digest-group" data-tone="attention"><strong>{ja?'要対応':'Needs attention'}</strong><ul>{attentionNodes.slice().sort((a,b)=>attentionRank(a.status)-attentionRank(b.status)||byUpdatedDesc(a,b)).map(node=>{
          const parents:string[]=[];let parent=node.parentId?nodeById.get(node.parentId):undefined;const seen=new Set<string>([node.id]);
          while(parent&&!seen.has(parent.id)){seen.add(parent.id);parents.unshift(parent.label);parent=parent.parentId?nodeById.get(parent.parentId):undefined}
          const hint=[node.blockedReason,node.dependencies?.length?(ja?`待機: ${node.dependencies.join(', ')}`:`waiting for ${node.dependencies.join(', ')}`):undefined,node.action].filter(Boolean).join(' · ');
          return <li key={node.id}><b data-status={node.status}>{statusLabel(node)}</b><span className="exec-digest-path">{parents.length?`${parents.join(' › ')} › `:''}{node.label}</span>{hint&&<small>{hint}</small>}</li>;
        })}</ul></div>}
        {!!runningNodes.length&&<div className="exec-digest-group" data-tone="running"><strong>{ja?'進行中':'In progress'}</strong><ul>{runningNodes.slice().sort(byUpdatedDesc).slice(0,4).map(resultNodeLine)}{runningNodes.length>4&&<li><small>{ja?`他 ${runningNodes.length-4} 件 — 下のツリーで確認`:`+${runningNodes.length-4} more · see the tree below`}</small></li>}</ul></div>}
        {!!finishedSettled.length&&<details className="exec-digest-group" data-tone="done"><summary><strong>{ja?'直近の結果':'Recent results'}</strong><small>{ja?`${finishedSettled.length} 件`:`${finishedSettled.length}`}</small></summary><ul>{finishedSettled.slice(0,3).map(resultNodeLine)}{finishedSettled.length>3&&<li><small>{ja?`他 ${finishedSettled.length-3} 件 — 履歴で確認`:`+${finishedSettled.length-3} more · see History`}</small></li>}</ul></details>}
        {!!finishedFailed.length&&<details className="exec-digest-group" data-tone="failed"><summary><strong>{ja?'失敗・中断':'Failed / interrupted'}</strong><small>{ja?`${finishedFailed.length} 件`:`${finishedFailed.length}`}</small></summary><ul>{finishedFailed.slice(0,3).map(resultNodeLine)}{finishedFailed.length>3&&<li><small>{ja?`他 ${finishedFailed.length-3} 件 — 履歴で確認`:`+${finishedFailed.length-3} more · see History`}</small></li>}</ul></details>}
        {!attentionNodes.length&&!runningNodes.length&&!finishedSettled.length&&!finishedFailed.length&&!!orderedRows.length&&<p className="exec-digest-note">{ja?'要対応・進行中の項目はありません。':'No items need attention or are in progress.'}</p>}
      </div>
      {orderedRows.slice(0,limit).map(({node,depth,unattached},index)=><article key={node.id} className="execution-node" data-status={node.status} style={{paddingLeft:`${Math.min(depth,5)*13+7}px`}}>
        {unattached&&(index===0||!orderedRows[index-1].unattached)&&<strong>Unattached · no verified parent</strong>}
        <div className="node-heading"><span>{node.label}</span><b>{node.status}</b></div>
        <div className="node-meta">{node.action?`${node.action} · `:''}{node.attempt&&node.attempt>1?`attempt ${node.attempt} · `:''}{node.startedAt&&node.status==='running'?`${Math.max(0,Math.floor((Date.now()-Date.parse(node.startedAt))/1000))}s`:''}</div>
        {node.status==='blocked'&&node.dependencies?.length?<div className="node-meta">Waiting for {node.dependencies.join(', ')}</div>:null}
        {node.attempts?.length&&node.status==='failed'?<div className="node-meta">{node.attempts.length} attempts · latest: {node.attempts.at(-1)?.failureClass??'reason unavailable'}</div>:null}
        {node.kind!=='tool'&&<button className="detail-toggle" aria-label="Show tool details / metadata" onClick={()=>toggle(node.id)} aria-expanded={open.has(node.id)}>{open.has(node.id)?'Hide details':'Details & tool history'} ↗</button>}
        {onInspect&&inspectable(node)&&<button className="detail-toggle" disabled={!!inspection[node.id]?.busy} onClick={()=>void inspect(node.id)}>{inspection[node.id]?.busy?'Loading result…':'Inspect background result'}</button>}
        {inspection[node.id]&&!inspection[node.id].busy&&<div className="node-details" role="status">{inspection[node.id].error?<span>{inspection[node.id].error}</span>:<><strong>Background result · {inspection[node.id].reply?.status??'unknown'}</strong>{inspection[node.id].reply?.finalOutput?<pre>{inspection[node.id].reply?.finalOutput}</pre>:<p>No final output is available yet. Try again after completion.</p>}{inspection[node.id].reply?.truncated?.finalOutput&&<small>Output truncated by pi-subagents.</small>}</>}</div>}
        {node.status==='completed'&&(node.kind==='agent'||node.kind==='task')&&<button className="detail-toggle" onClick={()=>toggleCollapsed(node.id)}>{collapsed.has(node.id)?'Show steps':'Hide steps'}</button>}
        {(node.status==='failed'||node.status==='interrupted'||node.status==='blocked'||node.kind==='decision')&&<button className="detail-toggle" onClick={()=>copyContext(node)}>Copy context</button>}
        {open.has(node.id)&&<div className="node-details"><div>Source: {node.sourceKind} · relation: {node.correlation} · kind: {node.kind}</div>{node.dependencies?.length?<div>Depends on: {node.dependencies.join(', ')}</div>:null}{node.attempts?.length?<div>Attempts: {node.attempts.map(a=>`${a.attempt} ${a.model??''} ${a.failureClass??''}`).join(' · ')}</div>:null}{node.model||node.provider?<div>Model: {[node.provider,node.model].filter(Boolean).join(' / ')}</div>:null}{node.blockedReason?<div>Blocked reason: {node.blockedReason}</div>:null}{node.nativeId&&<div>Native ID: {node.nativeId}</div>}{node.details&&<pre>{JSON.stringify(node.details,null,2)}</pre>}</div>}
      </article>)}{orderedRows.length>limit&&<button onClick={()=>setLimit(limit+200)}>Show next 200 ({orderedRows.length-limit} remaining)</button>}
    </div>:<div className="log" aria-label="Execution Event Log" ref={logRef}>{focusIssue&&!selectedIssue&&<p>{ja?'選択中の問題はこのセッションのイベント履歴にありません。':"Selected issue is no longer in this session's event history."}</p>}{selectedIssue&&!shown.some(event=>event.eventId===selectedIssue.eventId)&&eventRow(selectedIssue,true)}{shown.map(event=>eventRow(event))}{events.length>limit&&<button onClick={()=>setLimit(limit+200)}>Show older events</button>}</div>}
    {copyFallback&&<div className="copy-fallback" role="group" aria-label={ja?'手動コピー':'Manual copy'}><p role="status">{ja?`クリップボードへ自動コピーできませんでした。以下の${copyFallback.label}をすべて選択してコピーしてください。`:`Could not copy automatically. Select all of the ${copyFallback.label} below and copy it manually.`}</p><textarea ref={fallbackRef} className="copy-fallback-text" aria-label={ja?`コピー用の完全な${copyFallback.label}テキスト`:`Full ${copyFallback.label} text to copy`} readOnly value={copyFallback.text}/><button onClick={()=>setCopyFallback(undefined)}>{ja?'閉じる':'Dismiss'}</button></div>}
  </section>;
}
export default memo(Panel);
