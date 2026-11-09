// Trusted HTML preview shell — the only UI that ever receives workspace
// JS/CSS for execution. Consent flow:
//   1. Mount POSTs review {workspaceId, path} (read-only) and shows the file
//      manifest the user must verify — names, sizes, SHA-256, scope and TTL.
//   2. CSS/JS checkboxes stay OFF. Only after the explicit confirmation
//      checkbox plus the enable button does the shell POST enable
//      {reviewId, allowScripts, allowStyles, confirmed:true}.
//   3. The one-shot grant's resources render through an opaque sandboxed
//      srcdoc frame (see html-preview-rendering.ts). Revoke removes the iframe
//      before the server call; expiry uses timer + visibilitychange/pagehide.
// Re-show/reload never re-sends enable; a new review + confirmation is always
// required. All requests are same-origin POST JSON with credentials default —
// no GET, no external resource, no cookie/CORS relaxation exists.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { PreviewGrant, PreviewReview } from '../shared/html-preview.ts';
import { buildPreviewDocument, isPreviewRenderLimit, type PreviewRenderResult } from './html-preview-rendering.ts';

interface PreviewParams { workspaceId: string; path: string }
interface PostError extends Error { status?: number; code?: string }

async function postPreview<T>(route: string, body: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/workspace/preview/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal,
    // keepalive lets the revoke POST complete even while the tab is unloading.
    keepalive: true,
  });
  if(!response.headers.get('content-type')?.includes('application/json'))throw Object.assign(new Error('preview_identity_required'),{code:'preview_identity_required',status:401});
  let value: { error?: string } & T = {} as { error?: string } & T;
  try { value = await response.json(); } catch { /* non-JSON body stays empty */ }
  if (!response.ok) {
    const error: PostError = Object.assign(new Error(value.error ?? `HTTP ${response.status}`), { status: response.status, code: value.error });
    throw error;
  }
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('preview_invalid_response');
  return value;
}

/** Stable Japanese explanation for each backend consent error code. */
function describeError(error: unknown): string {
  const code = (error as PostError)?.code ?? '';
  const status = (error as PostError)?.status;
  if (status === 401 || code === 'preview_identity_required') return '認証が必要です。Console にサインインし直してください。';
  if (code === 'preview_identity_expired' || code === 'preview_identity_mismatch') return '認証の有効期限または主体が一致しません。再読込して最初から確認してください。';
  if (code === 'preview_review_unavailable') return '確認の有効期限が切れました。最初から確認し直してください。';
  if (code === 'preview_grant_unavailable') return 'この実行許可はすでに失効しています。';
  if (code === 'preview_changed' || code === 'preview_unavailable') return 'ファイルが変更または削除されました。安全のため最初から確認し直してください。';
  if (code === 'preview_review_limit') return '同時に確認できる件数の上限です。約 2 分待ってから確認し直してください。';
  if (code === 'preview_grant_limit') return '同時実行許可の上限です。ほかの許可を取り消すか、期限が切れてから確認し直してください。';
  if (code === 'preview_scan_limit' || code === 'preview_resource_limit') return '対象が上限を超えています。専用フォルダーに HTML と必要な JS/CSS をまとめ、ファイル数・サイズを減らしてください。';
  if (code === 'preview_not_html') return 'HTML ファイルではないためプレビューできません。';
  if (isPreviewRenderLimit(error)) return '展開後のサイズが上限を超えたため、プレビューを中止しました。';
  return 'プレビュー要求を処理できませんでした。';
}

const formatBytes = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const formatClock = (ms: number): string => ms >= 120000 ? `${Math.ceil(ms / 60000)} 分` : `${Math.max(0, Math.ceil(ms / 1000))} 秒`;

/** Live document of the running frame: kept outside React state so revoke can
 * always clear the iframe before (and regardless of) the server reply. */
interface ActivePreview { grantId: string; expiresAt: number; allowScripts: boolean; allowStyles: boolean; allowImages: boolean; allowMedia: boolean; allowFonts: boolean; render: PreviewRenderResult }

export default function HtmlPreview({ workspaceId, path }: PreviewParams) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'enabling' | 'running' | 'error'>('loading');
  const [error, setError] = useState('');
  const [review, setReview] = useState<PreviewReview | undefined>();
  const [active, setActive] = useState<ActivePreview | undefined>();
  const activeRef=useRef<ActivePreview|undefined>(undefined);
  const [allowScripts, setAllowScripts] = useState(false);
  const [allowStyles, setAllowStyles] = useState(false);
  const [allowImages, setAllowImages] = useState(false);
  const [allowMedia, setAllowMedia] = useState(false);
  const [allowFonts, setAllowFonts] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const confirmedRef = useRef(false);
  useEffect(() => { confirmedRef.current = confirmed; }, [confirmed]);
  const [remainingMs, setRemainingMs] = useState(0);
  const mounted = useRef(true);
  const generation = useRef(0);
  const teardown = useRef<(() => void) | undefined>(undefined);
  const reviewController = useRef<AbortController | undefined>(undefined);
  const enableController = useRef<AbortController | undefined>(undefined);
  const offMessage = 'オフ — コードは実行されていません';

  /** Unconditionally stop the running document: the iframe is removed first so
   * late scripts can never paint, then timers/listeners go. Server revoke is a
   * best-effort audit step afterwards — local stop never depends on it. */
  const stopPreview = useCallback(() => {
    teardown.current?.(); teardown.current = undefined;
    const grantId = activeRef.current?.grantId;
    activeRef.current=undefined;confirmedRef.current=false;generation.current++;
    // flushSync removes the iframe in this same task — the running document is
    // destroyed before the revoke request leaves, and even if it never does.
    flushSync(() => { setActive(undefined); setConfirmed(false); setPhase(current => current === 'enabling' || current === 'running' ? 'ready' : current); });
    if (grantId) void postPreview('revoke', { grantId }).catch(() => { /* local stop already done */ });
  }, []);

  const changeConfirmation=(next:boolean)=>{
    confirmedRef.current=next;setConfirmed(next);
    if(!next&&phase==='enabling'){
      // Withdrawal permanently retires this request, even if the user later
      // checks consent again. A late response is revoked, never displayed.
      generation.current++;setReview(undefined);setPhase('error');
      setError('実行許可を取り消しました。必要なら最初から確認し直してください。');
    }
  };

  // Mount-time review: read-only, aborted on unmount. Retries happen only via
  // the explicit reload button (the same function, a new POST each time).
  const requestReview = useCallback(() => {
    const gen = ++generation.current;
    reviewController.current?.abort();enableController.current?.abort();
    const running=activeRef.current;activeRef.current=undefined;
    teardown.current?.();teardown.current=undefined;setActive(undefined);
    if(running)void postPreview('revoke',{grantId:running.grantId}).catch(()=>{});
    confirmedRef.current=false;setAllowScripts(false);setAllowStyles(false);setAllowImages(false);setAllowMedia(false);setAllowFonts(false);
    const controller = new AbortController();
    reviewController.current = controller;
    setPhase('loading'); setError(''); setReview(undefined); setConfirmed(false);
    void postPreview<PreviewReview>('review', { workspaceId, path }, controller.signal)
      .then(result => {
        if(typeof result.reviewId!=='string'||typeof result.documentHtml!=='string'||typeof result.entryPath!=='string'||typeof result.basePath!=='string'||!Number.isFinite(result.expiresAt)||!Array.isArray(result.files)||!result.files.every(file=>typeof file.path==='string'&&typeof file.sha256==='string'&&Number.isFinite(file.bytes)&&['html','script','style','image','audio','video','font'].includes(file.kind)))throw new Error('preview_invalid_response');
        if (mounted.current && gen === generation.current) { setReview(result); setPhase('ready'); }
      })
      .catch(e => {
        if (!mounted.current || gen !== generation.current || controller.signal.aborted) return;
        setError(describeError(e)); setPhase('error');
      });
  }, [workspaceId, path]);
  useEffect(() => { mounted.current = true; requestReview(); return () => { mounted.current = false; reviewController.current?.abort(); enableController.current?.abort(); teardown.current?.(); const running=activeRef.current;activeRef.current=undefined;if(running)void postPreview('revoke',{grantId:running.grantId}).catch(()=>{}); }; }, [requestReview]);

  // Grant expiry: interval timer plus visibilitychange/pagehide — a hidden or
  // discarded tab must not keep a consented document running. Expiry/hide also
  // best-effort revokes so the server releases the snapshot promptly.
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const stop = () => {
      if (stopped||activeRef.current?.grantId!==active.grantId) return; stopped = true;
      activeRef.current=undefined;confirmedRef.current=false;generation.current++;
      teardown.current?.(); teardown.current = undefined;
      flushSync(() => { setActive(undefined); setConfirmed(false); setPhase('ready'); });
      void postPreview('revoke', { grantId: active.grantId }).catch(() => {});
    };
    const check = () => { if (Date.now() >= active.expiresAt) stop(); else setRemainingMs(active.expiresAt - Date.now()); };
    check();
    const timer = setInterval(check, 1000);
    const onHidden = () => { if (document.visibilityState === 'hidden') stop(); };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', stop);
    teardown.current = () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', onHidden); window.removeEventListener('pagehide', stop); };
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onHidden); window.removeEventListener('pagehide', stop); };
  }, [active]);

  const enable = useCallback(() => {
    if (!review || !confirmed || phase === 'enabling') return;
    const gen = generation.current;
    const controller = new AbortController();
    enableController.current = controller;
    setPhase('enabling'); setError('');
    void postPreview<PreviewGrant>('enable', { reviewId: review.reviewId, allowScripts, allowStyles, allowImages, allowMedia, allowFonts, confirmed: true }, controller.signal)
      .then(grant => {
        if (!mounted.current || gen !== generation.current || controller.signal.aborted || !confirmedRef.current) {
          // The consent was withdrawn while enable was in flight (or the page
          // is gone): the arrived grant must be revoked and can never render.
          void postPreview('revoke', { grantId: grant.grantId }).catch(() => {});
          if (mounted.current && gen === generation.current) setPhase(current => current === 'enabling' ? 'ready' : current);
          return;
        }
        let render: PreviewRenderResult;
        try {
          if(typeof grant.grantId!=='string'||!Number.isFinite(grant.expiresAt)||grant.expiresAt<=Date.now())throw Object.assign(new Error('preview_grant_unavailable'),{code:'preview_grant_unavailable'});
          if(grant.allowScripts!==allowScripts||grant.allowStyles!==allowStyles||(grant.allowImages??false)!==allowImages||(grant.allowMedia??false)!==allowMedia||(grant.allowFonts??false)!==allowFonts||grant.entryPath!==review.entryPath||grant.basePath!==review.basePath||!Array.isArray(grant.resources))throw new Error('preview_invalid_response');
          const parsed = new DOMParser().parseFromString(grant.documentHtml, 'text/html');
          render = buildPreviewDocument(parsed, grant);
          if(grant.expiresAt<=Date.now())throw Object.assign(new Error('preview_grant_unavailable'),{code:'preview_grant_unavailable'});
        } catch (e) {
          // Rendering failed before any iframe existed: revoke the grant so the
          // server never holds a snapshot the user believes is running.
          void postPreview('revoke', { grantId: grant.grantId }).catch(() => {});
          setError(describeError(e)); setPhase('ready'); return;
        }
        const next={ grantId: grant.grantId, expiresAt: grant.expiresAt, allowScripts: grant.allowScripts, allowStyles: grant.allowStyles, allowImages: grant.allowImages===true, allowMedia: grant.allowMedia===true, allowFonts: grant.allowFonts===true, render };
        activeRef.current=next;setActive(next);
        setRemainingMs(Math.max(0, grant.expiresAt - Date.now()));
        setPhase('running');
      })
      .catch(e => {
        if (!mounted.current || gen !== generation.current) return;
        if (!controller.signal.aborted) setError(describeError(e));
        setPhase('ready');
      });
  }, [review, confirmed, phase, allowScripts, allowStyles, allowImages, allowMedia, allowFonts]);

  const warnings = active?.render.warnings ?? [];
  const counts = active?.render.blockedCounts;
  return <main className="preview-shell">
    <header className="preview-head">
      <h1>HTML プレビュー（明示的同意）</h1>
      <p className="preview-target"><strong>{path}</strong>{review && <> · 参照範囲 <code>{review.basePath || '（ワークスペース直下）'}</code></>}</p>
    </header>

    {phase === 'loading' && <p role="status">ファイル一覧を確認用に取得しています…</p>}
    {phase === 'error' && <section className="preview-panel" role="alert">
      <p>{error}</p>
      <button type="button" onClick={requestReview}>もう一度確認する</button>
    </section>}

    {review && phase !== 'loading' && <section className="preview-panel" aria-label="実行前の確認">
      <h2>対象ファイル — 内容を必ず確認してください</h2>
      <ul className="preview-files">
        {review.files.map(file => <li key={file.path}>
          <code>{file.path}</code>
          <span className="preview-file-kind">{file.kind === 'html' ? 'HTML' : file.kind === 'script' ? 'JavaScript' : file.kind === 'style' ? 'CSS' : file.kind === 'image' ? '画像' : file.kind === 'font' ? 'フォント' : file.kind === 'audio' ? '音声' : '動画'}</span>
          <span>{formatBytes(file.bytes)}</span>
          <code className="preview-file-hash">SHA-256 {file.sha256.slice(0, 16)}…</code>
        </li>)}
      </ul>
      <p className="preview-note">この一覧の <code>{review.basePath || 'ワークスペース直下'}</code> 配下のファイルだけが対象です。外部画像・外部サイト・CDN・ES module / import map・他の API 通信はこのプレビューでは動作しません（読み込み自体をブロックします）。画像・音声・動画・フォントは一覧にある埋め込みデータのみで、自動再生は行いません。表示・再生できるかどうかはブラウザーの形式・コーデック対応に依存します。ファイル上限: 画像 4 MiB / 音声・動画 8 MiB / フォント 2 MiB（合計 16 MiB・最大 64 ファイル）。</p>
      <fieldset className="preview-consent">
        <legend>実行してよいもの（既定はすべてオフ）</legend>
        <label><input type="checkbox" checked={allowStyles} disabled={phase === 'enabling' || phase === 'running'} onChange={e => setAllowStyles(e.target.checked)} /> CSS を適用する（<code>style-src 'unsafe-inline' data:</code> のみ）</label>
        <label><input type="checkbox" checked={allowScripts} disabled={phase === 'enabling' || phase === 'running'} onChange={e => setAllowScripts(e.target.checked)} /> JavaScript を実行する（一覧の .js とインラインのみ。外部通信・新しいタブ・フォーム送信は不可）</label>
        <label><input type="checkbox" checked={allowImages} disabled={phase === 'enabling' || phase === 'running'} onChange={e => setAllowImages(e.target.checked)} /> 画像を表示する（一覧の PNG / JPEG / GIF / WebP のみ。SVG・外部画像は不可）</label>
        <label><input type="checkbox" checked={allowMedia} disabled={phase === 'enabling' || phase === 'running'} onChange={e => setAllowMedia(e.target.checked)} /> 音声・動画を有効にする（一覧の WAV / MP3 / OGG / OPUS / M4A / MP4 / WebM のみ。自動再生なし・再生できるかはブラウザーのコーデック次第）</label>
        <label><input type="checkbox" checked={allowFonts} disabled={phase === 'enabling' || phase === 'running'} onChange={e => setAllowFonts(e.target.checked)} /> フォントファイルを使う（一覧の WOFF / WOFF2 / TTF / OTF のみ。使うには CSS の許可も必要）</label>
      </fieldset>
      <p className="preview-note">チェックを変えるだけでは実行されません。下の確認にチェックを入れてボタンを押した時だけ、今回限り（最大 5 分・タブを離れた時点で停止）実行されます。この確認の有効期限は {new Date(review.expiresAt).toLocaleTimeString('ja-JP')} までです。</p>
      <label className="preview-confirm"><input type="checkbox" checked={confirmed} disabled={phase === 'running'} onChange={e => changeConfirmation(e.target.checked)} /> 上のファイル一覧と範囲を確認しました。選択したコードの実行を許可します。</label>
      <div className="preview-actions">
        {phase !== 'running'
          ? <button type="button" disabled={!confirmed || phase === 'enabling'} onClick={enable}>{phase === 'enabling' ? '許可を確認しています…' : '確認した内容で実行する'}</button>
          : <button type="button" className="preview-stop" onClick={stopPreview}>取り消して停止</button>}
        {phase!=='running'&&phase!=='enabling'&&<button type="button" onClick={requestReview}>ファイル一覧を確認し直す</button>}
      </div>
      {error && <p role="alert" className="preview-error">{error} <button type="button" onClick={requestReview}>もう一度確認する</button></p>}
    </section>}

    {phase === 'running' && active && <section className="preview-live" aria-label="実行中のプレビュー">
      <div className="preview-live-bar">
        <span role="status">実行中 — 残り <strong>{formatClock(remainingMs)}</strong>{active.allowScripts ? ' · JS 有効' : ' · JS なし'}{active.allowStyles ? ' · CSS 有効' : ' · CSS なし'}{active.allowImages ? ' · 画像' : ''}{active.allowMedia ? ' · 音声・動画' : ''}{active.allowFonts ? ' · フォント' : ''}</span>
        <button type="button" className="preview-stop" onClick={stopPreview}>取り消して停止</button>
      </div>
      {warnings.length > 0 && <details className="preview-warnings"><summary>未対応・ブロックした参照 {warnings.length} 件</summary>
        <ul>{warnings.map((warning, index) => <li key={index}><code>{warning.path || '（インライン）'}</code> — {{
          module: 'ES module は未対応のため削除', importmap: 'import map は未対応のため削除',
          unapproved: '承認一覧にないため削除', external: '外部・ワークスペース外の参照のため削除',
          cycle: 'CSS @import が循環しているため削除', unsupported: '未対応のため削除',
        }[warning.reason]}</li>)}</ul></details>}
      {counts && (counts.scripts + counts.styles + counts.links + counts.embeds) > 0 &&
        <p className="preview-note">ブロック: スクリプト {counts.scripts} / スタイル参照 {counts.styles + counts.links} / 埋め込み・base {counts.embeds} / メディア参照 {counts.assets}</p>}
      <iframe
        className="preview-frame"
        title="同意済み HTML プレビュー"
        sandbox={active.render.sandbox}
        allow="camera 'none'; microphone 'none'; geolocation 'none'; autoplay 'none'"
        referrerPolicy="no-referrer"
        srcDoc={active.render.srcdoc} />
    </section>}
    {phase !== 'running' && phase !== 'loading' && <p className="preview-off" role="status">{offMessage}</p>}
  </main>;
}
