# 次の接続確認に向けた読み取り専用整理

2026-10-20。対象は pi-console のみ。この段階では接続・復元・資格情報更新・再登録を実行しない。

## 結論

既存 fcf 接続の継続材料と現在の grant 状態は **不明**。保護ファイルの存在や更新時刻から内容を断定しない。通常の `get_local_connection {}` は状態確認専用ではなく、復元・短期資格情報更新・保存・取消処理を行い得る。また保存済み client の接続 ID に従い、呼出し側から期待する接続 ID を指定できない。fcf だけを対象とする確認として今すぐ呼ぶことは勧めない。

## 対象と期限の根拠

| 項目 | 保存済みの根拠・現在の確度 |
| --- | --- |
| 接続 ID | `fcf3c891-84b6-4b2a-a074-8dd4637aeaa5` |
| client ID | `codex-local-v1`。clientInfo は認証の根拠にしない |
| 親フォルダ | `C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019`。以前の本人観察で対象一致 |
| 申請した操作 | `list / directory / repo / workspace`。現在保存された実 scope は今回未照合 |
| grant の期限 | 本人観察記録では **2026-10-27 09:29:05 JST = 2026-10-27T00:29:05Z**。秒精度の記録であり、現在も未解除・有効という証明ではない |
| 初回申請の受取期限 | **2026-10-20 10:26:54.443 JST = 2026-10-20T01:26:54.443Z**。今回確認時点で経過済み |
| 初回申請 ID | `codex-create-retry-194caadc-6795-4c4f-9c5c-049742e0a648` |
| fcf の保存済み継続材料 | **不明**。今回内容を読み出していない |
| fcf の初回受取材料の保存有無 | **不明**。有無にかかわらず元の初回受取期限は延長しない |
| 現在の grant 状態・実 scope | **不明**。既存の本人認証済み公開メタデータを今回取得していない |

期限の根拠は `../create-trial-retry-20261020/public-request.json` と `../initial-claim-cause-review-20261020/summary.json`。grant の将来の期限と、初回受取・短期接続の期限を区別する。grant を今から 7 日間に取り直す操作は含まない。

## 今回の状態確認

`observation.json` は秘密値を出さない管理 helper `managedResumeBroker` の GET を **1 回**だけ実行した記録。broker の起動が可能な `ensureManagedResumeBroker` は呼んでいない。

- 結果は `identity_response_unavailable` / HTTP status 不明。現在の稼働停止や故障原因は断定できない。再試行・起動・別 endpoint への迂回はしていない。
- 最後に成功した配布時の証拠は 06:34:24 UTC の broker 署名照合、PID 41232、起動時刻 06:33:21.560 UTC、literal 127.0.0.1:56113。これは保存済み証拠であり今回の到達性確認の成功ではない。
- 配布時に記録した公開ソース **144 件がハッシュ一致**。
- 状態ファイル **14 件**の存在・size・mtime・file identity が、配布直後および今回観察前後と一致。保護内容は読んでいない。管理 helper 内部での既存管理認証以外に token を抽出していない。
- `local-mcp-client-state/state.dpapi` は存在するが、fcf の材料が入っている証拠にはならない。
- 観察用 script の初回実行は、保存済みソース一覧に `shared/` 等があるため安全な path 制限で GET 前に停止。公開一覧を確認し許可する source path を修正した。その後の実行で上記 1 GET を行った。通信の再試行ではない。

既存の owner `view` は公開 grant メタデータを返すが本人の有効な cookie が必要で、client 側の材料の有無は返さない。discovery / Settings status は broker・本人準備状態を返す経路であり fcf 材料の確認には使えない。保護モジュールの生の `get(clientId)` は秘密を含む record を返すため、今回手動で呼び出し、後から値を隠す方法も採用していない。

## 次の最小手順（提案。今回未実施）

1. **まず対象確認を秘密非表示で完結させる小さい差分を、隔離 copy で dummy 検証する。** 正規の保護状態モジュールに、client ID に対する保存済み connection ID、期限、継続材料の有無だけを返す読み取り専用 preview を設ける。秘密値、復号済み record、hash、URL/argv 材料は返さない。外部 endpoint から ID だけで材料を照会できる経路を追加しない。
2. `get_local_connection` 等に期待する connection ID を照合する guard を設ける。**復元・更新・取消・保存・transport 開始より先に** fcf と一致することを確認し、不明・別 ID なら止める。応答で ID を事後確認するだけでは別接続の更新を防げない。preview と実行の間でも対象を再検証する。既存 client 互換性と引数契約は候補で具体化する。
3. その候補の適用、および正規 preview の実状態読み取りを別々に承認範囲へ含める。今回の「保存証拠と読み取り専用状態確認」には source 適用や保護内容の追加読み取りを含めていないため、この段階はまだ行わない。本人のキー手入力や新規ログインを先に求めない。
4. fcf の継続材料と現在の grant を正規経路で確認できた場合のみ、**fcf の通常復元・必要な短期更新、および許可親のメタデータ一覧 1 回**を実運用の最小許可範囲として提示する。これは資格情報保存や runtime binding を伴うため別の実行許可が必要。grant の親・実 scope・元の期限は維持する。repo / workspace の新規作成はこの確認に含めない。
5. 材料が無い、grant が失効・解除済み、対象が異なる、または transport 身元を確認できない場合は停止する。経過済みの初回受取期限や再起動前 broker の世代を緩めない。必要ならその事実を示して新しい登録・grant を別途選んでもらう。既存 fcf の許可から新規登録を推定しない。

親の scope は Console 管理API の列挙・作成の境界。Pi の任意コマンドを隔離する OS sandbox や全 run / history / final 本文公開を意味しない。解除は Console 側の grant 解除で行い、作成済み repo や送信済み本文の削除とは区別する。

## 今回の操作数・保全

新規テスト **0**、画面画像 **0**、UI 操作 **0**。既存の配布済み dummy **216/216 成功**は前段の証拠であり今回再試験していない。MCP 呼出し、実接続、資格情報生成/更新/復元、grant 変更、新規申請、本人ログイン、再起動、broker 起動、実作成はいずれも **0**。source / dist / client 設定を変更していない。pi-warden、OS 専用試験、ACL・アカウント・ネットワーク設定、他アプリには触れていない。

新しい所有物は Temp の `pi-console-next-connection-plan-20261020-c2e7` と本 docs フォルダだけ。観察 script は終了 code 0、生成した listener / 常駐 process は 0。途中で停止した script も終了済み。Temp script を再実行せず、保存 JSON を参照する。`seal.json` に今回の成果物 hash を保存する。
