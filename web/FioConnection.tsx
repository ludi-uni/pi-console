import React,{useEffect,useRef,useState} from 'react';
import ExpiryCountdown from './ExpiryCountdown.tsx';
import {fioConnectionStep} from './fio-connection-state.ts';
import './fio-connection.css';
type Request=(route:string,body:unknown)=>Promise<any>;
type Pending={kind:'prepare'|'grant'|'revoke';id:string};
const reasons:Record<string,string>={ready:'準備済み',session_unobserved:'既存セッションの起動が必要',session_unconfirmed:'セッションの状態確認が必要',sessions_missing:'セッションの準備が必要',path_unavailable:'フォルダの安全性を確認できません',duplicate_workspace:'登録先が重複しています',sessions_unavailable:'セッション一覧を安全に読み取れません',sessions_ambiguous:'セッションIDが重複しています',listing_limit:'一覧の確認上限を超えています'};
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(v);
const uuid=()=>{if(typeof crypto.randomUUID!=='function')throw Error('compatible_browser_required');return crypto.randomUUID()};
const fixedApp='pi-console-echo-test';
const visible=(v:unknown)=>String(v??'').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
const resultText:Record<string,string>={committed:'許可を保存しました',revoked:'許可を解除しました',cancelled:'確認を取り消しました',failed:'許可できませんでした',partial:'一部の権限保存だけが残りました',unknown:'結果を確認できません',committing:'許可を保存中です',revoking:'解除の結果を確認中です'};
const transferText:Record<string,string>={'input-open':'PCの入力画面で本人確認待ち',starting:'接続を準備中',stopping:'停止の確認中',cancelled:'取消済み',expired:'保持期限終了',stopped:'停止済み','stop-unconfirmed':'停止を確認できません','daemon-unattributed':'既存接続の帰属を確認できません','input-busy':'別の入力画面が開いています',conflict:'別の接続があり起動を拒否しました',unavailable:'接続準備を確認できません',noninteractive:'対話デスクトップを利用できません',unknown:'結果未確認'};
export default function FioConnection({apiPrefix='/local-owner/pi-control/',onStart,transportRequest}:{apiPrefix?:string;onStart?:()=>Promise<void>;transportRequest?:Request}={}){
 const slot='pi-console-fio-flow:'+apiPrefix;
 const [open,setOpen]=useState(false),[control,setControl]=useState<any>(),[transport,setTransport]=useState<any>(),[workspaceId,setWorkspace]=useState(''),[sessionId,setSession]=useState(''),[connectionId,setConnection]=useState(''),[minutes,setMinutes]=useState('15'),[pathway,setPathway]=useState(transportRequest?'tunnel':'stdio'),[transportMinutes,setTransportMinutes]=useState(480),[review,setReview]=useState<any>(),[confirmed,setConfirmed]=useState(false),[pending,setPending]=useState<Pending>(),[preparation,setPreparation]=useState<any>(),[receipt,setReceipt]=useState<any>(),[transportReceipt,setTransportReceipt]=useState<any>(),[flowId,setFlowId]=useState(''),[catalogHelp,setCatalogHelp]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[now,setNow]=useState(Date.now());
 const alive=useRef(true),lock=useRef(false),epoch=useRef(0),sent=useRef(new Set<string>()),stored=useRef<any>({});
 const valid=(e:number)=>alive.current&&epoch.current===e;
 const save=(patch:any)=>{stored.current={...stored.current,...patch};sessionStorage.setItem(slot,JSON.stringify(stored.current))};
 const request:Request=async(route,body)=>{const r=await fetch(apiPrefix+route,{method:'POST',headers:{'content-type':'application/json','x-pi-console-admin':'1'},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(v.error??'owner_unavailable');return v};
 const run=async(work:(e:number)=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);const e=epoch.current;setError('');try{await work(e)}catch{if(valid(e))setError('状態や処理結果を確認できません。同じ照合を再取得してください。完了として扱ったり自動で再送したりしません。')}finally{lock.current=false;if(alive.current)setBusy(false)}};
 const refresh=async(e:number)=>{const [c,t]=await Promise.all([request('status',{}),transportRequest?transportRequest('tunnel/status',{}):Promise.resolve(undefined)]);if(!valid(e))return;
  setControl(c);setTransport(t);if(t?.active){setTransportReceipt(t.active);if([60,480,44640].includes(t.active.durationMinutes))setTransportMinutes(t.active.durationMinutes)}
  const active=c.connections?.find((v:any)=>v.state==='connected'&&v.expiresAt>Date.now());if(active?.target){setWorkspace(active.target.workspaceId);setSession(active.target.sessionId);setConnection(active.connectionId);save({workspaceId:active.target.workspaceId,sessionId:active.target.sessionId,connectionId:active.connectionId})}
  return c;
 };
 const reconcile=async(e:number,p:Pending)=>{const r=await request(p.kind==='prepare'?'preparation-result':'result',{requestId:p.id});if(!valid(e))return;
  if(p.kind==='prepare')setPreparation(r);else setReceipt(r);
  if(!['unknown','preparing','committing','revoking','uncertain'].includes(r.state)){
   setPending(undefined);save({pending:null});const c=await refresh(e);
   if(valid(e)&&p.kind==='prepare'&&r.state==='prepared'&&c?.candidates?.items.some((w:any)=>w.id===r.workspaceId&&w.sessions.some((s:any)=>s.id===r.sessionId&&s.generation===r.generation))){setWorkspace(r.workspaceId);setSession(r.sessionId);save({workspaceId:r.workspaceId,sessionId:r.sessionId})}
  }else await refresh(e);
 };
 useEffect(()=>{alive.current=true;try{const v=JSON.parse(sessionStorage.getItem(slot)??'null');if(v&&typeof v==='object'){stored.current=v;if(id(v.workspaceId))setWorkspace(v.workspaceId);if(id(v.sessionId))setSession(v.sessionId);if(id(v.connectionId))setConnection(v.connectionId);if(typeof v.minutes==='string')setMinutes(v.minutes);if(v.pathway==='stdio'||v.pathway==='tunnel'&&transportRequest)setPathway(v.pathway);if(id(v.flowId))setFlowId(v.flowId);if(v.pending&&['prepare','grant','revoke'].includes(v.pending.kind)&&id(v.pending.id)){setPending(v.pending);setOpen(true)}}}catch{}return()=>{alive.current=false;epoch.current++}},[]);
 useEffect(()=>{if(!open)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[open]);
 useEffect(()=>{if(!open||busy||review||error)return;const timer=setTimeout(()=>void run(refresh),2500);return()=>clearTimeout(timer)},[open,busy,control,transport,review,error]);
 const show=()=>{setOpen(true);epoch.current++;void run(async e=>{if(onStart)await onStart();if(!flowId){const f=uuid();if(valid(e)){setFlowId(f);save({flowId:f})}}await refresh(e)})};
 const close=()=>{epoch.current++;setOpen(false);setReview(undefined);setConfirmed(false)};
 const selection=(patch:any)=>{epoch.current++;setReview(undefined);setConfirmed(false);setPreparation(undefined);save(patch)};
 const candidates=control?.candidates?.items??[],workspace=candidates.find((w:any)=>w.id===workspaceId),session=workspace?.sessions.find((s:any)=>s.id===sessionId),active=control?.connections?.find((c:any)=>c.state==='connected'&&c.expiresAt>now),requests=control?.connections?.filter((c:any)=>c.state==='pending'&&c.expiresAt>now)??[],oldRequests=control?.connections?.filter((c:any)=>c.state!=='connected'&&!(c.state==='pending'&&c.expiresAt>now))??[];
 const step=fioConnectionStep({now,control,transport,workspaceId,sessionId,connectionId,pathway,preparation,error:!!error,catalogHelp});
 const readyTarget=session?.state==='observed'||!!active;
 const n=Number(minutes),canReview=step.code==='review_ready'&&!pending&&!busy&&Number.isSafeInteger(n)&&n>=1&&n<=480;
 const reference=active?.connectionId||connectionId&&requests.some((c:any)=>c.connectionId===connectionId)&&connectionId;
 const transportBlocked=transport?.active&&transport.active.app!==fixedApp||['daemon-unattributed','conflict','stop-unconfirmed','input-busy'].includes(transportReceipt?.state);
 const transportFinished=transportReceipt?.finished===true;
 const mutation=async(e:number,kind:Pending['kind'],route:string,body:any)=>{const key=body.requestId;if(sent.current.has(key))return;const p={kind,id:key};save({pending:p});sent.current.add(key);setPending(p);if(kind==='prepare')setPreparation({state:'preparing'});await request(route,body);if(valid(e))await reconcile(e,p)};
 const prepare=()=>void run(e=>mutation(e,'prepare','prepare',{requestId:uuid(),workspaceId,expectedPath:workspace.path,sessionId:workspace.sessions.length?sessionId:null,confirmed:true}));
 const inspectTransport=()=>void run(async e=>{if(!transportRequest)return;const rid=transport?.active?.requestId??transportReceipt?.requestId??stored.current.transportRequestId;if(rid){const r=await transportRequest('tunnel/result',{requestId:rid});if(valid(e))setTransportReceipt(r)}await refresh(e)});
 return <section className="fio-connect" aria-label="Dots connection"><h3>Dotsにつなぐ</h3>
  <p>ワークスペースを選び、必要な準備と許可の確認をこの画面で進めます。接続だけで指示を実行しません。</p>
  {!open?<button onClick={show}>Dotsにつなぐ</button>:<>
   <div className="fio-status" role="status"><strong>{step.title}</strong><p>{step.next}</p></div>
   {error&&<p role="alert">{error}</p>}
   {reference&&<p className="fio-reference">照合コード <code>{reference}</code></p>}
   <button disabled={busy} onClick={()=>void run(refresh)}>接続状態と対象を再取得</button>
   <fieldset disabled={busy||!!pending||!!review||!!active}><legend>1. 対象を選ぶ</legend>
    {!active&&!review&&<label>ワークスペース<select aria-label="Dots workspace" value={workspaceId} onChange={e=>{selection({workspaceId:e.target.value,sessionId:'',connectionId:''});setWorkspace(e.target.value);setSession('');setConnection('')}}><option value="">登録済みの対象を選ぶ</option>{candidates.map((w:any)=><option key={w.id} value={w.id}>{visible(w.name)} — {reasons[w.status]??'状態を確認してください'}</option>)}</select></label>}
    {workspace&&<><p className="fio-path">{visible(workspace.name)}<br/>{visible(workspace.path)}</p><p>{active||review?'選んだセッション: '+sessionId.slice(0,12):reasons[workspace.status]??'状態を確認してください'}</p>
     {!active&&!review&&workspace.sessions.length>0&&<label>セッション<select aria-label="Dots session" value={sessionId} onChange={e=>{selection({sessionId:e.target.value});setSession(e.target.value)}}><option value="">既存セッションを選ぶ</option>{workspace.sessions.map((s:any)=><option key={s.id} value={s.id}>{s.id.slice(0,12)} — {s.state==='observed'?'準備済み':s.preparable?'起動が必要':s.state==='unconfirmed'?'状態未確認':'準備処理中'}</option>)}</select></label>}
     {control.preparationAvailable&&workspace.preparable&&workspace.sessions.length===0&&<><p>本人のクリックで新しい Pi セッションの worker を起動します。Pi/SDK/extensions を信頼して準備し、指示や待機中の指示の再開は送りません。</p><button onClick={prepare}>新しいセッションを準備する</button></>}
     {control.preparationAvailable&&session?.preparable&&<><p>選んだ既存セッションの worker を起動します。Pi/SDK/extensions を信頼して準備し、新しいセッションや指示送信は行いません。待機中の指示も再開しません。</p><button onClick={prepare}>選んだセッションを起動して準備</button></>}
    </>}
    {control?.candidates?.truncated&&<p>一覧に確認上限があります。上限を超えた対象は理由を表示し、この画面では起動・許可しません。</p>}
   </fieldset>
   {pending&&<div role="status"><p>処理の結果を同じ照合で確認しています。再申請・再準備はしません。</p><button disabled={busy} onClick={()=>void run(e=>reconcile(e,pending))}>同じ照合の処理結果を確認</button>{pending.kind==='prepare'&&preparation?.state==='uncertain'&&<><p>worker が既に起動している可能性があります。現在の対象を再取得し、本人が選び直せます。元の準備を再送・停止する操作ではありません。</p><button disabled={busy} onClick={()=>{selection({pending:null,sessionId:''});setPending(undefined);setSession('')}}>現在の対象を確認して選び直す</button></>}</div>}
   {receipt&&<p role="status">{resultText[receipt.state]??'結果を確認してください'}{receipt.state==='partial'&&'。接続を有効にしていません。現在の基本権限を確認してください。'}</p>}
   {readyTarget&&<>{!active&&!review&&<fieldset disabled={busy||!!pending}><legend>2. 許可する操作と期限</legend>
    <p>選んだ1セッションの指示登録・本人の依頼による開始・対象 Pi 実行の停止・取消・結果照合を許可します。全履歴や最終回答本文の公開、親フォルダの作成権限は付けません。</p>
    <label>Pi 操作を許可する時間（分）<input type="number" aria-label="Dots Pi minutes" min={1} max={480} value={minutes} onChange={e=>{selection({minutes:e.target.value});setMinutes(e.target.value)}}/></label>
    <p>初期15分、最大8時間。下の31日接続を選んでも、この操作期限は延びません。</p>
   </fieldset>}
   <details className="fio-transport-details" open={!active&&!review||['approved_disconnected','binding_mismatch','unverified'].includes(step.code)}><summary>{active||review?'転送・再検出の詳細':'3. 連携先の準備'}</summary><fieldset className="fio-transport"><legend>接続方法</legend>
    {transportRequest&&<><button disabled={busy||!!pending||!!review||!!active} onClick={()=>{selection({pathway:pathway==='tunnel'?'stdio':'tunnel'});setPathway(pathway==='tunnel'?'stdio':'tunnel')}}>{pathway==='tunnel'?'ローカル MCP client で使う':'Dotsの Tunnel 接続で使う'}</button></>}
    {pathway==='stdio'?<p>Console PC の対応stdio clientで既存companionを使います。Tunnelは起動しません。clientから申請が届くまで許可しません。</p>:<>
     <p>既存 {fixedApp} の接続を使います。転送の準備は Pi 操作の許可と別です。</p>
     {transport?.active&&<p>転送: {transport.active.state==='tunnel-ready'?'準備済み・連携先の確認は別':transferText[transport.active.state]??'状態を確認してください'}<br/>転送の保持期限: <ExpiryCountdown expiresAt={transport.active.leaseUntil}/></p>}
     {transportReceipt&&!transport?.active&&<p>転送の結果: {transferText[transportReceipt.state]??'状態を確認してください'}。新しく起動する前に結果を照合してください。</p>}
     <button disabled={busy} onClick={inspectTransport}>転送の状態を照合</button>
     {transport?.active?.state==='tunnel-ready'&&<button disabled={busy||!!pending} onClick={()=>void run(async e=>{const r=await transportRequest!('tunnel/reuse',{requestId:transport.active.requestId,confirmed:true});if(valid(e)){setTransportReceipt(r);await refresh(e)}})}>既存の接続を確認して使う</button>}
     {transportFinished&&!transportBlocked&&<button disabled={busy} onClick={()=>{setTransportReceipt(undefined);save({transportRequestId:null})}}>終了を確認したので新しい接続の準備に戻る</button>}
     {!transport?.active&&!transportReceipt?.requestId&&!transportBlocked&&<><label>転送を保持する期間<select aria-label="Dots transport duration" disabled={busy||!!pending||!!review} value={transportMinutes} onChange={e=>setTransportMinutes(Number(e.target.value))}><option value={60}>1時間</option><option value={480}>8時間</option><option value={44640}>1か月（31日）</option></select></label>
      <p>1時間・8時間は本人認証期限で短くなる場合があります。31日は新しい転送だけの有限な保持許可で、Piや親フォルダの操作期限は延びません。</p>
      <button disabled={busy||!!pending||!!review||!workspace?.preparable||!transport?.available} onClick={()=>void run(async e=>{const rid=uuid();save({transportRequestId:rid});const r=await transportRequest!('tunnel/request',{requestId:rid,confirmed:true,durationMinutes:transportMinutes});if(valid(e)){setTransportReceipt(r);await refresh(e)}})}>本人 PC に鍵の入力画面を開く</button>
     </>}
     {transport?.active?.state!=='tunnel-ready'&&<p>鍵は PC に開く password 欄へ本人が直接入力します。Webやチャットには貼らず、保存しません。PC の入力画面を閉じると対象接続も停止します。帰属不明・別接続・停止未確認の場合は既存接続を保ち、新規起動しません。</p>}
     {transportReceipt?.requestId&&!transportFinished&&<button disabled={busy||!!transportBlocked} onClick={()=>void run(async e=>{const r=await transportRequest!('tunnel/cancel',{requestId:transportReceipt.requestId});if(valid(e)){setTransportReceipt(r);await refresh(e)}})}>この転送を明示して取消・停止</button>}
    </>}
    <button disabled={busy} onClick={()=>setCatalogHelp(!catalogHelp)}>{catalogHelp?'再検出の手順を閉じる':'Dotsに申請 tool が見えない場合'}</button>
    {catalogHelp&&<div className="fio-help"><p>Dots側で既存 {fixedApp} の connection を再検出し、begin_pi_control_connection が見えるか確認してください。対応する custom MCP では Refresh 後に新しい会話を使います。公開pluginやRefreshが無い場合は更新方法を確認し、既存Appを削除・再作成しません。この画面からApp設定を変更したり、再検出済みと断定したりはしません。</p><p>再検出後は「Pi連携の接続申請をして」と依頼し、この画面を再取得します。申請だけで対象操作は許可しません。</p></div>}
   </fieldset></details>
   <fieldset><legend>4. 接続の許可を確認</legend>
    {!active&&!review&&<><label>今回の接続申請<select aria-label="Dots connection request" disabled={busy||!!pending} value={requests.some((c:any)=>c.connectionId===connectionId)?connectionId:''} onChange={e=>{selection({connectionId:e.target.value});setConnection(e.target.value)}}><option value="">本人が依頼した照合コードを選ぶ</option>{requests.map((c:any)=><option key={c.connectionId} value={c.connectionId}>{c.connectionId}</option>)}</select></label>
     <button disabled={!canReview} onClick={()=>void run(async e=>{const r=await request('review',{connectionId,workspaceId,sessionId,generation:session.generation,durationMinutes:n});if(valid(e)){setReview(r);setConfirmed(false)}})}>この対象と許可内容を最終確認</button>
    </>}
    {review&&<div className="fio-review"><h4>この対象への連携を許可する</h4><p className="fio-path">{visible(workspace?.name)}<br/>{visible(review.path)}<br/>選んだセッション: {review.target.sessionId.slice(0,12)}<br/>Pi操作期限: <ExpiryCountdown expiresAt={review.expiresAt}/><br/>この確認は <ExpiryCountdown expiresAt={review.reviewUntil}/> まで</p>
     <p>許可する操作は、このセッションの指示登録・明示開始・対象 Pi 実行の停止・取消・結果照合です。全履歴や本文公開、親フォルダの権限は付けません。</p>
     <p>鍵は内部で用意してこの接続のメモリだけで使い、ファイルに保存しません。人が3本作る必要はありません。許可だけで Pi を実行しません。</p>
     {review.baseChanged&&<p role="status">既存の基本権限を、選んだ1セッションの操作権限へ変更します。同じworkspaceの他セッションは許可対象から外れます。</p>}
     {review.finalPublicationWillBeRevoked&&<p role="alert">既存の最終回答公開許可（exact final）が解除されます。送信済み本文は消しません。</p>}
     <label><input type="checkbox" aria-label="Confirm Dots grant" disabled={busy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>この対象・操作・期限と既存権限の変更を本人として確認した</label>
     <button disabled={busy||!confirmed||review.reviewUntil<=now} onClick={()=>void run(async e=>{const r=review;setReview(undefined);setConfirmed(false);await mutation(e,'grant','approve',{reviewId:r.reviewId,requestId:r.requestId,confirmed:true})})}>この連携を許可する</button>
     <button disabled={busy} onClick={()=>void run(async e=>{await request('cancel',{reviewId:review.reviewId});if(valid(e)){setReview(undefined);setConfirmed(false)}})}>対象や期限を変更する・確認を取消</button>
    </div>}
    {active&&<><p>Pi操作期限: <ExpiryCountdown expiresAt={active.expiresAt}/></p><p>この対象だけの指示登録・明示開始・停止・取消・照合を許可しています。転送の保持期限とは別です。</p><button disabled={busy||!!pending} onClick={()=>void run(e=>mutation(e,'revoke','revoke',{requestId:uuid()}))}>この Pi 連携の許可を解除</button><p>解除は新しい操作を拒否します。実行中の Pi・作成済みrepo・送信済み本文・転送を削除/停止する操作ではありません。</p></>}
   </fieldset></>}
   <details><summary>対象と照合の詳細・以前の申請</summary><div className="fio-details"><p>Console: {control?.instance}<br/>基本権限のrevision: {control?.snapshot?.revision}</p>
    <p>workspace ID: {workspaceId}<br/>session ID: {sessionId}<br/>generation: {session?.generation??'未観測'}</p>
    {review&&<><p>最終対象: {JSON.stringify(review.target)}</p><p>変更前の対象: {JSON.stringify(review.previousWorkspace)}</p><p>review: {review.reviewId}<br/>保存結果: {review.requestId}</p></>}
    <p>画面照合: {flowId}<br/>準備/保存の照合: {pending?.id??preparation?.requestId??receipt?.requestId??'なし'}<br/>転送照合: {transportReceipt?.requestId??transport?.active?.requestId??stored.current.transportRequestId??'なし'}</p>
    {oldRequests.length>0&&<><p>以前の申請は現在の選択対象ではありません。</p><ul>{oldRequests.map((c:any)=><li key={c.connectionId}>{c.connectionId} / {c.state} / <ExpiryCountdown expiresAt={c.expiresAt}/></li>)}</ul></>}
    <p>Pi/SDK/extensionsを信頼する運用です。任意commandをOS隔離する機能ではありません。他のMCP clientにも同じ対象確認を適用し、clientInfoやDotsという名前を認証に使いません。</p>
   </div></details>
   {typeof crypto.randomUUID!=='function'&&<p>照合コードを安全に生成できるHTTPS/loopbackの対応browserで操作してください。準備や許可は実行できません。</p>}
   <button onClick={close}>閉じる・設定に戻る</button><p>閉じても転送や準備済みworker、許可を勝手に停止しません。未確認の処理結果は再開して照合できます。</p>
  </>}
 </section>;
}
