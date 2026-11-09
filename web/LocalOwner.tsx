import React, { useEffect, useRef, useState } from 'react';
import WorkspacePermissions from './WorkspacePermissions.tsx';
import LocalResumeMcp from './LocalResumeMcp.tsx';
import OwnerRegistration from './OwnerRegistration.tsx';
import FioConnection from './FioConnection.tsx';
import SettingsSpeech from './SettingsSpeech.tsx';
import { MCP_RELEASE_ENABLED } from '../shared/release-availability.mjs';
import './local-owner.css';
export default function LocalOwner() {
  const [authenticated, setAuthenticated] = useState(false), [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState<any>(), [advanced, setAdvanced] = useState(false);
  const lock = useRef(false);
  const request = async (route: string, body: any) => { const r = await fetch('/local-owner/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const v = await r.json(); if (!r.ok) throw Object.assign(Error('owner_request_unavailable'), { status: r.status }); return v; };
  const run = async (work: () => Promise<void>) => { if (lock.current) return; lock.current = true; setBusy(true); setError(''); try { await work(); } catch { setError('認証または結果を確認できません。コードは自動再送せず、状態を再読取してください。'); } finally { lock.current = false; setBusy(false); } };
  const refresh = async (initial = false) => { try { const v = await request('auth/status', {}); setAuthenticated(true); setStatus(v); } catch (e) { setAuthenticated(false); if (!initial || (e as any).status !== 401) throw e; } };
  useEffect(() => { void run(() => refresh(true)); }, []);
  return <main className="local-owner"><h1>Pi Console ローカル本人管理</h1><p>信頼する launcher で本人が明示して発行した一回コードを入力します。MCP を Cloudflare に公開しません。</p>
    {error && <p role="alert">{error}</p>}<button disabled={busy} onClick={() => void run(() => refresh())}>本人認証の状態を再読取</button>
    {!authenticated ? <section><label>一回 bootstrap コード<input aria-label="One-time bootstrap code" type="password" autoComplete="off" spellCheck={false} value={code} onChange={e => setCode(e.target.value)}/></label><button disabled={busy || !code} onClick={() => void run(async () => { const entered = code; setCode(''); await request('auth/claim', { code: entered }); await refresh(); })}>一回コードでログイン</button><p>コードはこのローカル画面だけに入力してください。URL・チャットには載せません。</p></section> : <>
      <p role="status">本人確認済み / {new Date(status.expiresAt).toLocaleString()} まで</p>
      <button disabled={busy} onClick={() => void run(async () => { await request('auth/logout', {}); setAuthenticated(false); setCode(''); setAdvanced(false); })}>本人管理からログアウト</button>
      <OwnerRegistration/>
      {MCP_RELEASE_ENABLED===true&&<LocalResumeMcp available={status.resumeAvailable===true} ownerExpiresAt={status.expiresAt} ja={true}/>}
      <SettingsSpeech owner={true} ownerExpiresAt={status.expiresAt} ja={true}/>
      {MCP_RELEASE_ENABLED===true&&<FioConnection/>}
      {MCP_RELEASE_ENABLED===true&&<button onClick={() => setAdvanced(!advanced)}>{advanced ? '既存の個別権限を閉じる' : '既存の exact read/control/final 権限を見る'}</button>}
      {MCP_RELEASE_ENABLED===true&&advanced && <WorkspacePermissions ja={true} apiPrefix="/local-owner/api/"/>}
    </>}
  </main>;
}
