import React, { useEffect, useRef, useState } from 'react';
import ExpiryCountdown from './ExpiryCountdown.tsx';
export default function LocalFolderMcp({apiPrefix='/local-owner/folder/',consoleOrigin,onStart}:{apiPrefix?:string;consoleOrigin?:string;onStart?:()=>Promise<void>} = {}) {
  const [open, setOpen] = useState(false), [view, setView] = useState<any>(), [selected, setSelected] = useState(''), [parent, setParent] = useState(''), [minutes, setMinutes] = useState('480'), [duration, setDuration] = useState('480'), [ops, setOps] = useState(['list', 'directory', 'repo', 'workspace']), [review, setReview] = useState<any>(), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [pending, setPending] = useState<string>();
  const lock = useRef(false), alive = useRef(true), slot = 'pi-console-folder-save-request:' + apiPrefix;
  const request = async (route: string, body: any) => { const r = await fetch(apiPrefix + route, { method: 'POST', headers: { 'content-type': 'application/json', ...(apiPrefix.startsWith('/api/') ? {'x-pi-console-admin':'1'} : {}) }, body: JSON.stringify(body) }); const v = await r.json(); if (!r.ok) throw Error(v.error); return v; };
  const run = async (work: () => Promise<void>) => { if (lock.current) return; lock.current = true; setBusy(true); setError(''); try { await work(); } catch (e) { if (alive.current) setError(e instanceof Error && e.message === 'safe_folder_provider_unavailable' ? '安全な親フォルダ provider が未実装です。実際の許可・作成は停止しています。' : '結果を確認できません。保存結果を照合してください。自動再送はしません。'); } finally { lock.current = false; if (alive.current) setBusy(false); } };
  const refresh = async () => { const v = await request('status', {}); if (alive.current) setView(v); };
  useEffect(() => { alive.current = true; try { const p = sessionStorage.getItem(slot); if (p) { setPending(p); setOpen(true); } } catch {} return () => { alive.current = false; }; }, []);
  const clearPending = () => { sessionStorage.removeItem(slot); setPending(undefined); };
  const save = () => run(async () => {
    if (!review || !confirmed || pending) return;
    // Fail before mutation when durable tab recovery is unavailable.
    sessionStorage.setItem(slot, review.requestId); setPending(review.requestId);
    const r = review; setReview(undefined); setConfirmed(false);
    const v = await request('approve', { reviewId: r.reviewId, requestId: r.requestId, confirmed: true });
    if (alive.current) { setView(v.current); clearPending(); }
  });
  const revoke = () => run(async () => {
    if (pending) return;
    const requestId = view?.revokeRequestId; if (!requestId) throw Error('request_id_unavailable');
    sessionStorage.setItem(slot, requestId); setPending(requestId);
    const v = await request('revoke', { connectionId: 'all', requestId });
    if (alive.current) { setView(v.current); clearPending(); setReview(undefined); setConfirmed(false); }
  });
  const configuration = JSON.stringify({ mcpServers: { 'pi-console-folders': { command: 'node', args: ['D:\\Develop\\pi-console\\package\\local-folder-mcp.mjs', ...(consoleOrigin ? [consoleOrigin, '--discover'] : [location.origin + '/local-owner/'])] } } }, null, 2);
  return <section><h2>ローカル MCP 連携</h2><p>キーを3本作る必要はありません。本人の browser 確認後、接続ごとに親フォルダと操作を許可します。</p>
    <button disabled={busy} onClick={() => void run(async () => { setOpen(true); if(onStart) await onStart(); await refresh(); })}>ローカル連携を始める</button>
    {open && <><p>stdio のコマンド起動を設定できる MCP client 用です。client 名は認証に使いません。client の初期接続は承認を最大5分待ちます。待機・stdio 設定に非対応の client は、対応 client でこの設定を登録してください。個々の製品の互換性は未確認です。</p>
      <details><summary>初回だけ: MCP client の起動設定</summary><label>非秘密の stdio 設定<textarea aria-label="MCP stdio configuration" rows={8} readOnly value={configuration} style={{ width: '100%', boxSizing: 'border-box' }}/></label>
      <p>JSON は設定例です。client ごとに書式が異なります。stdio の起動設定にコマンド node と表示された引数を登録します。自動 import や製品ごとの動作は未確認です。固定 Console アドレスから接続時に port を取得するので、再起動ごとの設定変更は不要です。</p></details>
      <p>Console 管理 API の境界です。Pi の任意コマンドを OS で隔離しません。run/history/final 本文の公開や session 操作は付与せず、既存の exact read/control/final 承認は別です。</p>
      {error && <p role="alert">{error}</p>}<button disabled={busy} onClick={() => void run(refresh)}>接続一覧を再読取</button>
      {view && <><p role="status">provider: {view.provider} / 接続 {view.connections.length} 件</p>{view.provider === 'unavailable' && <p>安全な親フォルダ provider がないため実際の許可・作成は拒否します。</p>}
        <ul>{view.connections.map((c: any) => <li key={c.connectionId} style={{ overflowWrap: 'anywhere' }}>{c.name} / {c.state} / {c.parent ?? '親フォルダ未許可'} / 許可: <ExpiryCountdown expiresAt={c.expiresAt}/> / 接続: <ExpiryCountdown expiresAt={c.connectionExpiresAt}/></li>)}</ul>
        {!review && !pending && <><label>接続<select aria-label="Pending MCP connection" value={selected} disabled={busy} onChange={e => { setSelected(e.target.value); setConfirmed(false); }}><option value="">選択してください</option>{view.connections.filter((c: any) => c.state === 'pending').map((c: any) => <option key={c.connectionId} value={c.connectionId}>{c.name} / {c.connectionId}</option>)}</select></label>
          <label>許可する親フォルダ<input aria-label="Allowed parent folder" value={parent} disabled={busy} placeholder="D:\Develop\Allowed" onChange={e => setParent(e.target.value)}/></label>
          <label>許可期間<select aria-label="Parent grant duration" value={duration} disabled={busy} onChange={e=>{setDuration(e.target.value);setConfirmed(false);if(!['none','custom'].includes(e.target.value))setMinutes(e.target.value)}}><option value="60">1時間</option><option value="480">8時間</option><option value="1440">24時間</option><option value="custom">分で指定</option><option value="none">期限なし（この親フォルダ・操作だけ）</option></select></label>
          {duration!=='none'&&<label>期限（分）<input aria-label="Parent grant minutes" type="number" min={1} max={1440} value={minutes} disabled={busy} onChange={e=>{setMinutes(e.target.value);setDuration('custom');setConfirmed(false)}}/></label>}
          <p>期限なしは本人がこの接続の限定フォルダ・操作に許可した場合だけです。解除またはConsole停止で終了します。認証済み接続とTunnelは最大8時間で、認証の期限が先なら短縮されます。期限なしでも認証を延ばさず、再接続へ自動で引き継ぎません。</p>
          {(['list', 'directory', 'repo', 'workspace'] as const).map((op, i) => <label key={op}><input type="checkbox" aria-label={'Allow ' + op} checked={ops.includes(op)} disabled={busy || op === 'list'} onChange={e => setOps(e.target.checked ? [...ops, op] : ops.filter(v => v !== op))}/>{['許可対象の列挙', '新しい子ディレクトリ', '新しい local repo（固定仕様の初期化のみ）', '新しい workspace 作成・登録'][i]}</label>)}
          <button disabled={busy || !selected || !parent} onClick={() => void run(async () => { const n=Number(minutes);if(duration!=='none'&&(!Number.isSafeInteger(n)||n<1||n>1440))throw Error('invalid_duration');const r = await request('review', { connectionId: selected, parent, operations: ops, expiresAt: duration==='none'?null:Date.now() + n * 60000, ...(duration==='none'?{noExpiry:true}:{}) }); if (alive.current) { setReview(r); setConfirmed(false); } })}>許可内容を確認</button></>}
        {review && <><h3>接続の最終確認</h3><p>期限なしはこの親フォルダ・操作の許可だけです。認証済み接続は最大8時間で、認証期限が先なら短縮されます。既存の許可を延長しません。</p><p style={{ overflowWrap: 'anywhere' }}>接続 ID: {review.connectionId}<br/>{review.parent.path} / {review.operations.join(', ')} / <ExpiryCountdown expiresAt={review.expiresAt}/><br/>この内容の確認期限: <ExpiryCountdown expiresAt={review.reviewUntil}/></p><p>client の起動ログに示された非秘密の接続 ID と一致することを確認してください。ログを確認できない client の連携は未確認です。既存データの削除・上書き、clone URL、push・公開、任意 command 初期化を含みません。credential は用途別に内部生成し、メモリだけに保持します。</p>
          <label><input aria-label="Confirm parent scope" type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)}/>接続 ID の一致と、この親フォルダ・操作・期間（期限なしを選んだ場合も含む）を本人として許可する</label>
          <button disabled={busy || !confirmed} onClick={() => void save()}>許可して接続</button>
          <button disabled={busy} onClick={() => void run(async () => { await request('cancel', { reviewId: review.reviewId }); setReview(undefined); setConfirmed(false); })}>戻る・取消</button></>}
        <p>解除はこの画面で行います。以後の接続と管理操作を止めます。作成済み repo や送信済み本文は消しません。Console restart でも接続は失効します。</p>
        <button disabled={busy || !!pending || !view.connections.length} onClick={() => void revoke()}>このローカル連携をすべて解除</button></>}
      {pending && <><p role="status">保存結果を照合するまで再送しません。すでに保存されていた場合、取消は許可を取り消しません。解除ボタンを使ってください。</p><button disabled={busy} onClick={() => void run(async () => { const v = await request('result', { requestId: pending }); if (v.state === 'unknown') throw Error(); setView(v.current); clearPending(); })}>保存結果を照合</button><button disabled={busy} onClick={() => void run(async () => { const v = await request('abandon', { requestId: pending }); setView(v.current); clearPending(); })}>未保存だった場合だけ取消</button></>}
    </>}
  </section>;
}
