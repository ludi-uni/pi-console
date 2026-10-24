# Web互換性の確認

MDN Baselineと互換性を確認して、通常のforms、fetch、sessionStorage、AbortController、details、CSS grid/position/overflow-wrapを使った。今回主な参照は[sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage)、[AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)、[Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)、[details](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details)、[grid-template-columns](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/grid-template-columns)、[position](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/position)、[overflow-wrap](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow-wrap)。

[accent-color](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/accent-color)はLimited availabilityだったため除去し、native checkbox/radioの通常表示を使った。AbortControllerが使えない場合もsequence/epoch/revisionの破棄を維持し、sessionStorageが禁止された場合も画面内memoryで操作できる。crypto.randomUUIDはfeature detectionし、fallbackは非秘密のdummy request IDだけに使う。実credentialの生成に使わない。

Baselineを動作確認の代わりにしていない。実ブラウザー検証はfresh headless Chromiumの1280px/390px。今回のcompositionイベント試験は実OSの日本語IMEそのものを確認したものではない。Firefox/Safariや本人の認証済み実画面は未検証で、正式適用前に対象browserで本人レビューが必要。
