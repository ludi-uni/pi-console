# ローカル再開の隔離実装・受入結果

稼働Dへ未適用。既定OFFの23ファイル差分（既存9・追加14）をsource-payload、changes.json、changes.patchに固定した。既存profileは自動移行・書換えしない。本番profile/.env/実資格/実grantを読まず、追加OS DPAPI試験も行っていない。

実装は用途別issuer、CurrentUser保護JSON store、SID/installation ID/登録本人binding、private companion proof保存、通常再起動復元、期限内更新、永続解除、操作intent/receipt、owner broker/stdio/UIの配線。既知legacy鍵と旧profileのread/control/finalを衝突拒否対象にし、旧profileが判別できない場合は新規発行を閉じる。資格やgrantを作る主体を人から内部issuerへ移し、新UIにキー入力欄はない。

最終受入は74/74。選択した5ファイルだけを実行した。通常再起動、内部期限だけの更新、7/31日/明示無期限、owner/client/root変更、取消、複数client、scope外、書込前/rename/応答喪失、codec失敗、重複拒否、部分成功、同request照合を含む。別Nodeがserver/clientの公開dummy保存を読み直して再接続するケースも通過。型確認は既存291ファイル・隔離293ファイルとも診断0、追加12 mjsのsyntax確認も成功。noEmitであり本番build/dist配布ではない。

専用の隔離headless Edgeで画面を確認し、画像5枚を保存。成功シナリオ20操作、fixture側のpath/URL修正時17操作を合わせ37操作。二重clickは1承認だけ。応答喪失ではbrowserが同POSTを再送したが重複を拒否し、本人操作による2連携だけが承認された。個別解除・全解除・result照合を確認した。最初の拒否は試験コードのWindows path表記、途中の例外は試験側URL指定によるもので、いずれも実資格はない。本人の既存窓・focus・入力には触れていない。

実DPAPI受入は既存の成功1回（Protect1/Unprotect3、4.33秒）を参照する。helper本文は同じだが、今回の新Windows SID取得/transport/本番store全体をOS検証済みとは扱わない。今回の実OS crypto・実資格・実grant・native folder試験・本番restart/source/dist/config適用は0。

stdioは[MCP 2025-11-25 transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)と[lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)を一次仕様で確認。end clientにcustom headerやclientInfo認証を要求しない。local private HTTPはcompanion内部専用。個々の製品の対応・自動import・実client接続は未確認であり、stdio非対応clientには対応stdio client経由を最小fallbackとして示す。

新UIのFetch/sessionStorageはMDN Baseline Widely availableを確認した。storage拒否時はsave送信前に停止する。実ブラウザー確認はheadless Edgeのみ。[Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)、[sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage)

apply-preview.mjs --verify-only は対象23ファイルのbefore/payload hashを照合するだけで、書込機能を持たない。activation-previewは別に提示する未適用・未承認の本番有効化候補であり、source-payloadには含めない。具体的な適用・復旧操作はapply-operations.ja.mdを参照。
