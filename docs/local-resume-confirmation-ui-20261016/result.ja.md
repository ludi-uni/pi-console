# ローカル連携の確認画面・表示調整

確認画面だけを新しい隔離版へ実装した。本番には未適用。旧実装候補と旧リリースビルドはそのまま保持している。

## 表示の変更

- 最上部に「どのフォルダを」「何ができるか」「いつまで許可するか」をまとめた。長いフォルダパスは省略せず全文を折り返す。操作名を日本語にし、選択した操作だけを表示する。
- 一般向けの Dots 表記にし、他の対応クライアントも対象であることを記載した。フィオ固有表記は追加していない。
- 接続IDの照合、範囲外操作、本文共有・Pi 実行を追加しないこと、OS 隔離でないこと、期限なしの意味、解除方法と解除後も作成済みデータを削除しないこと、保護保存は常時表示する。
- 保存先パス・CurrentUser DPAPI・短期資格更新の説明だけを標準 details に折りたたむ。
- 承認を主ボタン、戻る・取消を従ボタンにし、狭幅では縦に並べる。余白と見出し、キーボードのフォーカス表示を整えた。
- 確認中だけ設定説明・一覧・再取得ボタンを隠し、要約を最初に読めるようにした。戻ると元の選択画面へ戻る。

## 変更範囲と基点

実装: C:\Users\leade\AppData\Local\Temp\pi-console-local-resume-ui-20261016-c4b82d91/work/web/LocalResumeMcp.tsx と work/web/local-resume-review.css の2ファイル。

差分は既存の隔離実装候補に対する更新1・追加1。相対パスのパッチを別のダミーコピーに適用し、2ファイルとも source-payload のハッシュと一致した。本番 D ソースに直接適用するパッチではない。既存の未適用連携実装候補を基点に使う。旧 release-default-off.zip は今回更新していない。今回の候補を本番へ反映するなら、その前に別途フロントエンドのリリースビルドが必要。

サーバー・パッケージ・認可処理・既定 OFF を変更していない。状態と通信処理のプレフィックスが一致し、onClick / onChange / disabled / checked の28属性が旧候補と一致した。定期更新は追加していない。

## 検証

- 関連 fake 回帰: integration.test.mjs / transport.test.mjs を明示して **43/43 成功**。通常の test 一括、OS 専用 entry、native binary、実 DPAPI は実行していない。
- UI 型確認: noEmit、診断0件。ダミー表示用 esbuild のみ使用。本番 dist のビルド・配布なし。
- 実ブラウザー: 専用の隔離・headless Microsoft Edge。**25確認項目、36操作**。1100 / 390 / 320px、長いパス、有限期限／期限なし、操作の部分選択、詳細のキーボード開閉、取消、再確認でチェックが戻ること、二重クリックの承認1回、応答喪失の照合、個別／全解除、秘密入力欄0を確認した。1200ms の入力保持試験とロジック不変の照合により、入力中の更新を再導入していないことを確認した。
- ブラウザー例外0。応答喪失を意図した network error は期待される試験結果。approve HTTP はブラウザー再送込み3回、承認成功は2回、revoke2回、result1回。実ファイル／repo作成等の provider 副作用0、実資格0、OS 暗号0。
- 最初のブラウザー試験はダミーパス1要素が80文字を超えていたため review が拒否された（6操作）。既存制限内に fixture だけを修正して再実行した。切り分けの dummy review POST1回。製品のパス制限は変更していない。
- 初回の sandbox 内 HTTP 回帰は接続制限 EACCES で1件失敗（42/43）。限定した loopback 実行権限で再実行し43/43。初回ブラウザー起動も sandbox 内で終了し、別途許可された専用セッションで完了した。

## 比較画像（ローカル保存のみ）

6枚すべて公開ダミーのみ。01は旧候補を同じ表示用スタイル・同じ長いパス・同じ1100px幅で再表示した比較用画像であり、以前の02-confirm.png自体ではない。

1. images/01-before-wide.png — 旧確認表示
2. images/02-after-wide.png — 新確認表示、有限期限、1100px
3. images/03-after-narrow.png — 390px
4. images/04-after-narrow-320.png — 320px
5. images/05-after-details.png — 技術詳細を展開、キーボードのフォーカス表示
6. images/06-after-no-expiry.png — 期限なし、操作2種だけ

全画像を目視確認済み。MDN で details / overflow-wrap / grid-template-columns / @media / :focus-visible の Widely available を確認した。その他ブラウザー・実クライアント・本番では未検証。

- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details
- https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-wrap
- https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-columns
- https://developer.mozilla.org/en-US/docs/Web/CSS/@media
- https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible

## 保全と終了

D ソース 315ファイルの内容、追跡対象の既存未コミット変更15件、旧実装候補868ファイルと旧リリース候補420ファイルのsealが一致。今回の候補の既存330ファイル中、UI1ファイルだけ変更し、CSS1ファイルを追加した。

ダミーHTTPは127.0.0.1だけ、PID12272 / port54479、終了endpointで停止し closed=true。回帰の loopbackサーバーも allClosed=true。専用ブラウザー session console-review-c4b82d91 は close で終了。所有記録は ownership-final.json / ui-server-ended.json / http-ownership.json に保存した。

本番適用、再起動、MCP有効化、実キー／grant発行、実クライアント接続、実データのrepo作成、OS設定変更、commit/push/publish、追加Library保存は0。pi-wardenには触れていない。今回の範囲に残るblockerはない。
