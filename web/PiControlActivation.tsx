import React,{useEffect,useRef,useState} from 'react';
import ExpiryCountdown from './ExpiryCountdown.tsx';
export default function PiControlActivation({apiPrefix='/local-owner/pi-control/',onStart}:{apiPrefix?:string;onStart?:()=>Promise<void>}={}){
 const [open,setOpen]=useState(false),[view,setView]=useState<any>(),[connection,setConnection]=useState(''),[workspace,setWorkspace]=useState(''),[session,setSession]=useState(''),[minutes,setMinutes]=useState('15'),[review,setReview]=useState<any>(),[confirmed,setConfirmed]=useState(false),[pending,setPending]=useState<string>(),[receipt,setReceipt]=useState<any>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const sent=useRef(new Set<string>()),lock=useRef(false),alive=useRef(true),slot='pi-console-control-save:'+apiPrefix;
 const request=async(route:string,body:any)=>{const r=await fetch(apiPrefix+route,{method:'POST',headers:{'content-type':'application/json','x-pi-console-admin':'1'},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(v.error);return v};
 const run=async(work:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await work()}catch{if(alive.current)setError('結果を確認できません。対象の世代・本人認証・保存結果を照合してください。自動再送はしません。')}finally{lock.current=false;if(alive.current)setBusy(false)}};
 const refresh=async()=>{const v=await request('status',{});if(alive.current)setView(v)};
 const inspect=async(id:string)=>{const r=await request('result',{requestId:id});if(alive.current)setReceipt(r);if(!['unknown','committing','revoking'].includes(r.state)){sessionStorage.removeItem(slot);setPending(undefined);await refresh()}};
 useEffect(()=>{alive.current=true;try{const id=sessionStorage.getItem(slot);if(id){setPending(id);setOpen(true)}}catch{}return()=>{alive.current=false}},[]);
 const selected=view?.inventory?.find((w:any)=>w.id===workspace),observed=selected?.sessions?.find((s:any)=>s.id===session),clear=()=>{setReview(undefined);setConfirmed(false)};
 return <section aria-label="Pi control activation"><h3>本人が選ぶ Pi セッションの連携</h3>
  <p>選んだ既存 Pi session の指示登録・明示開始・対象 run 停止を許可します。Pi・SDK・extensions は信頼する運用です。</p>
  <p>Console の受付対象を限定し、Pi の任意 command を OS 隔離しません。親フォルダの作成許可とは別です。run/history/final 本文公開、Orchestrator や任意の初期化 command は含めません。</p>
  <button disabled={busy} onClick={()=>void run(async()=>{if(onStart)await onStart();await refresh();setOpen(true)})}>Pi 連携の申請と対象を確認</button>
  {open&&<><p>対応 client で begin_pi_control_connection を一度実行し、非秘密の接続 ID と同じ申請を選びます。共有 companion 接続への許可です。フォルダ接続は別に維持します。</p>
   <button disabled={busy} onClick={()=>void run(refresh)}>Pi 申請・対象を再取得</button>
   {error&&<p role="alert">{error}</p>}
   {view?.enabled&&<p role="status">{error?'前回の確認結果（現在の状態は未確認）':'Pi control 有効'} / 専用 loopback port {view.port}</p>}
   <ul>{view?.connections?.map((c:any)=><li key={c.connectionId} style={{overflowWrap:'anywhere'}}>{c.name} / {c.connectionId} / {c.state} / {c.target&&`${c.target.workspaceId} / ${c.target.sessionId} / ${c.target.generation}`} / <ExpiryCountdown expiresAt={c.expiresAt}/></li>)}</ul>
   {!review&&!pending&&!view?.enabled&&<><label>申請する接続<select aria-label="Pi pending connection" disabled={busy} value={connection} onChange={e=>{setConnection(e.target.value);clear()}}><option value="">接続 ID を選択</option>{view?.connections?.filter((c:any)=>c.state==='pending').map((c:any)=><option key={c.connectionId} value={c.connectionId}>{c.name} / {c.connectionId}</option>)}</select></label>
    <label>本人が制御を許可する workspace<select aria-label="Pi workspace" disabled={busy} value={workspace} onChange={e=>{setWorkspace(e.target.value);setSession('');clear()}}><option value="">ID と path を確認して選択</option>{view?.inventory?.filter((w:any)=>w.eligible).map((w:any)=><option key={w.id} value={w.id}>{w.id} / {w.path}</option>)}</select></label>
    <label>観測済みの既存 Pi session<select aria-label="Pi session" disabled={busy||!selected} value={session} onChange={e=>{setSession(e.target.value);clear()}}><option value="">session ID と generation を選択</option>{selected?.sessions?.map((s:any)=><option key={s.id} value={s.id}>{s.id} / {s.generation}</option>)}</select></label>
    <p>現在開いている workspace を自動選択しません。候補が無い場合は許可せず、worker の自動 open/resume もしません。</p>
    <label>制御の許可期限（分）<input type="number" aria-label="Pi control minutes" min={1} max={480} disabled={busy} value={minutes} onChange={e=>{setMinutes(e.target.value);clear()}}/></label>
    <p>最大8時間。review は5分。credential と exact control grant はこの期限までです。1か月の Tunnel を選んでも Pi 権限は延びません。再起動後は OFF です。</p>
    <button disabled={busy||!view?.connections?.some((c:any)=>c.state==='pending'&&c.connectionId===connection)||!observed} onClick={()=>void run(async()=>{const n=Number(minutes);if(!Number.isSafeInteger(n)||n<1||n>480)throw Error();const v=await request('review',{connectionId:connection,workspaceId:workspace,sessionId:session,generation:observed.generation,durationMinutes:n});if(alive.current){setReview(v);setConfirmed(false)}})}>Pi 対象と権限変更を確認</button>
   </>}
   {review&&<><h4>Pi 連携を有効にする最終確認</h4><p style={{overflowWrap:'anywhere'}}>接続 ID: {review.connectionId}<br/>workspace: {review.target.workspaceId} / {review.path}<br/>session: {review.target.sessionId} / {review.target.generation}<br/>期限: <ExpiryCountdown expiresAt={review.expiresAt}/><br/>review: <ExpiryCountdown expiresAt={review.reviewUntil}/></p>
    <p>操作: 指示の送信待ち登録・明示開始・対象 Pi run 停止・送信待ち取消・結果照合。確定だけでは指示を登録・実行しません。</p>
    {review.baseChanged&&<p role="status" style={{overflowWrap:'anywhere'}}>この workspace の基本権限を、選んだ1つの session の control へ変更します。変更前: {review.previousWorkspace?`${review.previousWorkspace.scope} / ${review.previousWorkspace.sessions.map((s:any)=>`${s.id} (${s.generation})`).join(', ')}`:'許可なし'}。変更前の他 session はこの workspace の許可対象から外れます。</p>}
    {review.finalPublicationWillBeRevoked&&<p role="alert">基本 scope の変更に伴い、既存の exact final 公開許可が解除されます。送信済み本文は消しません。</p>}
    <p>用途別 credential は内部生成し、private broker から companion のメモリだけへ渡します。キーの手作成・入力・profile保存はありません。解除はこの画面で行い、Pi 実行中 run を停止したり、repo・送信済み本文を削除したりしません。</p>
    <label><input type="checkbox" aria-label="Confirm Pi control activation" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>本人として接続 ID・対象・操作・期限と上の既存 scope 変更／解除を確認した</label>
    <button disabled={busy||!confirmed} onClick={()=>void run(async()=>{const r=review;if(!r||sent.current.has(r.requestId))return;sessionStorage.setItem(slot,r.requestId);sent.current.add(r.requestId);setPending(r.requestId);setReview(undefined);setConfirmed(false);await request('approve',{reviewId:r.reviewId,requestId:r.requestId,confirmed:true});await inspect(r.requestId)})}>この Pi 連携を有効にする</button>
    <button disabled={busy} onClick={()=>void run(async()=>{await request('cancel',{reviewId:review.reviewId});clear()})}>戻る・Pi 確認を取消</button>
   </>}
   {pending&&<><p style={{overflowWrap:'anywhere'}}>保存結果の照合 ID: {pending}</p><button disabled={busy} onClick={()=>void run(()=>inspect(pending))}>Pi 有効化の結果を照合</button></>}
   {receipt&&<p role="status">結果: {receipt.state}{receipt.state==='partial'&&'。基本 scope の保存だけ成功した可能性があります。listener は閉じ、handoff していません。現在の基本権限を確認してください。'}</p>}
   <button disabled={busy||!!pending||!view?.enabled||typeof crypto.randomUUID!=='function'} onClick={()=>void run(async()=>{const id=crypto.randomUUID();sessionStorage.setItem(slot,id);setPending(id);await request('revoke',{requestId:id});await inspect(id)})}>この Pi 制御許可を解除</button>
   {typeof crypto.randomUUID!=='function'&&<p>この browser では解除申請を作成できません。対応する安全な browser で操作してください。</p>}
   <button disabled={busy} onClick={()=>setOpen(false)}>Pi 設定から戻る</button><p>戻るだけでは、確定した制御許可を解除しません。</p>
  </>}
 </section>;
}
