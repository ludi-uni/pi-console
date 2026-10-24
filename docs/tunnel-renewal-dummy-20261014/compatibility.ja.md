# Browser互換性

HTML select/details、fetch、通常のgrid/flex・media queryを使う。MDNのBaseline Widely availableと互換性情報を確認した。fetch未対応時は操作を無効にして対応browserを案内する。新しいnative selector、CSS accent-color、fetchLater等は使用しない。MDN適合だけで実機全browserの確認済みとはしない。

- [fetch](https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch)
- [select](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/select)
- [display](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/display)
- [details](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details)

fresh headless Chromium、viewport 1280×900と390×900で表示・操作・focus保持・横溢れ・応答喪失・再読込を確認。browser profileや実認証を使わない。Node APIにはMDN Baselineを適用しない。
