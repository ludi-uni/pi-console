import React, { useEffect, useRef, useState } from 'react';
import LocalFolderMcp from './LocalFolderMcp.tsx';
import FioConnection from './FioConnection.tsx';
import LocalResumeMcp from './LocalResumeMcp.tsx';
import WorkspacePermissions from './WorkspacePermissions.tsx';
import './local-owner.css';
import ResumeConnectionSetup from './ResumeConnectionSetup.tsx';
export async function settingsRequest(route: string, body: unknown) {
  const r = await fetch('/api/settings-local-mcp/' + route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pi-console-admin': '1' }, body: JSON.stringify(body) });
  const v = await r.json(); if (!r.ok) throw Error('settings_owner_unavailable'); return v;
}
const terminal = ['registered', 'revoked', 'cancelled', 'expired', 'unavailable', 'noninteractive', 'conflict'];
const states: Record<string, string> = { pending: 'Console PC の確認待ち', registered: '登録済み', revoked: '解除済み', cancelled: '取消済み', expired: '期限切れ', unavailable: '確認できないため未登録', noninteractive: '対話デスクトップがないため未登録', conflict: '同時申請のため未登録', unknown: '結果未確認。再送せず照合してください' };
const visible = (value: string) => JSON.stringify(value).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
export default function SettingsLocalMcp({ja=true}:{ja?:boolean}={}) {
  const text=(en:string,jp:string)=>ja?jp:en;
  const [managementOpen,setManagementOpen]=useState(false),[permissionsOpen,setPermissionsOpen]=useState(false);
  const closeManagement=()=>{setPermissionsOpen(false);setManagementOpen(false);setRevokeConfirmed(false)};
  const [status, setStatus] = useState<any>(), [receipt, setReceipt] = useState<any>(), [pending, setPending] = useState<string>(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [revokeConfirmed, setRevokeConfirmed] = useState(false);
  const lock = useRef(false), alive = useRef(true), slot = 'pi-console-settings-owner-request';
  const refresh = async () => { try { const v = await settingsRequest('status', {}); if (alive.current) setStatus(v); } catch(e) { if(alive.current)setStatus(undefined); throw e; } };
  const run = async (work: () => Promise<void>) => { if (lock.current) return; lock.current = true; setBusy(true); setError(''); try { await work(); } catch { if (alive.current) setError('認証または結果を確認できません。保存した申請IDで照合し、確認できるまで再送しないでください。'); } finally { lock.current = false; if (alive.current) setBusy(false); } };
  const clear = () => { sessionStorage.removeItem(slot); setPending(undefined); };
  const openManagement = () => setManagementOpen(true);
  const inspect = async (requestId: string) => { const v = await settingsRequest('owner-result', { requestId }); if (alive.current) { setReceipt(v); if (terminal.includes(v.state)) clear(); await refresh(); } return v; };
  useEffect(() => { alive.current = true; try { setPending(sessionStorage.getItem(slot) ?? undefined); } catch {} void run(refresh); return () => { alive.current = false; }; }, []);
  // Queries only: navigation/reload/lost responses never create a new request or dialog.
  useEffect(() => {
    if (!pending) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const v = await inspect(pending); if (!stopped && !terminal.includes(v.state) && v.state !== 'unknown') timer = setTimeout(() => void poll(), 1000); }
      catch { if (!stopped && alive.current) setError('登録結果を確認できません。申請IDを保持しています。結果の照合を押してください。'); }
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [pending]);
  return <section className="local-mcp-settings">
    <h3 className="local-mcp-settings__area">{text('New connection: prepare first','新しい連携：まず準備')}</h3>
    <p className="local-mcp-settings__where">{text('You are browsing on your current PC; owner verification and approval dialogs happen on the Console PC where Pi Console runs. No request is created just by opening or moving around this page.','この画面は今見ている PC のブラウザーに表示しています。本人確認や承認のダイアログは、Pi Console が動作する Console PC 側で行います。このページを開いたり移動したりするだけで申請は作られません。')}</p>
    <LocalResumeMcp available={false}/>
    <ResumeConnectionSetup ja={ja} onManage={openManagement}/>
    <h3 className="local-mcp-settings__area">{text('Existing connections and permissions','既存の接続・権限')}</h3>
    <button aria-expanded={managementOpen} aria-controls="existing-connection-management" onClick={()=>managementOpen?closeManagement():setManagementOpen(true)}>{text('Manage existing connections and permissions','既存の接続・権限を管理')}</button>
    {pending&&<><p role="status">{text('An existing request needs result reconciliation. Open the existing management below; the new preview does not replace it.','既存の処理結果の照合が必要です。下の接続管理で照合してください。新しい下書きでは置き換えません。')}</p><button onClick={openManagement}>{text('Reconcile in existing management','接続管理で照合')}</button></>}
    {managementOpen&&<section id="existing-connection-management" aria-label="Existing connection and permissions"><p>設定から本人の接続・親フォルダ・操作・期限・解除を管理します。MCP client と companion は Console PC 上で実行します。別端末の browser から申請する場合も、確認ダイアログは Console PC に表示します。</p>
    {error && <p role="alert">{error}</p>}<button disabled={busy} onClick={() => void run(refresh)}>管理者状態を再取得</button>
    {status && !status.authenticatedOwner && <><p role="status">設定未完了、またはこの Access 利用者は登録済み管理者ではありません。最初の訪問者を自動登録しません。</p>
      {!status.accessConfigured ? <p>署名検証する Access の issuer / AUD が未設定です。登録申請は利用できません。</p> : !status.setupComplete && <><p>登録申請を押すと、Console PC の確認ダイアログに申請ID・検証済み subject・issuer・AUD・期限・Console 世代が表示されます。ご自身の申請と一致する内容を確認し、「この本人を登録」を押して設定に戻ってください。登録は親フォルダの許可や MCP キー発行を伴いません。</p>
        {!status.guiAvailable && <p role="status">Console PC の確認機能が利用できません。未登録のままです。自動承認は行いません。</p>}
        <button disabled={busy || !!pending || !status.guiAvailable || typeof crypto.randomUUID !== 'function'} onClick={() => void run(async () => { const requestId = crypto.randomUUID(); sessionStorage.setItem(slot, requestId); setPending(requestId); await settingsRequest('request-owner', { requestId, confirmed: true }); await inspect(requestId); })}>管理者登録を申請</button>
        {typeof crypto.randomUUID !== 'function' && <p>この browser は登録申請に対応しません。HTTPS または対応 browser を使用してください。</p>}</>}
    </>}
    {pending && <><p role="status" style={{ overflowWrap: 'anywhere' }}>申請 / 結果照合 ID: {pending}</p><button disabled={busy} onClick={() => void run(() => inspect(pending).then(() => {}))}>管理者登録の結果を照合</button><button disabled={busy || receipt?.committing || !['pending', 'unknown'].includes(receipt?.state)} onClick={() => void run(async () => { await settingsRequest('cancel-owner', { requestId: pending }); await inspect(pending); })}>登録申請を取消</button></>}
    {receipt && <div style={{ overflowWrap: 'anywhere' }}><p role="status">登録結果: {states[receipt.state] ?? '確認できません'}{receipt.committing ? '（保存中。結果を照合してください）' : ''}</p>{receipt.subject && <dl><dt>申請ID</dt><dd>{receipt.requestId}</dd><dt>検証済み subject</dt><dd>{visible(receipt.subject)}</dd><dt>Issuer / AUD</dt><dd>{visible(receipt.issuer)} / {visible(receipt.audience)}</dd><dt>期限 (UTC)</dt><dd>{new Date(receipt.expiresAt).toISOString()}</dd><dt>Console 世代</dt><dd>{receipt.generation}</dd></dl>}</div>}
    {status?.authenticatedOwner===true && <><p role="status">署名検証済み Access の登録本人です。毎回 browser 認証を更新し、他の利用者には管理操作を認めません。owner 登録だけでは親フォルダを許可しません。</p><FioConnection apiPrefix="/api/settings-local-mcp/pi-control/" onStart={async()=>{await settingsRequest('start',{})}} transportRequest={settingsRequest}/><LocalFolderMcp apiPrefix="/api/settings-local-mcp/folder/" consoleOrigin={status.consoleOrigin} onStart={async () => { await settingsRequest('start', {}); await refresh(); }}/>
      <label><input aria-label="Confirm owner removal" type="checkbox" checked={revokeConfirmed} onChange={e => setRevokeConfirmed(e.target.checked)}/>管理者登録とすべての接続許可を解除する。作成済み repo と送信済み本文は残る。</label><button disabled={busy || !!pending || !revokeConfirmed || typeof crypto.randomUUID !== 'function'} onClick={() => void run(async () => { const requestId = crypto.randomUUID(); sessionStorage.setItem(slot, requestId); setPending(requestId); await settingsRequest('revoke-owner', { requestId, confirmed: true }); await inspect(requestId); setRevokeConfirmed(false); })}>管理者登録を解除</button>
    </>}
    <div><button aria-expanded={permissionsOpen} onClick={()=>setPermissionsOpen(!permissionsOpen)}>{text('Review workspace and session permissions','ワークスペース・セッションの権限を確認／変更')}</button>
      <p>{text('This manages the existing workspace/session scope as a whole. Parent folder permission adds no Pi control or run/history/final sharing. Final text requires its own exact approval.','既存workspace/session権限全体を管理します。親フォルダの許可ではPi制御やrun/history/final本文の共有は追加しません。final本文は別の対象確認と承認が必要です。')}</p>
      {permissionsOpen&&<><button onClick={()=>setPermissionsOpen(false)}>{text('Back to connection management','接続管理に戻る')}</button><WorkspacePermissions ja={ja} embedded={true}/></>}
    </div>
    <button onClick={closeManagement}>{text('Back to new connection screen','新しい連携画面に戻る')}</button>
    </section>}
  </section>;
}
