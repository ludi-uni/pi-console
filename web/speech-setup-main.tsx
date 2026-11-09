import React from 'react';
import { createRoot } from 'react-dom/client';
import SpeechOnboarding from './SpeechOnboarding.tsx';
import './local-owner.css';
import './style.css';

// Local speech.cpp setup landing — reached only on the Console PC's own
// loopback after the same-instance probe. It renders the same in-app
// onboarding wizard (same authenticated /api/voice/onboarding/* surface); the
// pre-gate route itself stays read-only and no mutation ever bypasses Access.
const ja = typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ja');
let appUrl: string | undefined;
try {
  const configured = new URL(document.body.dataset.consoleUrl ?? location.href);
  if (configured.protocol === 'https:' && !configured.username && !configured.password && configured.origin !== location.origin) appUrl = configured.href;
} catch { /* no valid configured public origin */ }
createRoot(document.getElementById('root')!).render(
  <main className="local-mcp-settings speech-setup" style={{ maxWidth: 760, margin: '0 auto', padding: 20 }}>
    <h1>{ja ? 'Pi Console — ローカル音声認識のセットアップ' : 'Pi Console — local speech setup'}</h1>
    <p>{ja
      ? 'このページは Console PC 上のブラウザーにだけ表示されます。通常は Pi Console の「設定 → 音声入力」から同じ内容を使えます。'
      : 'This page is shown only to a browser on the Console PC itself. The same onboarding is available from Settings → Voice input in the app.'}</p>
    {appUrl ? <>
      <p>{ja ? '公開URLを使う設定のため、本人認証のある Console 画面で準備します。コマンドを入力する必要はありません。設定を開いたら「音声入力」を選んでください。' : 'Remote access is configured. Continue in the authenticated Console and choose Voice input in Settings; no terminal command is needed.'}</p>
      <a href={appUrl}>{ja ? 'Console の音声設定へ進む' : 'Continue to Console settings'}</a>
    </> : <SpeechOnboarding ja={ja} />}
  </main>,
);
