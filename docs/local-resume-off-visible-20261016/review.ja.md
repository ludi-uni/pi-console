# UI/権限分離のセルフレビュー

必須修正の残存指摘はない。独立した第三者レビューではない。

- LocalOwner: 認証済みブロック内だけに新UIを表示。resumeAvailable===trueの厳密booleanでActiveを選び、未指定・null・文字列はOFFへfail closed。本人認証・所有・API検証は変更しない。
- LocalResumeMcp: OFF/Activeを別componentとしてmount。Inactiveにはfetch/request/storage/crypto/timerの呼出しがない。disabledの開始/承認ボタンはhandlerを持たず、強制clickでもAPI要求0を確認。OFFの下書きはメモリ内だけで、未検証path・未承認期限を明示する。実接続IDや成功状態を捏造しない。
- Active: 状態/通信プレフィックスとonClick/onChange/disabled/checked 28属性が旧版と一致。要約を表示専用ScopeSummaryへ共有しただけで、承認/取消/二重送信抑止/照合は維持。
- 認証が消えれば新UIもunmountし、capabilityがOFFに戻ればActiveをunmount。過去の未照合receiptをOFF下書きの破棄が消さない。未認証・不正capability・再読込・戻る・scope表示は実UIで確認した。
- JSXの通常text描画だけでpath等を表示し、HTML注入は追加しない。OFFでは実pathの存在やreparseの安全性を検証したと示さない。
- 本番bundleにfixtureバナー/公開dummyログイン文字列/古いdummy receiptが混入していない。server/packageの実権限・資格・grant・transport設定は不変。

検証限界: 実UIは専用headless Edgeとfake owner APIで確認。実owner cookie/実資格/実grant/実MCP接続やWindows native providerは使用しない。本番配置はしていない。実MainApp全体のE2Eや他ブラウザーの実行確認は今回行っていない。

MDNのdetails/overflow-wrapのWidely availableと、disabled標準動作/互換性を参照。新規Web APIなし。新表示は広幅・390/320pxとキーボードdetailsで確認。

- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/disabled
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details
- https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-wrap
