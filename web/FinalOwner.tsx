import React,{useEffect,useRef,useState} from 'react';
import type {FinalOwnerView,FinalOwnerReview} from '../shared/final-owner.ts';
const pendingSlot='pi-console-final-save-request';
export default function FinalOwner({ja,apiPrefix='/api/'}:{ja:boolean;apiPrefix?:string}){
  const [view,setView]=useState<FinalOwnerView>(),[review,setReview]=useState<FinalOwnerReview>(),[selected,setSelected]=useState(''),[expiry,setExpiry]=useState('');
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const alive=useRef(true),sequence=useRef(0),reviewRef=useRef<FinalOwnerReview|undefined>(undefined);
  const text=(en:string,jp:string)=>ja?jp:en;
  const request=async(route:string,body:unknown)=>{
    for(let attempt=0;attempt<3;attempt++){const r=await fetch(apiPrefix+'workspace-permissions/final/'+route,{method:'POST',headers:{'content-type':'application/json','x-pi-console-admin':'1'},body:JSON.stringify(body)});const v=await r.json();
      if(r.ok)return v;
      // Only bounded passive read retries for the shared permission disk lock.
      // Never retry review, save or cancellation automatically.
      if((route==='session'||route==='result')&&v.error==='permission_busy'&&attempt<2){await new Promise(resolve=>setTimeout(resolve,80));continue;}
      throw Error('owner_request_unavailable');
    }
  };
  const cancelCapability=()=>{const r=reviewRef.current;if(r)void request('cancel',{reviewId:r.reviewId,requestId:r.requestId}).catch(()=>{});reviewRef.current=undefined;};
  const refresh=async()=>{
    const id=++sequence.current;setBusy(true);cancelCapability();setReview(undefined);setConfirmed(false);setSelected('');setExpiry('');setView(undefined);
    try{let pending:string|null=null;try{pending=sessionStorage.getItem(pendingSlot);}catch{}
      let v:FinalOwnerView;if(pending){const r=await request('result',{requestId:pending});v=r.current;if(alive.current&&sequence.current===id)setMessage(text('Save result checked: ','保存結果の照合: ')+r.state);if(r.state==='committed'||r.state==='committed_inactive')try{sessionStorage.removeItem(pendingSlot);}catch{}}
      else v=await request('session',{});
      if(alive.current&&sequence.current===id)setView(v);
    }catch{if(alive.current&&sequence.current===id)setMessage(text('Owner boundary unavailable. No confirmed change.','管理境界を確認できません。変更の成立は未確認です。'));}
    finally{if(alive.current&&sequence.current===id)setBusy(false);}
  };
  useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false;sequence.current++;cancelCapability();};},[]);
  const prepare=async(revoke=false)=>{
    if(!view||busy)return;const target=revoke?null:view.choices[Number(selected)]?.target;
    if(!revoke&&!target)return;const id=++sequence.current;setBusy(true);cancelCapability();setMessage('');
    try{const r=await request('review',{instance:view.instance,revision:view.revision,target,expiresAt:revoke?null:new Date(expiry).getTime()});if(alive.current&&sequence.current===id){reviewRef.current=r;setReview(r);setConfirmed(false);}else void request('cancel',{reviewId:r.reviewId,requestId:r.requestId}).catch(()=>{});}
    catch{if(alive.current&&sequence.current===id){setView(undefined);setMessage(text('Review stale or unavailable. Refresh before retrying.','対象/期限が古いか利用不可です。再読込してください。'));}}
    finally{if(alive.current&&sequence.current===id)setBusy(false);}
  };
  const save=async()=>{
    if(!review||!confirmed||busy)return;const r=review,id=++sequence.current;
    try{sessionStorage.setItem(pendingSlot,r.requestId);}catch{setMessage(text('Result tracking unavailable. Nothing sent.','結果照合の保持ができないため送信していません。'));return;}
    setBusy(true);reviewRef.current=undefined;setMessage('');
    try{const v=await request('save',{reviewId:r.reviewId,requestId:r.requestId,confirmed:true});if(alive.current&&sequence.current===id){sessionStorage.removeItem(pendingSlot);setView(v);setReview(undefined);setConfirmed(false);setSelected('');setExpiry('');setMessage(text('Saved. Foreground answer only; not overall completion.','保存しました。foreground回答のみで、全体完了の保証ではありません。'));}}
    catch{if(alive.current&&sequence.current===id){setReview(undefined);setView(undefined);setConfirmed(false);setMessage(text('Save outcome unknown or rejected. Do not resend. Read the saved result.','保存結果は未確認または拒否です。再送せず保存結果を再読取してください。'));}}
    finally{if(alive.current&&sequence.current===id)setBusy(false);}
  };
  const label=(t:FinalOwnerReview['target'])=>t?`${t.workspaceId} / ${t.sessionId} / ${t.generation} / ${t.runId}`:'';
  return <section aria-label="Final answer publication"><h3>{text('Final answer text publication','最終回答textの追加公開')}</h3>
    <p>{text('Separate from status read. Dedicated read-key holders can read the selected saved final text. Sharing the key allows other connections too; not connector, device or person authentication.','status readとは別です。専用readキーを持つ接続へ、選択runの保存済み最終回答textだけを公開します。同じキーを別接続に渡すとそこからも読めます。connector・端末・本人限定の認証ではありません。')}</p>
    <p>{text('Local management boundary is not OS owner identity. Same-SID resource risks remain. Sent bytes cannot be recalled.','local管理境界はOS本人認証ではありません。同一SID管理資源リスクは未解消です。送信済みbytesは回収できません。')}</p>
    {message&&<p role="status">{message}</p>}
    <button disabled={busy} onClick={()=>void refresh()}>{text('Read final publication state / save result','公開状態 / 保存結果を再読取')}</button>
    {view&&!view.available&&<p role="status">{text('Final-only disabled or blocked: ','final-onlyは無効またはblocked: ')}{view.reason}</p>}
    {view?.available&&<>
      <p style={{overflowWrap:'anywhere'}}>{text('Current: ','現在: ')}{view.publication?label(view.publication.target)+' / '+new Date(view.publication.expiresAt).toISOString()+' / '+(view.publication.active?'active':'inactive'):text('None','なし')}</p>
      {!review?<fieldset disabled={busy}><legend>{text('One observed exact run','観測済みexact run一件')}</legend>
        <label>{text('Final target','公開対象')} <select aria-label="Final target" value={selected} onChange={e=>setSelected(e.target.value)} style={{maxWidth:'100%'}}><option value="">{text('Select explicitly','明示選択してください')}</option>{view.choices.map((c,i)=><option key={label(c.target)} value={i}>{label(c.target)}</option>)}</select></label>
        {!view.choices.length&&<p>{text('No eligible saved/ACK-confirmed foreground answer. Unknown or ambiguous targets are not listed.','保存/ACK/foreground確認済み対象がありません。未観測・曖昧な対象は一覧に出しません。')}</p>}
        <label>{text('Absolute expiry (local date/time, max 24h)','絶対期限（local日時、最大24時間）')} <input aria-label="Final expiry" type="datetime-local" value={expiry} onChange={e=>setExpiry(e.target.value)} /></label>
        <button disabled={selected===''||!Number.isFinite(new Date(expiry).getTime())} onClick={()=>void prepare()}>{text('Review final-only publication','最終回答公開をレビュー')}</button>
        <button disabled={!view.publication} onClick={()=>void prepare(true)}>{text('Review revoke final publication','最終回答公開の解除をレビュー')}</button>
      </fieldset>:<fieldset disabled={busy}><legend>{text('Review exact final-only scope','exact final-only範囲のレビュー')}</legend>
        <p style={{overflowWrap:'anywhere'}}>{review.target?label(review.target):text('Revoke final text publication','最終回答textの公開を解除')}</p>
        <p>{text('Data: saved/ACK-confirmed foreground final answer text only. Recipient: dedicated read-key holders.','データ: 保存/ACK確認済みforeground最終回答textのみ。宛先: 専用read-key holders。')}</p>
        {review.expiresAt&&<p>{text('Absolute expiry: ','絶対期限: ')}{new Date(review.expiresAt).toISOString()}</p>}
        {review.previous&&<p style={{overflowWrap:'anywhere'}}>{text('Previous scope removed: ','解除される旧範囲: ')}{label(review.previous.target)}</p>}
        <label className="permission-choice"><input aria-label="Confirm final-only keyholders scope" type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />{text('Confirm exact run, text, keyholders, expiry and removals; no connector/person guarantee.','exact run・text・keyholders・期限・解除を確認しました。connector/本人限定ではありません。')}</label>
        <button disabled={!confirmed} onClick={()=>void save()}>{text('Save reviewed final scope','レビュー済みfinal範囲を保存')}</button>
        <button onClick={()=>{cancelCapability();setReview(undefined);setConfirmed(false);}}>{text('Cancel final review','finalレビューを取消')}</button>
      </fieldset>}
    </>}
    {busy&&<p role="status">{text('Request pending. Navigation or cancellation does not undo a committed save; read result on return.','要求処理中です。画面移動や取消でcommitが戻ったとは扱いません。戻ったら結果を再読取してください。')}</p>}
  </section>;
}
