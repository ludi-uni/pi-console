import React,{useState}from'react';
import{localOwnerLoginCommand,localResumeConfig,localResumeClientId}from'./local-resume-config.ts';
export default function ResumeConnectionSetup({owner=false}:{owner?:boolean}={}){
 const[open,setOpen]=useState(false),[format,setFormat]=useState<'codex'|'stdio'>('codex');
 return <section aria-label="Local connection setup instructions">
  <button aria-label="Open local connection instructions" aria-expanded={open} onClick={()=>setOpen(!open)}>本人確認と接続手順</button>
  {open&&<div><p>先に client の設定とツール一覧を確認し、本人が承認できる状態になってから begin_local_connection を呼んでください。初めての起動でローカル受付が閉じている場合は、先に Console PC の本人確認を行います。</p><p>新しく作る申請待ちと復旧情報は固定60分です。再表示や再送では延長しません。以前の申請は元の期限のままです。本人確認10分・確認画面最大5分・承認後の許可期間（初期7日）は別の期限です。</p><p>期限切れの申請は復活しません。cancel_local_connection で元の申請を閉じ、本人が準備できてから別の requestId で申請してください。Console が再起動して受付の世代が変わった場合も、勝手に新規申請しません。</p>
   {!owner?<><h3>1. Console PC で本人確認</h3><p>このページから認証や接続は開始しません。機能の有効化後、Console PC の PowerShell で次を一度実行してください。明示的に yes と答えると本人確認のブラウザーが開きます。</p><textarea aria-label="Local owner login command" readOnly rows={3} value={localOwnerLoginCommand} style={{width:'100%',boxSizing:'border-box'}}/><p>一回用コードは本人の端末だけに表示されます。開いたローカル画面へ本人が入力してください。コードをチャットや接続設定へ貼らないでください。取消・期限切れでは許可されません。別端末のブラウザーだけでは本人確認できません。</p></>:<p>本人確認済みのローカル画面です。管理画面の本人確認には10分の期限があり、接続の承認期間とは別です。</p>}
   <h3>2. 対応するローカル MCP client の設定</h3><label>設定形式<select aria-label="Local MCP client format" value={format} onChange={e=>setFormat(e.target.value as 'codex'|'stdio')}><option value="codex">Codex（TOML）</option><option value="stdio">その他の stdio client（JSON 例）</option></select></label>
   <textarea aria-label="Local MCP launch configuration" readOnly rows={8} value={localResumeConfig(format)} style={{width:'100%',boxSizing:'border-box'}}/>
   <p>これは設定例です。保存・自動登録は行いません。Console PC と同じ Windows 利用者のローカル client で使います。Node と入口ファイルの場所、Console の保存先が一致することを確認してください。独自の PI_CONSOLE_DATA_DIR を使っている場合は client 側も同じ保存先に揃える必要があります。</p>
   <p>Codex は本人の設定に上の TOML を登録して再読込します。既存サーバー設定を上書きしないでください。接続識別子 <code>{localResumeClientId}</code> は再表示しても同じです。別 client を追加する場合だけ別名にしてください。識別子や clientInfo は認証ではありません。</p>
   <p>stdio を起動できない client は、対応するローカル client / host を使ってください。製品ごとの自動 import や接続成功は未確認です。</p>
   <h3>3. 接続 ID と許可内容を照合</h3><p>client で begin_local_connection を呼び、表示された接続 ID を本人画面で照合します。親フォルダ・操作・期限を確認して承認し、client で get_local_connection、list_allowed_parents の順に確認します。応答が途切れたときは同じ requestId で再照合し、新しい要求を作らないでください。取消は cancel_local_connection、許可の解除は本人画面の接続一覧で行います。</p>
   <p>手作りのキーは不要です。親フォルダの許可は Pi 実行や run/history/final 本文の共有を追加しません。本番の有効化と本人の承認が済むまで実接続は始まりません。</p>
   <button onClick={()=>setOpen(false)}>手順を閉じる</button>
  </div>}
 </section>;
}
