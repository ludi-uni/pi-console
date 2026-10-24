# 実装方針（実装前）

対象は隔離workのみ。本番はOFFのまま。既存認証・保存schema・grant・期限を変更しない。

1. 通常設定に小さな開始案内を追加する。Console PC上の対話terminalで既存owner-loginを一度実行し、本人だけが短期codeを入力する。リンクやコピー文にcodeを含めない。通常Access認証からloopback本人認証へ権限を移さない。自動起動や新しいOSダイアログ実装はしない。
2. 本人用画面と通常案内で同じ設定コンポーネントを使い、Codex TOMLと汎用stdio JSONを表示。安定したclientIdを使い、Node/入口pathを明記する。自動importや永続登録はしない。stdio非対応clientは対応hostを使う案内。
3. 初回beginの送信前に、本人のWindows SIDへ束縛した別purposeの暗号化enrollment記録へrequestId/private proof/署名検証済みbroker世代/短い復旧期限を保存する。この記録はgrantではない。serverの同一requestId+clientId+private proofの再送は同じpendingを返し、payload変更・取消・期限切れは新pendingを作らない。companion再起動も同じ保存記録を照合する。broker世代が変われば自動再登録せず停止し、本人の確認へ戻る。
4. 既存承認済みclient stateのschema、read/control/final分離、owner cookie、7/31日/無期限の既存選択肢は維持。取消の応答喪失も同じ要求で照合し、取消でgrantを取り消したと表示しない。

操作手順: 通常Local MCP → 本人確認と接続手順 → Console PCでowner-login（明示yes）→ 本人browserに短期code入力 → Codex用設定例を登録（今回はしない）→ begin → ID照合と親/操作/期限確認 → 承認 → get → list。OFF時も手順は閲覧できるが開始できない旨を示す。

検証: 先にfocused RED、dummy codec/memory backend/fake providerのGREEN、既存54回帰、追加の再送・取消・応答喪失・失効・世代変更・再起動・複数client、型検査、隔離build、fake browser UI。実DPAPI/helper/native provider/本番broker/実clientは実行しない。
