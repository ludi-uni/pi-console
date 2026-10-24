import React, { useEffect, useRef, useState } from 'react';
import './workspace-permissions.css';
import FinalOwner from './FinalOwner.tsx';
import ExternalMcp from './ExternalMcp.tsx';
import TrustedLocalMcp from './TrustedLocalMcp.tsx';
import type { PermissionReview, WorkspacePermission } from '../shared/workspace-permissions.ts';

export default function WorkspacePermissions({ja,apiPrefix='/api/',embedded=false}:{ja:boolean;apiPrefix?:string;embedded?:boolean}) {
  const [review,setReview]=useState<PermissionReview>();
  const [selected,setSelected]=useState<WorkspacePermission[]>([]);
  const [phase,setPhase]=useState<'list'|'review'>('list');
  const [confirmed,setConfirmed]=useState(false), [busy,setBusy]=useState(false), [error,setError]=useState('');
  const alive=useRef(true), sequence=useRef(0);
  const text=(en:string,jp:string)=>ja?jp:en;
  const request=async(path:string,body:unknown,grant?:string)=>{
    for(let attempt=0;attempt<3;attempt++){
      const response=await fetch(`${apiPrefix}workspace-permissions/${path}`,{method:'POST',headers:{'content-type':'application/json','x-pi-console-admin':'1',...(grant?{'x-pi-console-permission-grant':grant}:{})},body:JSON.stringify(body)});
      const value=await response.json();if(response.ok)return value as PermissionReview;
      if(path==='session'&&value.error==='permission_busy'&&attempt<2){await new Promise(resolve=>setTimeout(resolve,80));continue;}
      throw Error(value.error??`HTTP ${response.status}`);
    }
    throw Error('permission_unavailable');
  };
  const refresh=async()=>{
    const id=++sequence.current;setBusy(true);setReview(undefined);setSelected([]);setPhase('list');setConfirmed(false);
    try{const value=await request('session',{});if(alive.current&&sequence.current===id){setReview(value);setSelected(value.snapshot.workspaces);setError('');}}
    catch{if(alive.current&&sequence.current===id)setError(text('Local owner session unavailable. No changes saved.','本人のローカル GUI セッションを確認できません。変更は保存していません。'));}
    finally{if(alive.current&&sequence.current===id)setBusy(false);}
  };
  useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false;sequence.current++;}},[]);
  const save=async()=>{
    if(!review||!confirmed||busy)return;
    const id=++sequence.current;setBusy(true);
    try{const value=await request('save',{instance:review.instance,revision:review.snapshot.revision,workspaces:selected,confirmed:true},review.grant);
      if(alive.current&&sequence.current===id){setReview(value);setSelected(value.snapshot.workspaces);setPhase('list');setConfirmed(false);setError('');}}
    catch{if(alive.current&&sequence.current===id){setReview(undefined);setConfirmed(false);setError(text('Save outcome is unknown or rejected. Refresh and inspect before making another change; do not retry automatically.','保存結果は未確認または拒否です。再試行せず、再読込して現在の範囲を確認してください。'));}}
    finally{if(alive.current&&sequence.current===id)setBusy(false);}
  };
  const update=(id:string,change:(w:WorkspacePermission)=>WorkspacePermission)=>{setSelected(old=>old.map(w=>w.id===id?change(w):w));setConfirmed(false);};
  return <section className="workspace-permissions" aria-label="Workspace and session permissions"><h3>{text('Workspace and session permissions','ワークスペース・セッションの権限')}</h3>
    <TrustedLocalMcp ja={ja} apiPrefix={apiPrefix}/>
    {!embedded&&apiPrefix==='/api/'&&<details><summary>{text('Frozen isolation mode diagnostics','凍結中の隔離 mode 診断')}</summary><ExternalMcp ja={ja} /></details>}
    <p>{text('None by default. Permissions do not create a connection or change identity. Public UI never exposes MCP. Trusted local MCP additionally needs its own authenticated listener and expiring control grant; OS isolation is unverified.','初期値は none です。権限設定は接続開始・identity変更ではありません。公開 UI は MCP を公開しません。信頼する Pi のローカル MCP には専用の認証付き入口と期限付き control 許可が別途必要です。OS 隔離成立は未検証です。')}</p>
    <p>{text('Saving requires the local owner or explicitly configured verified Access owner. Select registered workspaces and each observed session explicitly. Control must be selected separately. Reopened sessions require a new review.','保存にはローカル本人認証、または明示設定した Access 本人確認が必要です。登録 workspace と観測済み session を個別に選択してください。control は別途明示選択が必要です。再オープンした session は再確認が必要です。')}</p>
    <p>{text('Control is limited to Pi instruction staging, explicit start and stopping the exact active Pi run. Orchestrator start, approvals, slash commands and queue/background control are not supported.','操作範囲は Pi 指示の登録・明示開始・対象の実行中 Pi run の停止のみです。Orchestrator 開始、approval、slash command、queue/background 操作は対象外です。')}</p>
    {review&&!review.controlAvailable&&<p role="status">{text('Control is currently unavailable. Dedicated control authentication, explicit mode activation and an exact grant are required. Credential configuration is separate from scope review.','現在は操作不可です。専用操作認証、選択した mode の明示的な有効化と、対象を限定した grant が必要です。キー設定と scope の確認は別の操作です。')}</p>}
    {error&&<p role="alert">{error}</p>}
    <button disabled={busy} onClick={()=>void refresh()}>{text('Refresh current permissions','現在の権限を再読込')}</button>
    {review&&<><p>{text('Revision','リビジョン')}: {review.snapshot.revision}</p>
      {phase==='list'?<>
        {review.inventory.map(w=>{const picked=selected.find(s=>s.id===w.id);return <fieldset key={w.id} disabled={busy}><legend>{w.id}</legend><p style={{overflowWrap:'anywhere'}}>{w.path}</p>
          <label className="permission-choice"><input aria-label={`Workspace ${w.id}`} type="checkbox" disabled={!w.eligible&&!picked} checked={!!picked} onChange={e=>{setSelected(old=>e.target.checked?[...old,{id:w.id,path:w.path,scope:'read',sessions:[]}]:old.filter(s=>s.id!==w.id));setConfirmed(false);}}/>{text('Select workspace','workspace を選択')}</label>
          {!w.eligible&&<p>{text('Unavailable, ambiguous, or no observed sessions. Remove old permission or refresh.','未観測・曖昧・利用不可です。古い許可を解除するか再読込してください。')}</p>}
          {picked&&<><label>{text('Scope','範囲')} <select aria-label={`Scope ${w.id}`} value={picked.scope} onChange={e=>update(w.id,s=>({...s,scope:e.target.value as 'read'|'control'}))}><option value="read">read</option><option value="control">control (read + prompt/start/stop)</option></select></label>
            {w.sessions.map(s=><label className="permission-choice" key={s.id} style={{overflowWrap:'anywhere'}}><input aria-label={`Session ${s.id}`} type="checkbox" checked={picked.sessions.some(p=>p.id===s.id&&p.generation===s.generation)} onChange={e=>update(w.id,p=>({...p,sessions:e.target.checked?[...p.sessions.filter(v=>v.id!==s.id),s]:p.sessions.filter(v=>v.id!==s.id)}))}/>{s.id} / {s.generation}</label>)}
            {picked.sessions.filter(s=>!w.sessions.some(v=>v.id===s.id&&v.generation===s.generation)).map(s=><p key={s.id} role="status">{s.id}: {text('Stale generation. Deselect workspace or refresh its sessions.','古い generation です。workspace 選択を解除するか新 session を選択してください。')}</p>)}
          </>}
        </fieldset>;})}
        {selected.filter(s=>!review.inventory.some(w=>w.id===s.id)).map(w=><div key={w.id}><p>{w.id} / {w.path}: {text('Unregistered (denied)','未登録（拒否）')}</p><button disabled={busy} onClick={()=>setSelected(old=>old.filter(s=>s.id!==w.id))}>{text('Remove selection','選択を解除')}</button></div>)}
        <button disabled={busy||selected.some(w=>!w.sessions.length)} onClick={()=>{setPhase('review');setConfirmed(false);}}>{text('Review changes','変更内容を確認')}</button>
      </>:<><h4>{text('Review exact scope','対象範囲の確認')}</h4>
        {selected.length===0?<p>{text('Revoke all NEW Dots permissions. Legacy readonly scope is not revoked.','新しい Dots 権限をすべて解除します。既存 readonly scope は解除されません。')}</p>:selected.map(w=><div key={w.id} style={{overflowWrap:'anywhere'}}><strong>{w.id} / {w.scope}</strong><p>{w.path}</p>{w.sessions.map(s=><p key={s.id}>{s.id} / {s.generation}</p>)}</div>)}
        <h4>{text('Removed permissions','解除される権限')}</h4>{review.snapshot.workspaces.filter(w=>!selected.some(s=>JSON.stringify(s)===JSON.stringify(w))).map(w=><div key={w.id} style={{overflowWrap:'anywhere'}}><p>{w.id} / {w.path} / {w.scope}</p>{w.sessions.map(s=><p key={s.id}>{s.id} / {s.generation}</p>)}</div>)}
        <label className="permission-choice"><input aria-label="Confirm permission scope" disabled={busy} type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{text('I am the local owner and confirm this exact scope, including removals.','本人として対象 ID・path・read/control・session・解除内容を確認しました。')}</label>
        <button disabled={busy||!confirmed} onClick={()=>void save()}>{text('Save confirmed scope','確認した範囲を保存')}</button>
        <button disabled={busy} onClick={()=>{setPhase('list');setSelected(review.snapshot.workspaces);setConfirmed(false);}}>{text('Cancel changes','変更をキャンセル')}</button>
      </>}
    </>}
    <FinalOwner ja={ja} apiPrefix={apiPrefix}/>
  </section>;
}
