import React,{useEffect,useRef,useState}from'react';
import {localOwnerLoginCommand} from './local-resume-config.ts';
import type {LocalResumeSource} from './local-resume-config.ts';
import ResumeConnectionSetup from './ResumeConnectionSetup.tsx';
import type {ResumeSetupSelection} from './ResumeConnectionSetup.tsx';
import './local-resume-review.css';

const operationLabels:Record<string,string>={list:'許可した場所の一覧を見る',directory:'新しいフォルダを作る',repo:'空のローカルリポジトリを作る',workspace:'ワークスペースを作成・登録する'};
function ScopeSummary({parent,operations,expiry,expiryNote,draft=false}:{parent:string;operations:string[];expiry:string;expiryNote:string;draft?:boolean}){
 return <dl className="resume-review__summary">
  <div className="resume-review__folder"><dt>どのフォルダを</dt><dd><code dir="ltr">{parent}</code><p>{draft?'表示確認用の入力です。フォルダの存在・安全性は未検証で、まだ許可されていません。':'このフォルダと配下で、選んだ操作だけを許可します。'}</p></dd></div>
  <div><dt>何ができるか</dt><dd><ul>{operations.map(op=><li key={op}>{operationLabels[op]??op}</li>)}</ul>{draft&&<p>希望する操作の下書きです。現在は実行できません。</p>}</dd></div>
  <div><dt>いつまで許可するか</dt><dd><strong>{expiry}</strong><p>{expiryNote}</p></dd></div>
 </dl>;
}
export default function LocalResumeMcp({available=false,ownerExpiresAt,ja=true}:{available?:boolean;ownerExpiresAt?:number;ja?:boolean}={}){
 return available===true?<ActiveLocalResumeMcp ownerExpiresAt={ownerExpiresAt} ja={ja}/>:<InactiveLocalResumeMcp/>;
}
function InactiveLocalResumeMcp(){
 const[open,setOpen]=useState(false),[reviewing,setReviewing]=useState(false),[parent,setParent]=useState(''),[period,setPeriod]=useState('7'),[operations,setOperations]=useState(['list','directory','repo','workspace']);
 const close=()=>{setOpen(false);setReviewing(false);setParent('');setPeriod('7');setOperations(['list','directory','repo','workspace'])};
 return <section className="resume-off" aria-label="Local connection disabled"><h2>ローカルMCP連携</h2>
  <div className="resume-off__notice" role="status"><strong>権限機能はOFFです</strong><p>この画面では接続・許可・資格を作りません。新しい画面の流れを確認できます。</p><p>下書きはこのページ内だけです。入力をConsoleへ送信・保存しません。</p></div>
  {!open?<><button className="resume-off__preview" onClick={()=>setOpen(true)}>画面の流れを確認</button><button disabled title="権限機能がOFFのため開始できません">ローカル連携を始める</button><p>実際の連携開始には、別途機能の有効化と本人による許可が必要です。この画面から有効化はできません。</p></>:<>
   {!reviewing?<div className="resume-off__form"><h3>許可したい内容を入力（下書き）</h3><label>親フォルダ<input aria-label="Draft parent folder" value={parent} autoComplete="off" placeholder="D:\Develop\Allowed" onChange={e=>setParent(e.target.value)}/></label>
    <label>許可したい期間<select aria-label="Draft approval period" value={period} onChange={e=>setPeriod(e.target.value)}><option value="7">7日</option><option value="31">31日</option><option value="none">期限なし（本人が解除するまで）</option></select></label>
    <div className="resume-off__operations">許可したい操作{['list','directory','repo','workspace'].map(op=><label key={op}><input type="checkbox" aria-label={'Draft allow '+op} checked={operations.includes(op)} disabled={op==='list'} onChange={e=>setOperations(e.target.checked?[...operations,op]:operations.filter(v=>v!==op))}/>{operationLabels[op]}</label>)}</div>
    <div className="resume-off__actions"><button disabled={!parent.trim()} onClick={()=>setReviewing(true)}>下書きの確認画面へ</button><button onClick={close}>閉じて入力を破棄</button></div>
   </div>:<div className="resume-review" role="region" aria-label="Unsent permission draft"><header className="resume-review__heading"><p className="resume-review__step">画面の確認のみ・未保存</p><h3>許可内容の確認（下書き）</h3><p>Dots などの対応クライアントへの許可を想定した表示です。現在の接続や許可を示すものではありません。</p></header>
    <ScopeSummary parent={parent} operations={operations} expiry={period==='none'?'期限なし（未承認）':period+'日（未承認）'} expiryNote={period==='none'?'期限なしは、自動終了せず本人が解除するまで許可が続く設定です。現在は許可されていません。':'期間が始まるのは、機能の有効化後に本人が承認した時点です。現在は許可されていません。'} draft/>
    <div className="resume-review__identity"><strong>この下書きでは接続していません</strong><p>接続IDや許可、資格情報は作っていません。実際の接続状態も取得していません。</p></div>
    <div className="resume-review__limits"><h4>許可の範囲を確認</h4><p>有効化後も、選んだ親フォルダと操作だけが対象です。範囲外の操作、既存データの削除・上書き、clone、push・公開、任意コマンド実行は含みません。</p><p>run / history / final本文の共有やPi実行の許可は追加しません。Pi全体をOSで隔離する機能ではありません。</p><h4>許可後の解除について</h4><p>将来許可した連携は、管理画面の接続一覧で解除します。作成済みリポジトリや送信済み本文は削除しません。現在の下書きは許可ではないため、解除操作もありません。</p></div>
    <details className="resume-review__technical"><summary>有効化後の保存方式について</summary><div><p>実際に本人が承認する場合は、用途ごとの資格を分け、Windowsの本人用保護領域へ保存する方式です。現在はOFFなので、資格の生成・保存・配布も、許可の登録も行いません。</p></div></details>
    <label className="resume-review__consent"><input type="checkbox" aria-label="Draft consent unavailable" disabled/><span>権限機能がOFFのため、実際の承認はできません</span></label>
    <div className="resume-review__actions"><button className="resume-review__primary" disabled title="OFFの下書きは許可できません">この内容で許可する</button><button className="resume-review__secondary" onClick={()=>setReviewing(false)}>入力に戻る</button><button className="resume-review__secondary" onClick={close}>閉じて入力を破棄</button></div>
   </div>}
  </>}
 </section>;
}
function ActiveLocalResumeMcp({ownerExpiresAt,ja=true}:{ownerExpiresAt?:number;ja?:boolean}){
 const[open,setOpen]=useState(false),[view,setView]=useState<any>(),[selected,setSelected]=useState(''),[parent,setParent]=useState(''),[period,setPeriod]=useState('7'),[ops,setOps]=useState(['list','directory','repo','workspace']),[review,setReview]=useState<any>(),[confirmed,setConfirmed]=useState(false),[pending,setPending]=useState<string>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 // One install-source selection is shared with the setup panel: the owner
 // configures it once and the same choice renders the renewal command. It is
 // display-only — it never touches a stored request or approval state.
 const[setupSelection,setSetupSelection]=useState<ResumeSetupSelection>({source:'npm',repoRoot:'',nodeCommand:''});
 const{source,repoRoot,nodeCommand}=setupSelection;
 const updateSetup=(patch:Partial<ResumeSetupSelection>)=>setSetupSelection(current=>({...current,...patch}));
 const loginCommand=localOwnerLoginCommand(source==='clone'?{source,repoRoot,...(nodeCommand.trim()?{nodeCommand:nodeCommand.trim()}:{})}:{source});
 const[clock,setClock]=useState(Date.now);
 const ownerFresh=typeof ownerExpiresAt==='number'&&ownerExpiresAt>clock,reviewFresh=!!review&&review.reviewUntil>clock;
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[]);
 const lock=useRef(false),alive=useRef(true),slot='pi-console-resume-request-v1';
 useEffect(()=>{alive.current=true;try{const id=sessionStorage.getItem(slot);if(id){setPending(id);setOpen(true)}}catch{}return()=>{alive.current=false}},[]);
 const request=async(route:string,body:any)=>{const r=await fetch('/local-owner/resume/'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error('request_unavailable');return v};
 const run=async(work:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await work()}catch{if(alive.current)setError('結果を確認できません。保存を再送せず、保存結果を照合してください。')}finally{lock.current=false;if(alive.current)setBusy(false)}};
 const refresh=async()=>{const v=await request('view',{});if(alive.current)setView(v)};
 const remember=(id:string)=>{sessionStorage.setItem(slot,id);setPending(id)};
 const clear=()=>{sessionStorage.removeItem(slot);setPending(undefined)};
 // Pending reconciliation keeps the approval's reviewId so an unconfirmed
 // response can be deterministically closed instead of resent or auto-cleared.
 const approve=()=>run(async()=>{if(!review||!confirmed||pending||!ownerExpiresAt||ownerExpiresAt<=Date.now()||(!Number.isSafeInteger(review.reviewUntil)||review.reviewUntil<=Date.now()))return;const r=review;remember(r.requestId+':'+r.reviewId);setReview(undefined);setConfirmed(false);const v=await request('approve',{reviewId:r.reviewId,requestId:r.requestId,confirmed:true});if(alive.current){setView(v.current);clear()}});
 const revoke=(connectionId:string)=>run(async()=>{if(pending||!view?.revokeRequestId)return;remember(view.revokeRequestId);await request('revoke',{connectionId,requestId:view.revokeRequestId});await refresh();if(alive.current)clear()});
 // New-format pending entries carry `requestId:reviewId` from approve(). A
 // legacy plain id (older tab, or a revoke requestId) only ever reconciles via
 // `result` — it is never offered the discard path, which is approve-only.
 const pendingApproval=pending?.includes(':')?pending.split(':'):undefined;
 const reconcile=async()=>{const v=await request('result',{requestId:pendingApproval?pendingApproval[0]:pending});if(v.state!=='committed')throw Error('unknown');if(alive.current){setView(v.current);clear()}};
 // Fail closed: only an explicit not_committed invalidates the pending review.
 // A committed result adopts it; anything else (unknown state, malformed body)
 // keeps the pending entry so the owner can reconcile instead of resending.
 const discard=async()=>{if(!pendingApproval)return;const v=await request('recover',{requestId:pendingApproval[0],reviewId:pendingApproval[1]});if(v.state==='committed'){if(alive.current){setView(v.current);clear()}return}if(v.state!=='not_committed')throw Error('unknown');if(alive.current){clear();await refresh()}};
 return <section className="resume-active"><p aria-label="Owner verification expiry">本人確認の期限: {typeof ownerExpiresAt==='number'?new Date(ownerExpiresAt).toLocaleString():'未確認'}（10分・自動延長なし）</p>{!ownerFresh&&<div role="alert"><p>本人確認の期限が切れています。Console PC で次のコマンドを自分で実行し、本人確認後に「本人認証の状態を再取得」を押してください。保存結果の照合が必要な場合は、再送せず照合してください。</p><label>更新コマンドの取得元<select aria-label="Renewal command install source" value={source} onChange={e=>updateSetup({source:e.target.value as LocalResumeSource})}><option value="npm">npm パッケージ</option><option value="clone">ローカル clone</option></select></label>{source==='clone'&&<><label>リポジトリの場所<input aria-label="Renewal clone repository root" value={repoRoot} autoComplete="off" placeholder="D:\\Develop\\pi-console" onChange={e=>updateSetup({repoRoot:e.target.value})}/></label><label>Node コマンド（省略時は node）<input aria-label="Renewal clone node command" value={nodeCommand} autoComplete="off" placeholder="node" onChange={e=>updateSetup({nodeCommand:e.target.value})}/></label></>}{loginCommand?<textarea aria-label="Renew owner verification command" readOnly rows={3} value={loginCommand} style={{width:'100%',boxSizing:'border-box'}}/>:<p role="status">clone リポジトリの場所を入力するとコマンドが生成されます。</p>}</div>}<h2>ローカルMCP連携</h2>{!review&&<><p>キーを作る必要はありません。本人が選んだ親フォルダ・操作・期限だけを、Windowsの本人用保護領域へ保存します。既存profileは移行しません。</p>
  <button disabled={busy} onClick={()=>void run(async()=>{setOpen(true);await refresh()})}>ローカル連携を始める</button>
  </>}{open&&<>{!review&&<><ResumeConnectionSetup owner ja={ja} setup={setupSelection} onSetupChange={setSetupSelection}/>
   <p>通常再起動と内部鍵の更新で、承認期限は変わりません。管理画面の本人確認は10分で終了し、保存・復元しません。Piの任意コマンドをOSで隔離する機能ではなく、run/history/final本文やPi実行の許可も追加しません。</p>
   </>}{error&&<p role="alert">{error}</p>}{!review&&<button disabled={busy} onClick={()=>void run(refresh)}>接続一覧を再取得</button>}
   {view&&<>{!review&&<><p role="status">接続 {view.connections.length} 件</p><ul>{view.connections.map((c:any)=><li key={c.connectionId} style={{overflowWrap:'anywhere'}}>{c.name} / {c.connectionId} / {c.state} / {c.parent??'親フォルダ未承認'} / {c.parent?'許可の期限: ':'申請待ちの期限: '}{c.expiresAt===null?'本人が解除するまで':new Date(c.expiresAt).toLocaleString()} {// Runtime-bound entries only accept revoke while connected; a persisted grant
  // that survived a restart shows as approved/expired without a runtime binding
  // and must stay individually revocable — never pending or already revoked.
  (c.state==='connected'||!c.runtimeBound&&(c.state==='approved'||c.state==='expired'&&!!c.parent))&&<button disabled={busy||!!pending} onClick={()=>void revoke(c.connectionId)}>この連携を解除</button>}</li>)}</ul></>}
    {!review&&!pending&&<><label>接続<select aria-label="Resume pending connection" value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}><option value="">接続IDを選択</option>{view.connections.filter((c:any)=>c.state==='pending').map((c:any)=><option key={c.connectionId} value={c.connectionId}>{c.name} / {c.connectionId}</option>)}</select></label>
     <label>許可する親フォルダ<input aria-label="Resume parent folder" value={parent} disabled={busy} placeholder="D:\Develop\Allowed" onChange={e=>setParent(e.target.value)}/></label>
     <label>本人の承認期限<select aria-label="Resume approval period" value={period} disabled={busy} onChange={e=>setPeriod(e.target.value)}><option value="7">7日</option><option value="31">31日</option><option value="none">本人が解除するまで</option></select></label>
     {['list','directory','repo','workspace'].map((op,i)=><label key={op}><input type="checkbox" aria-label={'Resume allow '+op} checked={ops.includes(op)} disabled={busy||op==='list'} onChange={e=>setOps(e.target.checked?[...ops,op]:ops.filter(v=>v!==op))}/>{['許可対象を列挙','新しいディレクトリ','空のlocal repo','workspace作成・登録'][i]}</label>)}
     <button disabled={busy||!selected||!parent||!ownerFresh} onClick={()=>void run(async()=>{if(!ownerExpiresAt||ownerExpiresAt<=Date.now())return;const v=await request('review',{connectionId:selected,parent,operations:ops,period:period==='none'?'none':Number(period)});if(alive.current){setReview(v);setConfirmed(false)}})}>許可内容を確認</button></>}
    {review&&<div className="resume-review"><p aria-label="Review expiry">確認画面の期限: {new Date(review.reviewUntil).toLocaleString()}（最大5分）</p>{!reviewFresh&&<p role="alert">確認画面の期限が切れました。「戻る・取消」から内容を確認し直してください。申請待ちの期限は延長されません。</p>}
     <header className="resume-review__heading"><p className="resume-review__step">許可内容の確認</p><h3>この範囲で連携を始めますか？</h3><p>Dots などの対応クライアントに、次の内容を許可します。</p></header>
     <ScopeSummary parent={review.parent.path} operations={review.operations} expiry={review.expiresAt===null?'期限なし':new Date(review.expiresAt).toLocaleString()} expiryNote={review.expiresAt===null?'自動では終了しません。あなたが解除するまで許可が続きます。':'この日時になると、連携の許可は終了します。'}/>
     <div className="resume-review__identity"><p><strong>接続IDを照合してください</strong><br/>連携先に表示されたIDと、次のIDが一致することを確認します。</p><code dir="ltr">{review.connectionId}</code></div>
     <div className="resume-review__limits"><h4>許可に含まれないこと</h4><p>選んだフォルダの外への操作、既存データの削除・上書き、外部リポジトリの取得（clone）、送信・公開（push）、任意コマンドの実行は許可しません。</p><p>実行・履歴・最終回答（run / history / final）の本文共有や、Pi の実行権限も追加しません。Pi 全体を OS で隔離する機能ではありません。</p><h4>いつでも解除できます</h4><p>この管理画面の接続一覧で「この連携を解除」または「ローカル連携をすべて解除」を選ぶと、以後の接続・作成・登録が止まります。作成済みのリポジトリや送信済みの本文は削除しません。</p><p>連携情報は、この Windows ユーザーの保護された保存先に保存します。キーの入力は不要です。</p></div>
     <details className="resume-review__technical"><summary>保存先と連携の技術的な詳細</summary><div><p>用途ごとの資格とクライアント用の確認情報を自動で作り、Console と対応する連携プログラムの固定保存先へ CurrentUser DPAPI で保護して保存します。</p>{view?.storagePaths&&<dl><div><dt>Console の保存先</dt><dd><code dir="ltr">{view.storagePaths.server}</code></dd></div><div><dt>連携プログラムの保存先</dt><dd><code dir="ltr">{view.storagePaths.client}</code></dd></div></dl>}<p>通常の再起動や短期資格の更新では、ここで承認した期限は変わりません。管理画面の本人確認は10分で終了し、保存・更新しません。</p></div></details>
     <label className="resume-review__consent"><input aria-label="Confirm resumed parent scope" type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/><span>接続IDと、フォルダ・操作・期限・保護保存を確認し、この内容で許可する</span></label>
     <div className="resume-review__actions"><button className="resume-review__primary" disabled={busy||!confirmed||!ownerFresh||!reviewFresh} onClick={()=>void approve()}>この内容で始める</button><button className="resume-review__secondary" disabled={busy} onClick={()=>void run(async()=>{await request('cancel',{reviewId:review.reviewId});setReview(undefined);setConfirmed(false)})}>戻る・取消</button></div>
    </div>}
    {!review&&<><p>解除はこの一覧で行います。以後の接続と作成・登録を止めます。作成済みrepoや送信済み本文は消しません。</p><button disabled={busy||!!pending||!view.connections.length} onClick={()=>void revoke('all')}>ローカル連携をすべて解除</button></>}</>}
   {pending&&<><p role="status">保存結果の照合が必要です。自動再送しません。</p><button disabled={busy} onClick={()=>void run(reconcile)}>保存結果を照合</button>{pendingApproval&&<button disabled={busy} onClick={()=>void run(discard)}>この申請を破棄して入力に戻る</button>}{pendingApproval&&<p>破棄するとこの確認画面の申請は二度と承認できなくなり、入力画面から新しい確認を作り直します。届いていた場合は照合で検出します。</p>}</>}
  </>}
 </section>;
}
