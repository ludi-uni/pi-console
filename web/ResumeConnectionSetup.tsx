import React,{useState}from'react';
import{localOwnerLoginCommand,localResumeConfig,localResumeClientId,localResumePackage}from'./local-resume-config.ts';
import type{LocalResumeSource}from'./local-resume-config.ts';
import'./resume-connection-setup.css';
export interface ResumeSetupSelection{source:LocalResumeSource;repoRoot:string;nodeCommand:string}
export default function ResumeConnectionSetup({owner=false,ja=true,onManage,setup:shared,onSetupChange}:{owner?:boolean;ja?:boolean;onManage?:()=>void;setup?:ResumeSetupSelection;onSetupChange?:(next:ResumeSetupSelection)=>void}={}){
 const[open,setOpen]=useState(false),[format,setFormat]=useState<'codex'|'stdio'>('codex'),[local,setLocal]=useState<ResumeSetupSelection>({source:'npm',repoRoot:'',nodeCommand:''});
 // When the parent supplies setup/onSetupChange the selection is shared so a
 // sibling display (e.g. the owner-verification renewal command) shows the
 // same install source the owner just configured.
 const selection=shared??local;
 const update=(patch:Partial<ResumeSetupSelection>)=>{const next={...selection,...patch};if(onSetupChange)onSetupChange(next);else setLocal(next)};
 const{source,repoRoot,nodeCommand}=selection;
 const setup={source,...(source==='clone'?{repoRoot,...(nodeCommand.trim()?{nodeCommand:nodeCommand.trim()}:{})}:{})};
 const loginCommand=localOwnerLoginCommand(setup),resumeConfig=localResumeConfig(format,setup),cloneMissing=source==='clone'&&!repoRoot.trim();
 const text=(en:string,jp:string)=>ja?jp:en;
 return <section className="resume-setup" aria-label="Local connection setup instructions">
  <button aria-label="Open local connection instructions" aria-expanded={open} onClick={()=>setOpen(!open)}>{text('Preparation and connection steps','準備・接続の手順')}</button>
  {open&&<div className="resume-setup__body">
   <p>{text('Prepare the local client and its tool list first; call begin_local_connection only when the owner can approve it on the Console PC. This panel only shows the steps — it does not create a request, start an authentication, or connect anything. If the local service is off on first launch, run owner verification on the Console PC first.','先にローカル client の設定とツール一覧を確認し、本人が Console PC で承認できる状態になってから begin_local_connection を呼んでください。このパネルは手順の案内だけで、申請・認証・接続は開始しません。初めての起動でローカル受付が閉じている場合は、先に Console PC の本人確認を行います。')}</p>
   {!owner&&onManage&&<><p role="status">{text('An existing request may already be waiting for result reconciliation. Open the existing management below; this preview does not replace it.','既存の申請が結果照合待ちの場合があります。下の既存管理を開いてください。この手順表示は照合を置き換えません。')}</p><button onClick={onManage}>{text('Open existing connection management','既存の接続管理を開く')}</button></>}
   {!owner&&!onManage&&<p>{text('If an earlier request is still unreconciled, check its result in the existing management before starting a new one.','以前の申請が未照合の場合は、新しい申請の前に既存管理で結果を確認してください。')}</p>}
   <p>{text('New requests and recovery information expire after a fixed 60 minutes; reopening or resending does not extend them. Earlier requests keep their original expiry. Owner verification (10 minutes), the confirmation screen (max 5 minutes) and the approval period (initial 7 days) are separate deadlines.','新しく作る申請待ちと復旧情報は固定60分です。再表示や再送では延長しません。以前の申請は元の期限のままです。本人確認10分・確認画面最大5分・承認後の許可期間（初期7日）は別の期限です。')}</p>
   <p>{text('An expired request cannot be revived. Close it with cancel_local_connection, then apply with a new requestId once the owner is ready. If the Console restarts and the reception generation changes, a new request is not created automatically.','期限切れの申請は復活しません。cancel_local_connection で元の申請を閉じ、本人が準備できてから別の requestId で申請してください。Console が再起動して受付の世代が変わった場合も、勝手に新規申請しません。')}</p>
   {!owner?<details className="resume-setup__step"><summary>{text('Step 1 — Verify your identity on the Console PC','手順1 — Console PC で本人確認')}</summary><div>
    <p>{text('This page does not start authentication or a connection. This page runs on the PC you are viewing now, which may differ from the Console PC where Pi Console runs. After the feature is enabled, run the following once in PowerShell on the Console PC. Answering yes opens the owner verification browser window.','このページから認証や接続は開始しません。このページは今見ている PC 上で動き、Pi Console が動作する Console PC とは別の場合があります。機能の有効化後、Console PC の PowerShell で次を一度実行してください。明示的に yes と答えると本人確認のブラウザーが開きます。')}</p>
    {loginCommand?<textarea aria-label="Local owner login command" readOnly rows={3} value={loginCommand} style={{width:'100%',boxSizing:'border-box'}}/>:<p role="alert">{text('Enter the clone repository root below to generate the command.','下の clone リポジトリの場所を入力するとコマンドが生成されます。')}</p>}
    <p>{text('The one-time code is shown only on the owner’s device; enter it on the local screen that opened. Do not paste the code into chat or connection settings. Cancelled or expired verification is not accepted. Verification cannot be completed from another device’s browser alone.','一回用コードは本人の端末だけに表示されます。開いたローカル画面へ本人が入力してください。コードをチャットや接続設定へ貼らないでください。取消・期限切れでは許可されません。別端末のブラウザーだけでは本人確認できません。')}</p>
   </div></details>:<details className="resume-setup__step"><summary>{text('Step 1 — Owner verification (done on this PC)','手順1 — 本人確認（この PC で完了）')}</summary><div><p>{text('This is the owner-verified local screen on the Console PC. Owner verification for this management screen expires after 10 minutes; it is separate from the connection approval period.','これは Console PC 上の本人確認済みローカル画面です。管理画面の本人確認には10分の期限があり、接続の承認期間とは別です。')}</p></div></details>}
   <details className="resume-setup__step"><summary>{text('Step 2 — Configure the local MCP client','手順2 — ローカル MCP client の設定')}</summary><div>
    <label>{text('Install source','取得元')}<select aria-label="Local MCP install source" value={source} onChange={e=>update({source:e.target.value as LocalResumeSource})}><option value="npm">{text(`npm package (${localResumePackage})`,`npm パッケージ（${localResumePackage}）`)}</option><option value="clone">{text('Local repository clone','ローカル clone（開発用）')}</option></select></label>
    {source==='npm'?<p>{text('Uses the published package through npx; no checkout paths are written into the config. The local-resume CLI command ships with the next package release.','公開パッケージを npx 経由で使います。設定にチェックアウトのパスは書き込まれません。local-resume コマンドは次回パッケージ公開後に利用できます。')}</p>:<>
     <label>{text('Repository root (on the Console PC)','リポジトリの場所（Console PC 上）')}<input aria-label="Local clone repository root" value={repoRoot} autoComplete="off" placeholder="D:\\Develop\\pi-console" onChange={e=>update({repoRoot:e.target.value})}/></label>
     <label>{text('Node command (optional; default: node)','Node コマンド（省略時は node）')}<input aria-label="Local clone node command" value={nodeCommand} autoComplete="off" placeholder="node" onChange={e=>update({nodeCommand:e.target.value})}/></label>
     {cloneMissing&&<p role="status">{text('A configuration is generated only after the repository root is entered.','リポジトリの場所を入力すると設定が生成されます。')}</p>}
    </>}
    <label>{text('Configuration format','設定形式')}<select aria-label="Local MCP client format" value={format} onChange={e=>setFormat(e.target.value as 'codex'|'stdio')}><option value="codex">{text('Codex (TOML)','Codex（TOML）')}</option><option value="stdio">{text('Other stdio client (JSON example)','その他の stdio client（JSON 例）')}</option></select></label>
    {resumeConfig?<textarea aria-label="Local MCP launch configuration" readOnly rows={8} value={resumeConfig} style={{width:'100%',boxSizing:'border-box'}}/>:<p role="alert">{text('No configuration to copy: enter the clone repository root first.','コピーできる設定はまだありません。先に clone リポジトリの場所を入力してください。')}</p>}
    <p>{text('This is a configuration example only — it is not saved or registered automatically. Use it in a local client running as the same Windows user as the Console PC. Confirm the Node and entry file locations, and the Console data directory, match. If you use a custom PI_CONSOLE_DATA_DIR, point the client at the same location.','これは設定例です。保存・自動登録は行いません。Console PC と同じ Windows 利用者のローカル client で使います。Node と入口ファイルの場所、Console の保存先が一致することを確認してください。独自の PI_CONSOLE_DATA_DIR を使っている場合は client 側も同じ保存先に揃える必要があります。')}</p>
    <p>{text('For Codex, register the TOML above in your own configuration and reload; do not overwrite existing server settings. The connection identifier ','Codex は本人の設定に上の TOML を登録して再読込します。既存サーバー設定を上書きしないでください。接続識別子 ')}<code>{localResumeClientId}</code>{text(' stays the same across displays; rename it only when adding a different client. The identifier and clientInfo are not authentication.',' は再表示しても同じです。別 client を追加する場合だけ別名にしてください。識別子や clientInfo は認証ではありません。')}</p>
    <p>{text('For a client that cannot launch stdio, use a compatible local client / host. Automatic import or connection success per product is unverified.','stdio を起動できない client は、対応するローカル client / host を使ってください。製品ごとの自動 import や接続成功は未確認です。')}</p>
   </div></details>
   <details className="resume-setup__step"><summary>{text('Step 3 — Match the connection ID and permitted scope','手順3 — 接続 ID と許可内容を照合')}</summary><div>
    <p>{text('Call begin_local_connection from the client, then match the displayed connection ID on the owner screen on the Console PC. Review the parent folder, operations and expiry, then approve. On the client, run get_local_connection and then list_allowed_parents to confirm. If the response is interrupted, reconcile with the same requestId — do not create a new request. Cancel with cancel_local_connection; revoke a granted permission from the connection list on the owner screen.','client で begin_local_connection を呼び、表示された接続 ID を Console PC の本人画面で照合します。親フォルダ・操作・期限を確認して承認し、client で get_local_connection、list_allowed_parents の順に確認します。応答が途切れたときは同じ requestId で再照合し、新しい要求を作らないでください。取消は cancel_local_connection、許可の解除は本人画面の接続一覧で行います。')}</p>
    <p>{text('No hand-made keys are needed. Parent-folder permission does not add Pi execution or run/history/final body sharing. No actual connection starts until the feature is enabled and the owner approves.','手作りのキーは不要です。親フォルダの許可は Pi 実行や run/history/final 本文の共有を追加しません。本番の有効化と本人の承認が済むまで実接続は始まりません。')}</p>
   </div></details>
   <details className="resume-setup__step"><summary>{text('Step 4 — Reconcile the result','手順4 — 結果を照合')}</summary><div>
    <p>{text('If a response was lost or interrupted, reconcile the stored requestId instead of resending. Navigation or reloading this screen never creates a new request.','応答が失われた・中断した場合は、再送せず保存した requestId で照合してください。この画面の移動や再読込で新しい申請は作られません。')}</p>
   </div></details>
   <button onClick={()=>setOpen(false)}>{text('Close the steps','手順を閉じる')}</button>
  </div>}
 </section>;
}
