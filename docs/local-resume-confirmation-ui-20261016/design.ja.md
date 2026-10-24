# ローカル連携確認画面の表示調整

対象は LocalResumeMcp の確認表示と専用 CSS のみ。旧隔離候補・旧ビルド・本番ソースを保持し、新しい Temp 候補で作業する。

確認時は設定説明・接続一覧を一時的に省き、フォルダ全文、選択済み操作の日本語名、絶対期限／期限なしを最上部に表示する。続けて接続 ID の照合、対象外操作、解除方法、保護保存の同意を常時表示する。保存先の詳細や短期資格の更新方式だけを details に移す。Dots は一般向けの案内として使い、他の対応 MCP クライアントも利用できることを維持する。

主ボタンは既存の承認操作、従ボタンは既存の戻る・取消。チェック・busy・pending・二重クリック抑止・取消と再照合・手動更新のロジックを変えない。定期更新は追加しない。認可・既定 OFF・バックエンドのファイルは一切変更しない。

実際の確認手順: ローカル連携を始める → ダミー接続を選択 → 親フォルダと操作と期限を入力 → 許可内容を確認 → 要約と常時表示の範囲を読む → 必要なら技術詳細を開く → 戻る・取消、またはチェックしてダミー承認。実登録・実資格・OS 暗号・本番反映は行わない。

受入は既存の public dummy fake provider とメモリ保存だけ。確認画面の狭幅・長いパス・有限期限／期限なし・操作の部分選択・戻ると再確認・二重クリック・応答喪失の照合を対象とする。通常 test スクリプトは OS/native/実 Pi を含むため使わず、対象 UI ブラウザー試験と明示選択した既存 fake テストだけを実行する。

互換性: MDN で details / overflow-wrap / grid-template-columns / @media の Baseline Widely available を確認。details の name グループや新 API は使わない。実ブラウザーで別途表示を確認する。

- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details
- https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-wrap
- https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-columns
- https://developer.mozilla.org/en-US/docs/Web/CSS/@media
