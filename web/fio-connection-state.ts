export interface FioStep {code:string;title:string;next:string}
const step=(code:string,title:string,next:string):FioStep=>({code,title,next});
export function fioConnectionStep(s:any):FioStep {
 if(s.error||!s.control||!Array.isArray(s.control.candidates?.items))return step('unverified','状態を確認できません','状態を再取得してください。完了や接続済みとは扱いません。');
 const candidates=s.control.candidates?.items??[],workspace=candidates.find((w:any)=>w.id===s.workspaceId),session=workspace?.sessions.find((v:any)=>v.id===s.sessionId);
 const active=(s.control.connections??[]).find((c:any)=>c.state==='connected'&&c.expiresAt>s.now);
 if(active){const t=active.target,actual=candidates.find((w:any)=>w.id===t?.workspaceId)?.sessions.find((v:any)=>v.id===t?.sessionId&&v.state==='observed'&&v.generation===t?.generation);if(!actual||t?.instance!==s.control.instance||t?.revision!==s.control.snapshot?.revision||workspace&&t.workspaceId!==workspace.id||session&&(t.sessionId!==session.id||t.generation!==session.generation))return step('binding_mismatch','対象・接続先の一致を確認できません','既存接続を変更せず、対象と連携先を確認してください。');
  if(s.pathway!=='stdio'){const transfer=s.transport?.active;if(transfer&&transfer.app!=='pi-console-echo-test')return step('binding_mismatch','接続先が対象のAppと一致しません','既存接続を変更せず、接続先を確認してください。');if(!transfer||transfer.state!=='tunnel-ready'||transfer.leaseUntil<=s.now)return step('approved_disconnected','許可済み・転送の再確認が必要です','操作許可は残っています。転送を照合し、再接続は本人の明示で行います。');}
  return Number.isSafeInteger(active.confirmedAt)&&active.confirmedAt>=0?step('connected','接続確認済み','選んだ対象への確認が連携先から届きました。指示の実行は別の操作です。'):step('await_client','許可済み・連携先の確認待ち','フィオに同じ申請の結果照合と対象の確認を依頼してください。');}
 if(s.preparation&&['unknown','preparing','uncertain'].includes(s.preparation.state))return step('preparation_unconfirmed','準備の結果を確認中','同じ照合の結果を再取得してください。準備を重複実行しません。');
 if(s.control.candidates?.total===0)return step('no_workspaces','登録済みワークスペースがありません','Consoleの通常画面で既存フォルダを登録してから戻ってください。この接続で自動作成しません。');
 if(!workspace)return step('choose_workspace','つなぐワークスペースを選んでください','登録済みの対象を選びます。未準備の対象も理由付きで表示します。');
 if(!workspace.preparable)return step('workspace_blocked','このワークスペースは準備できません','下の理由を確認してください。安全性や読み取りの確認が取れるまで許可しません。');
 if(workspace.status==='sessions_missing')return step('prepare_new','このワークスペースにセッションがありません','本人のボタン操作で新しいセッションを準備できます。指示は送信しません。');
 if(!session)return step('choose_session','使用するセッションを選んでください','既存セッションを選び、未起動なら同じ画面で準備します。');
 if(session.state!=='observed')return session.preparable?step('prepare_existing','選んだセッションの準備が必要です','本人のボタン操作で既存セッションを起動し、現在の対象を確認します。'):step('session_unconfirmed','このセッションの状態を確認できません','起動・終了処理中、または読み取りの確認が取れていない状態です。再取得して確認し、重複起動しません。');
 if(s.pathway!=='stdio'){
  const t=s.transport?.active;
  if(t&&t.app!=='pi-console-echo-test')return step('binding_mismatch','接続先が対象のAppと一致しません','既存接続を変更せず、pi-console-echo-testの接続先を確認してください。');
  if(t&&(!['tunnel-ready','expired','stopped','cancelled'].includes(t.state)||t.leaseUntil<=s.now))return step('transport_unconfirmed',t.state==='input-open'?'PCの入力画面で確認待ち':'転送の状態を確認中','同じ申請を照合してください。帰属不明や停止未確認なら新規起動しません。');
  if(!t||t.state!=='tunnel-ready')return step('transport_needed','フィオまでの接続準備が必要です','同じ画面の接続方法を確認してください。親フォルダやPi操作の許可とは別です。');
 }
 const connections=s.control.connections??[],pending=connections.filter((c:any)=>c.state==='pending'&&c.expiresAt>s.now);
 if(!pending.length){if(connections.some((c:any)=>c.state==='expired'||c.state==='pending'&&c.expiresAt<=s.now))return step('request_expired','前の申請は期限切れです','対象の準備は残ります。フィオに新しい接続申請を依頼してください。');
  return s.catalogHelp?step('catalog_required','連携先の再検出が必要です','既存Appの接続を再検出し、新しい申請toolが見えるか確認してください。'):step('request_wait','フィオ側の接続申請待ち','フィオに「Pi連携の接続申請をして」と依頼し、この画面で状態を再取得してください。');}
 if(!pending.some((c:any)=>c.connectionId===s.connectionId))return step('choose_request','接続する申請を選んでください','本人が依頼した申請の照合コードを一致させます。');
 return step('review_ready','対象と許可内容を確認できます','下の対象・操作・Pi操作期限を確認し、最終確認へ進んでください。');
}
