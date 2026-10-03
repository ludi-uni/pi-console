import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { WebSpeechSTTProvider } from './voice/web-speech-stt.ts';
import type { STTProvider, STTSession, VoiceError } from './voice/types.ts';

type Run = { session?: STTSession; timer?: ReturnType<typeof setTimeout>; grace?: ReturnType<typeof setTimeout> };
const defaultSTTProvider = new WebSpeechSTTProvider();

// Recognition is provider-owned (Web Speech API manages the microphone itself).
// No audio upload, provider key or automatic send happens in this component.
// The STT provider is injectable so Local/API providers can be added later
// without changing this dialog.
export default function VoiceInput({ scope, enabled, language, onInsert, provider = defaultSTTProvider }: { scope: string; enabled: boolean; language: string; onInsert(text: string): void; provider?: STTProvider }) {
  const ja = language === 'ja';
  const t = (jp: string, en: string) => ja ? jp : en;
  const [open, setOpen] = useState(false), [phase, setPhase] = useState<'idle'|'starting'|'listening'|'stopping'>('idle');
  const [finalText, setFinalText] = useState(''), [interim, setInterim] = useState(''), [error, setError] = useState('');
  const [locale, setLocale] = useState(ja ? 'ja-JP' : 'en-US');
  const button = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDivElement>(null);
  const context = useRef({ scope, enabled }); context.current = { scope, enabled };
  const active = useRef<Run | null>(null);
  const confirmed = useRef('');
  const running = phase !== 'idle';
  const supported = provider.isAvailable();
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
    const current = active.current; if (!current || current.grace) return;
    setPhase('stopping'); clearTimeout(current.timer);
    // Some implementations omit end after stop. Retire the callbacks so late
    // results cannot modify another dictation or a newly selected session.
    current.grace = setTimeout(() => {
      if (active.current !== current) return;
      release(true); setPhase('idle'); setInterim('');
      setError(t('音声認識の停止を確認できませんでした。確定済みの文字だけ挿入できます。', 'Recognition did not confirm stopping. Only confirmed text can be inserted.'));
    }, 3000);
    if (!current.session) { release(true); setPhase('idle'); setInterim(''); return; }
    try { current.session.stop(); } catch { release(true); setPhase('idle'); setInterim(''); setError(t('音声認識を停止できませんでした。', 'Could not stop recognition.')); }
  }
  function start() {
    if (!provider.isAvailable() || !context.current.enabled || active.current) return;
    setError(''); setFinalText(''); confirmed.current = ''; setInterim('');
    const current: Run = {}; active.current = current;
    const originalScope = scope;
    const valid = () => active.current === current && context.current.scope === originalScope && context.current.enabled;
    setPhase('starting'); current.timer = setTimeout(stop, 60000);
    const messages: Record<string, string> = {
      'not-allowed': t('マイクまたは音声認識の許可が拒否されました。ブラウザーのサイト設定を確認してください。', 'Microphone or recognition permission denied. Check browser site permissions.'),
      'service-not-allowed': t('このブラウザーでは音声認識サービスが許可されていません。', 'Speech recognition service is not allowed.'),
      'audio-capture': t('端末のマイクを利用できません。', 'The device microphone is unavailable.'),
      'network': t('音声認識サービスに接続できません。接続を確認してください。', 'Cannot connect to the speech recognition service.'),
      'no-speech': t('音声を認識できませんでした。もう一度お試しください。', 'No speech detected. Try again.'),
      'language-not-supported': t('選択した言語はこのブラウザーで認識できません。', 'Selected language is not supported by this browser.'),
    };
    try {
      current.session = provider.start({ language: locale }, {
        onStart: () => { if (valid()) setPhase('listening'); },
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
          release(true); setPhase('idle'); setInterim(''); setError(messages[voice.detail ?? ''] ?? t('音声認識が終了しました。もう一度お試しください。', 'Recognition ended. Try again.'));
        },
      });
    } catch (cause) {
      release(true); setPhase('idle');
      setError((cause as VoiceError)?.code === 'STT_UNSUPPORTED'
        ? t('このブラウザーでは音声認識を開始できません。', 'Speech recognition cannot start in this browser.')
        : t('音声認識を開始できませんでした。', 'Could not start speech recognition.'));
    }
  }
  return <>
    <button ref={button} type="button" className="voice-button" aria-label={t('音声入力', 'Voice input')} title={t('音声入力 · Web Speech API', 'Voice input · Web Speech API')} disabled={!enabled} onClick={() => setOpen(true)}><span aria-hidden="true">🎙</span></button>
    {open && createPortal(<div className="voice-overlay"><div ref={dialog} className="voice-dialog" role="dialog" aria-modal="true" aria-label={t('音声入力', 'Voice input')}>
      <div className="voice-heading"><strong>{t('音声入力', 'Voice input')}</strong><button data-close aria-label={t('音声入力を閉じる', 'Close voice input')} onClick={close}>✕</button></div>
      <p>{t('開いている端末のマイクを使います。音声はブラウザー提供元のサービスへ送信される場合があります。自動送信はしません。', 'Uses this device’s microphone. Audio may be sent to the browser provider’s service. Text is never sent automatically.')}</p>
      {!supported && <p role="status">{t('このブラウザーまたは接続ではWeb Speech APIを利用できません。HTTPSで対応ブラウザーを使うか、端末のキーボード音声入力をご利用ください。', 'Web Speech API is unavailable in this browser or connection. Use a supported browser over HTTPS, or your keyboard’s dictation.')}</p>}
      <label>{t('音声認識の言語', 'Recognition language')}<select aria-label={t('音声認識の言語', 'Recognition language')} disabled={running} value={locale} onChange={e => setLocale(e.target.value)}><option value="ja-JP">日本語</option><option value="en-US">English</option></select></label>
      <div className="voice-transcript" aria-live="polite"><span>{finalText}</span><span className="voice-interim">{interim}</span></div>
      <small role="status">{running ? phase === 'stopping' ? t('停止中…', 'Stopping…') : t('音声入力中 · 最大60秒', 'Listening · up to 60 seconds') : t('確定した文字を確認して、入力欄へ挿入してください。', 'Review confirmed text, then insert it into the prompt.')}</small>
      {error && <p role="alert">{error}</p>}
      <div className="voice-actions">{running ? <button onClick={stop} disabled={phase === 'stopping'}>{t('停止', 'Stop listening')}</button> : <button disabled={!supported || !enabled} onClick={start}>{finalText ? t('再録音', 'Record again') : t('開始', 'Start listening')}</button>}
        <button className="button-primary" disabled={running || !finalText.trim() || !enabled} onClick={() => { if (context.current.scope !== scope || !context.current.enabled) return; const text = finalText; close(); onInsert(text); }}>{t('入力欄へ挿入', 'Insert into prompt')}</button>
        <button onClick={close}>{t('キャンセル', 'Cancel')}</button></div>
    </div></div>, document.body)}
  </>;
}
