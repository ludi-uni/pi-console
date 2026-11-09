import React, { useCallback, useEffect, useRef, useState } from 'react';
import './SpeechOnboarding.css';
import type { SpeechOnboardingPayload, SpeechOnboardingPreflight, SpeechOnboardingStatus, SpeechPublicStatus, SpeechModelId } from '../shared/speech.ts';
import { SPEECH_DEFAULT_MODEL, SPEECH_MODELS, speechModelId } from '../shared/speech.ts';
import { resolveSpeechSetup } from './speech-setup.ts';
import { localOwnerLoginCommand } from './local-resume-config.ts';
import type { LocalResumeSetup } from './local-resume-config.ts';
import VoiceInput from './VoiceInput.tsx';
import { SpeechCppSTTProvider } from './voice/speech-cpp-stt.ts';

const ROUTE = '/api/voice/onboarding';
const REQUEST_KEY = 'pi-console:speech-onboarding-request';
async function fetchJson(url: string, init: RequestInit = {}, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error ?? `http-${response.status}`);
    return body;
  } finally { clearTimeout(timer); }
}

/**
 * Terminal-free speech.cpp onboarding card (Settings → Voice).
 *
 * One CTA per state: 準備する → capacity/prerequisite confirmation →
 * ダウンロードして準備する → REAL host native approval → job monitoring →
 * ready → local-only audio test. The card NEVER navigates: it stays in-app and
 * uses only the authenticated /api/voice/onboarding/* surface. Reloads only
 * reconcile state (sessionStorage keeps the opaque requestId); they never
 * re-issue a request, dialog or download. A retry after a terminal state is a
 * NEW explicit intent with a fresh requestId — never a replay of a dead one.
 */
export default function SpeechOnboarding({ ja = true }: { ja?: boolean } = {}) {
  const t = (en: string, jp: string) => (ja ? jp : en);
  const errorMessage = (code?: string) => {
    const messages: Record<string, [string, string]> = {
      speech_onboarding_rate_limited: ['Too many confirmation requests. Wait a few minutes before trying again.', '確認の依頼が続いています。少し待ってから、もう一度お試しください。'],
      speech_onboarding_conflict: ['Another setup is still running or its confirmation is closing. Wait before retrying.', '別の準備が進行中か、確認画面を閉じています。終了してからお試しください。'],
      speech_vulkan_loader_missing: ['Install the GPU driver or Vulkan Runtime on the Console PC first.', 'Console PC の GPU ドライバーまたは Vulkan Runtime を先に確認してください。'],
      speech_platform_unsupported: ['Local recognition requires a Windows x64 Console PC.', 'ローカル音声認識には Windows x64 の Console PC が必要です。'],
      speech_model_fetch_failed: ['The model download failed. Check the Console PC network; verified files can be reused on retry.', 'モデルを取得できませんでした。Console PC のネット接続を確認してください。取得済みの正常なファイルは再試行時に再利用します。'],
      speech_download_failed: ['The runtime download failed. Check the Console PC network, then retry.', '実行環境を取得できませんでした。Console PC のネット接続を確認してから再試行してください。'],
      speech_model_not_cached: ['The selected model is not cached. Allow its download or select the existing cache in advanced options.', '選択したモデルが保存されていません。詳細設定でモデルの取得を許可するか、保存済みフォルダーを指定してください。'],
    };
    const message = code ? messages[code] : undefined;
    return message ? t(...message) : t('Could not confirm the setup result. Read the status before retrying.', '準備の結果を確認できませんでした。再試行の前に状態を再取得してください。');
  };
  const [status, setStatus] = useState<SpeechOnboardingStatus | undefined>();
  const [preflight, setPreflight] = useState<SpeechOnboardingPreflight | undefined>();
  const [pubStatus, setPubStatus] = useState<SpeechPublicStatus | undefined>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [view, setView] = useState<'initial' | 'confirm' | 'waiting' | 'progress' | 'ready'>('initial');
  const [transcript, setTranscript] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [source, setSource] = useState<'managed' | 'existing'>('managed');
  const [modelId, setModelId] = useState<SpeechModelId>(SPEECH_DEFAULT_MODEL);
  const [exePath, setExePath] = useState('');
  const [modelDir, setModelDir] = useState('');
  const [consent, setConsent] = useState(false);
  const [sameDevice, setSameDevice] = useState<'checking' | 'local' | 'remote' | 'unknown'>('checking');
  const [setup] = useState<LocalResumeSetup>({ source: 'npm' });
  const requestId = useRef<string>('');
  const storageRead = useRef(false);
  if (!storageRead.current) {
    storageRead.current = true;
    try { requestId.current = sessionStorage.getItem(REQUEST_KEY) ?? ''; } catch { /* storage is optional */ }
  }
  const pendingId = useRef<string>('');
  const poll = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);

  const headers = { 'content-type': 'application/json', 'x-pi-console-speech': '1' } as const;
  const read = useCallback(async (id?: string) => {
    const q = id ? `?requestId=${encodeURIComponent(id)}` : '';
    const v = await fetchJson(`${ROUTE}/status${q}`, { cache: 'no-store', credentials: 'same-origin' });
    if (!v?.status || !v?.preflight) throw new Error('speech_onboarding_invalid_status');
    return v as { status: SpeechOnboardingStatus; preflight: SpeechOnboardingPreflight };
  }, []);

  const refreshPublic = useCallback(async () => {
    try {
      const v = await fetchJson('/api/voice/status', { cache: 'no-store' });
      if (mounted.current && (v as SpeechPublicStatus | undefined)?.providerId === 'speech-cpp') setPubStatus(v as SpeechPublicStatus);
    } catch { /* status stays unknown */ }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const v = await read(requestId.current || undefined);
      if (!mounted.current) return;
      setStatus(v.status); setPreflight(v.preflight); setLoadFailed(false);
      if (v.status.state === 'ready' || (v.status.state === 'idle' && pubStatus?.enabled)) setView('ready');
      else if (v.status.state === 'processing') setView('progress');
      else if (v.status.state === 'pending') setView('waiting');
      else setView(pubStatus?.enabled && v.status.state === 'idle' ? 'ready' : 'initial');
    } catch { if (mounted.current) setLoadFailed(true); }
  }, [read, pubStatus?.enabled]);

  // One-time: same-device hint (read-only probe) + stored requestId reconcile +
  // public feature status. Nothing here POSTs or spawns work.
  useEffect(() => {
    mounted.current = true;
    void resolveSpeechSetup()
      .then(r => { if (mounted.current) setSameDevice(r.kind === 'local' ? 'local' : 'unknown'); })
      .catch(() => { if (mounted.current) setSameDevice('unknown'); });
    void read(requestId.current || undefined)
      .then(v => { if (!mounted.current) return; setStatus(v.status); setPreflight(v.preflight); if (v.status.state === 'ready') setView('ready'); else if (v.status.state === 'processing') setView('progress'); else if (v.status.state === 'pending') setView('waiting'); })
      .catch(() => { if (mounted.current) setLoadFailed(true); });
    void refreshPublic();
    return () => { mounted.current = false; clearTimeout(poll.current); };
  }, [read, refreshPublic]);

  // Bounded polling only while a live state is on screen.
  useEffect(() => {
    const live = status?.state === 'pending' || status?.state === 'processing';
    if (!live) { clearTimeout(poll.current); return; }
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped || !mounted.current) return;
      if (Date.now() - started > 50 * 60 * 1000) { setLoadFailed(true); return; }
      setElapsed(Math.max(0, Math.floor((Date.now() - (status?.job?.startedAt ?? status?.startedAt ?? started)) / 1000)));
      try {
        const v = await read(requestId.current || pendingId.current || undefined);
        if (!mounted.current) return;
        setStatus(v.status); setPreflight(v.preflight);
        if (v.status.state === 'ready') { setView('ready'); void refreshPublic(); return; }
        if (v.status.state === 'processing') setView('progress');
        else if (v.status.state !== 'pending') { setView('initial'); return; }
      } catch { /* keep polling within the bounded window */ }
      poll.current = setTimeout(() => void tick(), 2000);
    };
    poll.current = setTimeout(() => void tick(), 2000);
    return () => { stopped = true; clearTimeout(poll.current); };
  }, [status?.state, read, refreshPublic]);

  const payload = (): SpeechOnboardingPayload => source === 'managed'
    ? { source: 'managed', modelId, allowDownload: true }
    : { source: 'existing', modelId, allowDownload: consent, executablePath: exePath.trim(), ...(modelDir.trim() ? { modelDirectory: modelDir.trim() } : {}) };

  /** POST is a fresh intent: a NEW requestId every confirmed submit. */
  const request = async () => {
    if (busy) return;
    setBusy(true); setError(undefined);
    const id = crypto.randomUUID();
    pendingId.current = id;
    requestId.current = id;
    try { sessionStorage.setItem(REQUEST_KEY, id); } catch { /* storage optional */ }
    try {
      const v = await fetchJson(`${ROUTE}/request`, {
        method: 'POST', credentials: 'same-origin', headers,
        body: JSON.stringify({ requestId: id, payload: payload(), confirmed: true }),
      });
      const body = v as { status: SpeechOnboardingStatus; preflight: SpeechOnboardingPreflight };
      setStatus(body.status); setPreflight(body.preflight);
      setView(body.status.state === 'ready' ? 'ready' : body.status.state === 'processing' ? 'progress' : body.status.state === 'pending' ? 'waiting' : 'initial');
      if (body.status.state === 'ready') void refreshPublic();
    } catch (e) {
      // Uncertain POST: reconcile by GET first — never blind-resend.
      setError(errorMessage((e as Error).message));
      try {
        const v = await read(id);
        if (mounted.current) {
          setStatus(v.status); setPreflight(v.preflight);
          setView(v.status.state === 'ready' ? 'ready' : v.status.state === 'processing' ? 'progress' : v.status.state === 'pending' ? 'waiting' : 'initial');
          if (v.status.state === 'ready') void refreshPublic();
        }
      } catch { setLoadFailed(true); /* leave the visible error and reconcile control */ }
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    if (busy) return;
    const id = requestId.current || pendingId.current;
    if (!id) return;
    setBusy(true); setError(undefined);
    try {
      const v = await fetchJson(`${ROUTE}/cancel`, { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify({ requestId: id }) });
      const next = (v as { status: SpeechOnboardingStatus }).status;
      setStatus(next);
      setView(next.state === 'ready' ? 'ready' : next.state === 'processing' ? 'progress' : next.state === 'pending' ? 'waiting' : 'initial');
      if (next.state === 'ready') void refreshPublic();
    } catch (e) { setError(errorMessage((e as Error).message)); }
    finally { setBusy(false); }
  };

  const sttProvider = useRef<SpeechCppSTTProvider | undefined>(undefined);
  const getProvider = () => (sttProvider.current ??= new SpeechCppSTTProvider());
  const enabled = pubStatus?.enabled === true;
  const usable = enabled && (pubStatus?.phase === 'ready' || pubStatus?.phase === 'stopped' || pubStatus?.phase === 'transcribing');
  const effectiveReady = view === 'ready' || status?.state === 'ready' || (enabled && (status?.state === 'idle' || status === undefined));

  const stateLabel: Record<string, string> = {
    idle: t('Not configured', '未設定'), pending: t('Waiting for Console PC approval', 'PC側の確認待ち'),
    processing: t('Preparing', '準備中'), ready: t('Ready', '準備完了'), rejected: t('Declined', '許可されませんでした'),
    expired: t('Expired', '期限切れ'), cancelled: t('Cancelled', '中止しました'), unavailable: t('Unavailable', '利用できません'),
    conflict: t('Another request is active', '別の要求が進行中'), failed: t('Failed', '失敗'),
  };
  const statusClass = status?.state === 'ready' || effectiveReady ? 'good' : status?.state === 'failed' || status?.state === 'unavailable' ? 'warn' : '';
  const model = SPEECH_MODELS.find(m => m.id === modelId) ?? SPEECH_MODELS[0];
  const readyModelId = status?.payload?.modelId ?? pubStatus?.modelId ?? modelId;
  const readyModel = SPEECH_MODELS.find(m => m.id === readyModelId) ?? model;
  const modelSize = modelId === SPEECH_DEFAULT_MODEL ? t('About 0.84 GB', '約0.84 GB') : t('Varies by model', 'モデルにより異なります');

  const preflightOk = !!preflight && preflight.supported && preflight.vulkanLoader;
  const preflightBlocked = preflight && (!preflight.supported || !preflight.vulkanLoader || !preflight.nativeApproval);

  return <section className="speech-onb" aria-label={t('Local speech recognition setup', 'ローカル音声認識の準備')}>
    <header className="speech-onb-head"><span>{t('Speech recognition on this Console', 'この Console の音声入力')}</span>
      <span className={`speech-onb-status ${statusClass}`}><span>{effectiveReady ? stateLabel.ready : status ? stateLabel[status.state] ?? status.state : stateLabel.idle}</span></span></header>
    <div className="speech-onb-body">
      {loadFailed && <div className="speech-onb-notice" role="alert">{t('Could not load the onboarding status. Reload the state before acting.', '準備状況を読み込めませんでした。操作の前に状態を再取得してください。')}<div className="speech-onb-actions"><button type="button" className="quiet" onClick={() => void refresh()}>{t('Reload status', '状態を再取得')}</button></div></div>}

      {view === 'initial' && !effectiveReady && <>
        <h4>{sameDevice === 'local' ? t('Prepare voice input on this PC', 'このPCで音声入力を準備する') : t('Prepare voice input on the Console PC', 'Console PCで音声入力を準備する')}</h4>
        <p className="muted">{t('Dictate without Web Speech API. No commands, no codes — the Console PC confirms the setup natively.', '話した内容を文字にできます。コマンド入力やコード転記は不要で、Console PC側で確認します。')}</p>
        {status?.state === 'rejected' && <p className="speech-onb-notice">{t('The Console PC declined the request, so nothing was prepared. You can try again.', '許可しなかったため、準備は開始していません。もう一度試すこともできます。')}</p>}
        {status?.state === 'cancelled' && <p className="speech-onb-notice">{t('Preparation was cancelled. Already-fetched data is verified and reused on the next attempt.', '準備を中止しました。取得済みのデータは次回の準備で整合性を確認して再利用します。')}</p>}
        {status?.state === 'expired' && <p className="speech-onb-notice">{t('The confirmation expired before approval. Start a new request when ready.', '確認が期限切れになりました。準備する場合は新しい要求を始めてください。')}</p>}
        {status?.state === 'failed' && <p className="speech-onb-notice" role="alert">{errorMessage(status.error)}</p>}
        {status?.state === 'unavailable' && <p className="speech-onb-notice">{t('The Console PC could not show the native confirmation (unmanaged, noninteractive or unsupported). See troubleshooting below.', 'PC側の確認画面を開けませんでした（管理外・非対話・非対応）。下のトラブルシューティングを確認してください。')}</p>}
        <div className="speech-onb-model"><div><b>{model.label}</b><small>{t('Recommended starting point', 'まずはこの設定で始められます')}</small></div><span className="speech-onb-pill">{t('Recommended', '推奨')}</span></div>
        {preflight && !preflight.supported && <p className="speech-onb-notice warn" role="status">{t('This Console does not meet the requirements — speech.cpp needs Windows x64. Nothing was downloaded.', 'この Console は動作条件を満たしていません。speech.cpp は Windows x64 専用です。ダウンロードは行っていません。')}</p>}
        {preflight?.supported && !preflight.vulkanLoader && <p className="speech-onb-notice warn" role="status">{t('The Vulkan loader was not found on the Console PC (a driver check, not GPU proof). Confirm the GPU driver / Vulkan Runtime before a long download.', 'Console PC に Vulkan loader が見つかりません（GPU 対応の証明ではありません）。長いダウンロードの前に GPU ドライバー / Vulkan Runtime を確認してください。')}</p>}
        {preflight?.supported && !preflight.nativeApproval && <p className="speech-onb-notice warn" role="status">{t('PC-side confirmation is unavailable with this launch method. Open the Console started through Pi or Windows startup. Advanced recovery is under Troubleshooting.', 'この起動方法では PC 側の確認機能を利用できません。Pi または Windows 起動時に開始した Console を開いてください。代替手順は下のトラブルシューティングにあります。')}</p>}
        {sameDevice === 'unknown' && <p className="small muted">{t('This device could not be confirmed as the Console PC — that is only a hint and grants nothing by itself.', 'この端末が Console PC か確認できませんでした。これは案内だけで、許可にはなりません。')}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="speech-onb-actions">
          <button type="button" className="primary" disabled={busy || !preflight || preflightBlocked === true || loadFailed} onClick={() => setView('confirm')}>{t('Prepare', '準備する')}</button>
          <span className="hint">{t('Next: confirm capacity and requirements', '次に容量と動作条件を確認します')}</span>
        </div>
      </>}

      {view === 'confirm' && <>
        <p className="muted small">{t('Before downloading', 'ダウンロードの前に')}</p>
        <h4>{t('Prepare on the Console PC', 'Console PCに準備します')}</h4>
        <p className="muted">{t('The work happens on the PC running Pi Console — not on this browser.', '処理を行うのは Pi Console が動いているPCです。このブラウザーへの保存ではありません。')}</p>
        <dl className="speech-onb-facts">
          <div className="fact"><dt>{t('Model', 'モデル')}</dt><dd>{model.label} <span className="speech-onb-pill">{model.default ? t('Recommended', '推奨') : ''}</span></dd></div>
          <div className="fact"><dt>{t('Size', '容量')}</dt><dd><strong>{modelSize}</strong><small className="muted"> {t('model only; the runtime needs additional space', 'モデル単体。実行環境は別途必要です')}</small></dd></div>
          <div className="fact"><dt>{t('Runs on', '保存・実行先')}</dt><dd>Console PC</dd></div>
          <div className="fact"><dt>{t('Requirements', '動作条件')}</dt><dd>{preflightOk ? <span className="good">✓ Windows x64 / Vulkan loader</span> : <span className="warn">{t('Check requirements below', '下の動作条件を確認')}</span>}</dd></div>
        </dl>
        <p className="small muted">{t('Next, the Console PC shows its own native confirmation for this download and run. It grants no admin or MCP rights.', '次に Console PC 側で、このダウンロードと実行のためだけのネイティブ確認を表示します。管理者登録は行いません。')}</p>
        {error && <p role="alert">{error}</p>}
        <div className="speech-onb-actions">
          <button type="button" className="primary" disabled={busy || (source === 'existing' && !exePath.trim())} onClick={() => void request()}>{t('Download and prepare', 'ダウンロードして準備する')}</button>
          <button type="button" className="quiet" onClick={() => setView('initial')}>{t('Cancel', 'キャンセル')}</button>
        </div>
      </>}

      {view === 'waiting' && <>
        <h4>{t('Confirm on the Console PC', 'Console PCで確認してください')}</h4>
        <p className="muted">{sameDevice === 'local'
          ? t('A native confirmation should appear on this PC. Approve it there — this browser cannot approve for you.', 'このPCにネイティブの確認が表示されます。許可はそこで行います。ブラウザーからは許可できません。')
          : t('A confirmation was requested. On the Console PC, approve it in the native dialog — this device cannot approve.', '確認を依頼しました。Console PC 側のネイティブ画面で許可してください。この端末からは許可できません。')}</p>
        <div className="speech-onb-notice"><strong>{t('Waiting for approval', '確認待ち')}</strong><p>{t('Nothing has been downloaded yet. The request expires in about 2 minutes.', 'まだダウンロードは始まっていません。確認は約2分で期限切れになります。')}</p></div>
        {error && <p role="alert">{error}</p>}
        <div className="speech-onb-actions"><button type="button" className="quiet" disabled={busy} onClick={() => void cancel()}>{t('Cancel request', '依頼を取り消す')}</button></div>
      </>}

      {view === 'progress' && <>
        <p className="muted small">{t('Preparing on the Console PC', 'Console PCで準備中')}</p>
        <h4>{t('Please wait while it prepares', '準備が終わるまで、お待ちください')}</h4>
        <p className="muted">{t('You can keep working elsewhere. Progress is shown as the real phase plus elapsed time — no fake percentages.', '他の作業を続けられます。進捗は実際の工程と経過時間だけを表示します。')}</p>
        <ol className="speech-onb-progress" aria-label={t('Preparation progress', '準備の進捗')}>
          {[
            { kind: 'install', label: t('Runtime check / download', '実行環境の確認・取得') },
            { kind: 'model-fetch', label: t('Model download', 'モデルのダウンロード') },
            { kind: 'done', label: t('Ready', '音声入力の準備完了') },
          ].map((step, i) => {
            const job = status?.job;
            const active = job?.state === 'running' && (job.kind === step.kind || (step.kind === 'install' && job.kind === 'enable-existing'));
            const complete = (job?.state === 'done' && i <= 1) || (step.kind === 'install' && job?.kind === 'model-fetch') || (step.kind === 'done' && job?.state === 'done');
            return <li key={step.kind} className={complete ? 'complete' : active ? 'active' : ''}><span className="mark">{complete ? '✓' : i + 1}</span><span>{step.label}{active ? ` · ${stateLabel.processing}` : ''}</span></li>;
          })}
        </ol>
        <progress aria-label={t('Preparation in progress', '準備中')} />
        <p className="speech-onb-elapsed" role="status">{t('Elapsed', '経過')} {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}{status?.job ? ` · ${status.job.kind} · ${status.job.state}` : ''}</p>
        {status?.job?.error && <p role="alert">{errorMessage(status.job.error)}</p>}
        {error && <p role="alert">{error}</p>}
        <div className="speech-onb-actions"><button type="button" className="quiet" disabled={busy} onClick={() => void cancel()}>{t('Cancel preparation', '準備を中止する')}</button></div>
        <p className="small muted" style={{ marginTop: 14 }}>{t('Cancelling keeps fetched data; it is verified and safely reused on retry.', '中止しても取得済みデータは保持し、再開時に整合性を確認して再利用します。')}</p>
      </>}

      {effectiveReady && <>
        <p className="good small">✓ {t('Preparation finished', '準備完了')}</p>
        <h4>{t('Ready', '準備できました')}</h4>
        <p className="muted">{t('Try it once to confirm transcription works. What you try is never sent automatically.', '一度試して、文字になることを確かめましょう。試した内容は自動送信されません。')}</p>
        <div className="speech-onb-model"><div><b>{readyModel.label} · Console PC</b><small>{t('Local processing', 'ローカルで処理する設定')}</small></div><span className="good small">✓ {t('Ready', '準備完了')}</span></div>
        <>
          <p className="small muted">{t('The microphone opens only after your explicit click. Audio goes only to this Console server’s local recognizer and is never stored or auto-sent.', 'マイクはあなたが明示的に押したときだけ使います。音声はこの Console サーバーのローカル認識へだけ送られ、保存・自動送信されません。')}</p>
          <div className="speech-onb-actions">
            <VoiceInput scope="speech-onboarding" enabled={usable} language={ja ? 'ja' : 'en'} buttonLabel={t('Try voice input', '音声入力を試す')} insertLabel={t('Use this transcript', 'この文字起こしを使う')} provider={getProvider()} onInsert={text => setTranscript(text)} />
          </div>
          {transcript && <div className="speech-onb-transcript"><small>{t('Transcript preview · not sent', '文字起こしプレビュー · 未送信')}</small><p>{transcript}</p><p className="small good">✓ {t('Not sent — automatic prompt send never happens', '未送信 · 自動でプロンプトを送信しません')}</p></div>}
        </>
      </>}

      <details className="speech-onb-advanced" hidden={view !== 'initial' && view !== 'confirm' || effectiveReady}>
        <summary>{t('Advanced options', '詳細設定')}</summary>
        <div className="inner">
          <p className="small muted">{t('Usually unnecessary. Use an existing speech.exe/model cache only when you manage them yourself.', '通常は変更不要です。既存の実行ファイル・モデルを自分で管理する場合だけ使います。')}</p>
          <label>{t('Setup source', '導入方法')}
            <select value={source} onChange={e => setSource(e.target.value as 'managed' | 'existing')}>
              <option value="managed">{t('Official download + portable install', '公式ダウンロード＋ポータブルインストール')}</option>
              <option value="existing">{t('Existing speech.exe on this PC', 'このPC上の既存 speech.exe')}</option>
            </select></label>
          <label>{t('Model', 'モデル')}
            <select value={modelId} onChange={e => { if (speechModelId(e.target.value)) setModelId(e.target.value); }}>
              {SPEECH_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}{m.default ? t(' (default)', '（初期値）') : ''}</option>)}
            </select></label>
          {source === 'existing' && <>
            <label>{t('speech.exe path', 'speech.exe のパス')}<input type="text" value={exePath} autoComplete="off" placeholder="C:\Tools\speech.cpp\speech.exe" onChange={e => setExePath(e.target.value)} /></label>
            <label>{t('Model cache directory (optional)', 'モデルキャッシュのフォルダー（任意）')}<input type="text" value={modelDir} autoComplete="off" placeholder="C:\Tools\speech.cpp\models" onChange={e => setModelDir(e.target.value)} /></label>
            <label className="consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>{t('Allow downloading the selected model GGUF if it is not already cached.', '選択モデルがキャッシュに無い場合、GGUF のダウンロードを許可します。')}</span></label>
          </>}
        </div>
      </details>

      <details>
        <summary>{t('Troubleshooting', 'トラブルシューティング')}</summary>
        <div className="inner">
          <p className="small muted">{t('If confirmation is unavailable, sign in on the Console PC and use the Console started through Pi or Windows startup. The terminal fallback below also requires a launcher-managed Console; it is for advanced recovery only.', '確認画面を表示できない場合は、Console PC にサインインし、Pi または Windows 起動時に開始した Console を開いてください。下のコマンドも通常の管理された起動が前提で、上級者向けの代替手段です。')}</p>
          <p className="small muted">{t('On the Console PC terminal, run:', 'Console PC のターミナルで実行：')}</p>
          <p className="speech-onb-owner"><textarea readOnly rows={2} value={localOwnerLoginCommand(setup) ?? ''} aria-label={t('Owner verification command', '本人確認コマンド')} /></p>
          <p className="small muted">{t('A one-time code appears and the owner page opens on that PC (10 minutes, never saved).', '一回コードが表示され本人管理画面が開きます（10分・保存しません）。')}</p>
        </div>
      </details>
    </div>
  </section>;
}
