import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { WebSpeechSTTProvider } from './voice/web-speech-stt.ts';
import type { STTProvider, STTSession, VoiceError } from './voice/types.ts';

type Run = { session?: STTSession; timer?: ReturnType<typeof setTimeout>; grace?: ReturnType<typeof setTimeout>; processing?: boolean };
const defaultSTTProvider = new WebSpeechSTTProvider();

// Dictation providers: the Web Speech API manages the microphone itself;
// the optional local provider (speech.cpp via /api/voice/*) records with
// MediaRecorder and uploads one bounded WAV per session — same origin only.
// No audio upload to third parties, provider key or automatic send happens
// here. Providers are injectable so tests can substitute fakes.
export default function VoiceInput({ scope, enabled, language, onInsert, provider = defaultSTTProvider, localProvider, buttonLabel, insertLabel }: { scope: string; enabled: boolean; language: string; onInsert(text: string): void; provider?: STTProvider; localProvider?: STTProvider; buttonLabel?: string; insertLabel?: string }) {
  const ja = language === 'ja';
  const t = (jp: string, en: string) => ja ? jp : en;
  const [open, setOpen] = useState(false), [phase, setPhase] = useState<'idle'|'starting'|'listening'|'stopping'|'processing'>('idle');
  const [finalText, setFinalText] = useState(''), [interim, setInterim] = useState(''), [error, setError] = useState('');
  const [locale, setLocale] = useState(ja ? 'ja-JP' : 'en-US');
  const [providerId, setProviderId] = useState('');
  const [, setStatusTick] = useState(0);
  const button = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDivElement>(null);
  const context = useRef({ scope, enabled }); context.current = { scope, enabled };
  const active = useRef<Run | null>(null);
  const confirmed = useRef('');
  const running = phase !== 'idle';
  const providers = useRef<STTProvider[]>([]);
  providers.current = localProvider ? [localProvider, provider] : [provider];
  // Refresh provider health only while the dialog is open (bounded — the local
  // status read is one small same-origin GET per open, not a poll loop).
  useEffect(() => { if (!open) return; let live = true; for (const p of providers.current) { const check = p.healthCheck?.(); if (check) void check.finally(() => { if (live) setStatusTick(v => v + 1); }); } return () => { live = false; }; }, [open]);
  const available = providers.current.filter(p => p.isAvailable());
  // An enabled local provider is the initial choice (Web Speech may be
  // unavailable entirely); the user can switch while idle.
  const current = available.find(p => p.id === providerId) ?? available[0];
  const supported = !!current;
  function release(abort: boolean) {
    const current = active.current; active.current = null;
    if (!current) return;
    clearTimeout(current.timer); clearTimeout(current.grace);
    current.session?.detach();
    if (abort) { try { current.session?.abort(); } catch { /* already stopped */ } }
  }
  function close() {
    release(true); setPhase('idle'); setFinalText(''); confirmed.current = ''; setInterim(''); setError(''); setOpen(false);
    button.current?.focus({ preventScroll: true });
  }
  useEffect(() => { release(true); setPhase('idle'); setOpen(false); setFinalText(''); confirmed.current = ''; setInterim(''); setError(''); return () => release(true); }, [scope, enabled]);
  useEffect(() => { const leave = () => close(); window.addEventListener('pagehide', leave); return () => window.removeEventListener('pagehide', leave); }, []);
  useEffect(() => {
    if (!open) return;
    dialog.current?.querySelector<HTMLButtonElement>('[data-close]')?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled)') ?? []);
        const first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keys, true); return () => document.removeEventListener('keydown', keys, true);
  }, [open]);
  function stop() {
    const current = active.current; if (!current || current.grace || current.processing) return;
    setPhase('stopping'); clearTimeout(current.timer);
    // Some implementations omit end after stop. Retire the callbacks so late
    // results cannot modify another dictation or a newly selected session.
    // Batch providers clear this grace when they report onProcessing: their
    // server-side transcription legitimately takes longer than the window.
    current.grace = setTimeout(() => {
      if (active.current !== current || current.processing) return;
      release(true); setPhase('idle'); setInterim('');
      setError(t('音声認識の停止を確認できませんでした。確定済みの文字だけ挿入できます。', 'Recognition did not confirm stopping. Only confirmed text can be inserted.'));
    }, 3000);
    if (!current.session) { release(true); setPhase('idle'); setInterim(''); return; }
    try { current.session.stop(); } catch { release(true); setPhase('idle'); setInterim(''); setError(t('音声認識を停止できませんでした。', 'Could not stop recognition.')); }
  }
  function start() {
    const selected = current;
    if (!selected || !context.current.enabled || active.current) return;
    setError(''); setFinalText(''); confirmed.current = ''; setInterim('');
    const run: Run = {}; active.current = run;
    const originalScope = scope;
    const valid = () => active.current === run && context.current.scope === originalScope && context.current.enabled;
    setPhase('starting');
    const messages: Record<string, string> = {
      'not-allowed': t('マイクまたは音声認識の許可が拒否されました。ブラウザーのサイト設定を確認してください。', 'Microphone or recognition permission denied. Check browser site permissions.'),
      'service-not-allowed': t('このブラウザーでは音声認識サービスが許可されていません。', 'Speech recognition service is not allowed.'),
      'audio-capture': t('端末のマイクを利用できません。', 'The device microphone is unavailable.'),
      'network': t('音声認識サービスに接続できません。接続を確認してください。', 'Cannot connect to the speech recognition service.'),
      'no-speech': t('音声を認識できませんでした。もう一度お試しください。', 'No speech detected. Try again.'),
      'language-not-supported': t('選択した言語はこのブラウザーで認識できません。', 'Selected language is not supported by this browser.'),
      'speech-cpp-not-enabled': t('ローカル音声認識が無効か、まだ有効化されていません。Console PC の本人管理画面で設定してください。', 'Local speech recognition is disabled or not set up. Enable it in the owner screen on the Console PC.'),
      'speech_busy': t('認識サーバーが別の処理で使用中です。少し待ってからお試しください。', 'The recognition server is busy with another request. Try again shortly.'),
      'transcribe-timeout': t('認識が時間内に終わりませんでした。サーバーの状態を確認してから再試行してください。', 'Recognition did not finish in time. Check the server state, then retry.'),
      'invalid-result': t('認識結果を確認できませんでした。確定済みの文字だけ挿入できます。', 'Could not confirm the recognition result. Only confirmed text can be inserted.'),
      'recording-bounds': t('録音データを処理できませんでした。もう一度お試しください。', 'The recording could not be processed. Try again.'),
      'wav-bounds': t('録音が長すぎます。60秒以内でお試しください。', 'The recording is too long. Keep it under 60 seconds.'),
    };
    try {
      run.session = selected.start({ language: locale }, {
        onStart: () => { if (valid()) { clearTimeout(run.timer); run.timer=setTimeout(stop,60000); setPhase('listening'); } },
        onProcessing: () => {
          // Batch STT: capture already ended and the server is transcribing.
          // Leave the stop-grace window — the work is committed, still
          // cancelable via abort, and the mic is already released.
          if (!valid()) return;
          run.processing = true; clearTimeout(run.grace); run.grace = undefined;
          setPhase('processing'); setInterim('');
        },
        onTranscript: transcript => {
          if (!valid()) return;
          // Finals arrive exactly once; interim text replaces the previous one.
          if (transcript.isFinal) { confirmed.current += transcript.text; setFinalText(confirmed.current); }
          else setInterim(transcript.text);
        },
        onEnd: () => {
          if (!valid()) return;
          release(false); setPhase('idle'); setInterim('');
        },
        onError: (voice: VoiceError) => {
          if (!valid()) return;
          release(true); setPhase('idle'); setInterim('');
          const detail = voice.detail ?? '';
          setError(messages[detail] ?? (voice.code === 'MIC_PERMISSION_DENIED' ? messages['not-allowed'] : voice.code === 'MIC_UNAVAILABLE' ? messages['audio-capture'] : voice.code === 'STT_UNAVAILABLE' ? messages['network'] : t('音声認識が終了しました。もう一度お試しください。', 'Recognition ended. Try again.')));
        },
      });
    } catch (cause) {
      release(true); setPhase('idle');
      setError((cause as VoiceError)?.code === 'STT_UNSUPPORTED'
        ? t('このブラウザーでは音声認識を開始できません。', 'Speech recognition cannot start in this browser.')
        : (cause as VoiceError)?.detail && messages[(cause as VoiceError).detail!] ? messages[(cause as VoiceError).detail!]
        : t('音声認識を開始できませんでした。', 'Could not start speech recognition.'));
    }
  }
  return <>
    <button ref={button} type="button" className={buttonLabel ? 'voice-button voice-button-inline' : 'voice-button'} aria-label={buttonLabel ?? t('音声入力', 'Voice input')} title={buttonLabel ?? t('音声入力', 'Voice input')} disabled={!enabled} onClick={() => setOpen(true)}>{buttonLabel ? <span>{buttonLabel}</span> : <span aria-hidden="true">🎙</span>}</button>
    {open && createPortal(<div className="voice-overlay"><div ref={dialog} className="voice-dialog" role="dialog" aria-modal="true" aria-label={t('音声入力', 'Voice input')}>
      <div className="voice-heading"><strong>{t('音声入力', 'Voice input')}</strong><button data-close aria-label={t('音声入力を閉じる', 'Close voice input')} onClick={close}>✕</button></div>
      <p>{current?.privacy.audioLeavesDevice
        ? t('開いている端末のマイクを使います。音声はブラウザー提供元のサービスへ送信される場合があります。自動送信はしません。', 'Uses this device’s microphone. Audio may be sent to the browser provider’s service. Text is never sent automatically.')
        : t('開いている端末のマイクを使います。音声はこの Console サーバーのローカル認識へだけ送られ、保存されません。自動送信はしません。', 'Uses this device’s microphone. Audio goes only to this console server’s local recognizer and is never stored. Text is never sent automatically.')}</p>
      {!supported && <p role="status">{t('このブラウザーまたは接続では音声認識を利用できません。HTTPSで対応ブラウザーを使うか、Console PC でローカル音声認識を有効化するか、端末のキーボード音声入力をご利用ください。', 'Speech recognition is unavailable in this browser or connection. Use a supported browser over HTTPS, enable local recognition on the Console PC, or use your keyboard’s dictation.')}</p>}
      {available.length > 1 && <label>{t('認識の方法', 'Recognition engine')}<select aria-label={t('認識の方法', 'Recognition engine')} disabled={running} value={current?.id ?? ''} onChange={e => setProviderId(e.target.value)}>{available.map(p => <option key={p.id} value={p.id}>{p.id === 'web-speech' ? t('ブラウザー（Web Speech API）', 'Browser (Web Speech API)') : t('ローカル（speech.cpp · このサーバー）', 'Local (speech.cpp · this server)')}</option>)}</select></label>}
      <label>{t('音声認識の言語', 'Recognition language')}<select aria-label={t('音声認識の言語', 'Recognition language')} disabled={running} value={locale} onChange={e => setLocale(e.target.value)}><option value="ja-JP">日本語</option><option value="en-US">English</option>{current?.capabilities.batch && <option value="auto">{t('自動判定', 'Auto-detect')}</option>}</select></label>
      <div className="voice-transcript" aria-live="polite"><span>{finalText}</span><span className="voice-interim">{interim}</span></div>
      <small role="status">{phase === 'processing' ? t('認識処理中… マイクは停止済みです', 'Transcribing… the microphone is off') : running ? phase === 'stopping' ? t('停止中…', 'Stopping…') : phase === 'starting' ? t('マイクの許可を待っています…', 'Waiting for microphone permission…') : t('音声入力中 · 最大60秒', 'Listening · up to 60 seconds') : t('確定した文字を確認して、入力欄へ挿入してください。', 'Review confirmed text, then insert it into the prompt.')}</small>
      {error && <p role="alert">{error}</p>}
      <div className="voice-actions">{phase === 'processing' ? <small role="status">{t('処理中は再録音できません。キャンセルで中止できます。', 'Re-recording is unavailable while transcribing; Cancel aborts it.')}</small> : running ? <button onClick={stop} disabled={phase === 'stopping'}>{t('停止', 'Stop listening')}</button> : <button disabled={!supported || !enabled} onClick={start}>{finalText ? t('再録音', 'Record again') : t('開始', 'Start listening')}</button>}
        <button className="button-primary" disabled={running || !finalText.trim() || !enabled} onClick={() => { if (context.current.scope !== scope || !context.current.enabled) return; const text = finalText; close(); onInsert(text); }}>{insertLabel ?? t('入力欄へ挿入', 'Insert into prompt')}</button>
        <button onClick={close}>{t('キャンセル', 'Cancel')}</button></div>
    </div></div>, document.body)}
  </>;
}
