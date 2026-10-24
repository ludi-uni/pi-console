# 認証・状態整合性レビュー

対象: package の client state / enrollment / stdio session / installed facade の 4 ファイルと受入テスト。自己レビュー。native entry の実行はしない。

修正済みの必須事項:

- client-state の reconnect: 明示対象を helper 前・helper 後に再照合。private resume 応答待機中の対象/epoch/proof/grant 差し替えは保存前に停止。
- client-state の credential_expired 分岐: 応答 connectionId が違う場合、renewal intent の保存前に停止。
- client-state の accept / beginRenewal: 対象 ID を保護 transaction 内でも照合。元 record が失われたとき continuation save から新しい record を作らない。grant 期限の変更を受け入れない。
- stdio session の get: 再起動後の target 不明を自動復元しない。取消は explicit cancel、初回再照合は元の explicit begin。初回 proof 不足・期限切れを continuation として扱わない。
- preview: 初回 enrollment は対象 connectionId を永続化していないため `initial.target=unknown`。client が保有する enrollment proof から server 発行初回 claim proof の有無を推定しない。serverGrantState は常に unknown。
- メタデータのみを返し、生 record・proof・renewal・token・owner/SID・broker 世代/署名・例外内容を返さない。secret に似た 64 桁 hex を含む target 引数を echo しない。保護読取後の期限・clock を再評価。

修正後に未解決の必須 finding はない。focused 58 件と影響範囲の既存 pure 162 件が通過した。

検証限界:

- 実 DPAPI / SID / file backend / helper / native entry / client 接続は未実行。installed facade の inspect 配線は source レビューと node --check のみ。稼働への適用前に別許可が必要。
- preview は local record と local clock の観測。server の現在の grant 解除・親の状態・接続可否を証明しない。client schema に durable clock floor がなく過去の時計巻戻りを local metadata だけから断定できない。既存 server の認証、grant、clock floor、親検証を維持する。
- 対象差し替えが保護 transaction の開始と競合した場合、既存の fail-closed / commit unknown 契約に従う。dummy では protect/commit が 0 の拒否を確認。自動 repair / lock 削除は追加しない。
- 初回 server-issued claim proof を永続化・復活する機能は追加しない。旧 request / broker 世代を引き継ぐ範囲は既存の期限内契約のまま。

今回の範囲内に UI / ブラウザー API の変更はなく、MDN Baseline の追加採用判断は不要。
