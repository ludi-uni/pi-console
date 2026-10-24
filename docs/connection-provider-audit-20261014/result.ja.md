# 実接続準備の読取り調査

現時点で本人がキー入力・再起動・新規ログインを行っても、未接続の provider は埋まらない。いま必要な本人操作は 0。先に実装側で残件を解決し、レビューできる変更を準備する必要がある。

再利用候補は見つかったが、continuation の実 identity / protected vault / durable epoch をそのまま満たす既存 provider は、今回の調査範囲では見つからなかった。新規実装は行っていない。

## provider の再利用可否

| 必要な契約 | 既存の根拠 | 判定 |
| --- | --- | --- |
| 本人 browser 確認 | `server/local-owner-bootstrap.ts:33` の管理 token possession proof、literal127 専用 browser、単発2分コード、10分 cookie。`server/local-mcp-owner.ts:25` の owner verification | 初回本人確認に再利用可能。client identity / 再起動証明には代用しない |
| Console の正しい同一稼働世代 | `package/server-manager.mjs:317` の challenge HMAC、PID / startedAt / port / generation と ownerProof の一致 | 同一 Console の possession / generation 検証の部品として再利用可能。実 function は env/state/token を読むため今回は呼び出していない。新しい daemon / child の restart lineage は証明しない |
| 登録済み本人と解除 | `server/settings-owner.ts:8` の subject / issuer / audience と registered/revoked、`retainsApprovedIdentity` | 既存の本人 metadata・明示解除に再利用可能。以前承認した transport identity の保持を、新しい browser 権限や全内容公開に拡張しない |
| credential 用 protected vault | `server/local-owner-profile.ts:24` は JSON に read/control/final を保存し、temp + sync + rename + 0o600。`package/tunnel-binding.psm1:17` は SecureString を子環境に短期受け渡し | OS vault provider は見つからない。JSON / 0o600 / SecureString / secret reference を、Windows の credential 保護・rollback防止・永続更新 vault と数えない |
| durable epoch / replay 分類 | `server/local-mcp-grants.ts:44`、`server/workspace-permissions.ts:43`、`server/runtime/prompt-receipts.ts:17` に revision、request receipt、lock、sync、rename、未確認再送拒否 | 保存・照合の規約は参考にできる。現在の `credentialEpoch` は `server/trusted-local-mcp.ts:73` で起動ごとの UUID。renewal digest/current/used、単調 epoch、永続 clock floor、vault/runtime atomic commit を備えた完成 provider ではない |
| Folder の親 handle | `server/windows-folder-provider.ts:29` と `server/managed-workspace-registration.ts`、`server/local-folder-composition.ts:36` | 実装候補あり。descriptor / binary / runtime を検査する composition は candidate。source の契約は確認したが native をロード・試験していない。今回これを有効化しない |

関連 repo の読取り範囲は `pi-console-pi-1.1.0` の server/package、`pi-web/internal`、`pi-qoder-bridge/extensions` と scripts の source inventory、`orchestration` の source inventory。`pi-console-pi-1.1.0` は同様の管理 HMAC / prompt receipt の以前の実装。`pi-web/internal/auth/auth.go` は一つの token と cookie の middlewareで、Console continuation family の認証・vault・epoch ではない。`pi-qoder-bridge/extensions/index.ts` の `qodercliAuth` / `accessToken` は別サービスの model provider 資格であり、Console の client identity に再利用しない。SDKを実行したり、その auth/profile ファイルを読んだりしていない。`orchestration` では今回の source 拡張子検索に該当する実装を見つけていない。調査範囲外まで不存在を主張しない。

## daemon と child の確定事項

公式 repository の確認 revision は **10995608eeefac930f7199bccbb146378f883de8**。

同 revision の [stdio_command.go](https://github.com/openai/tunnel-client/blob/10995608eeefac930f7199bccbb146378f883de8/pkg/mcpclient/stdio_command.go#L100) は child stdout EOF / stdin 書込失敗で shutdown を要求し、[child exit](https://github.com/openai/tunnel-client/blob/10995608eeefac930f7199bccbb146378f883de8/pkg/mcpclient/stdio_command.go#L183) も stopping 中でなければ shutdown を要求する。再生成の公開操作はこの implementation に見つからない。**この revision で child を終了させる交換は、daemon を維持する手順として採れない。** Harpoon の initialize-restarting wrapper は in-memory 互換用であり、stdio child の交換機能ではない。[transport provider](https://github.com/openai/tunnel-client/blob/10995608eeefac930f7199bccbb146378f883de8/pkg/mcpclient/transport_provider.go#L62)、[shared connection](https://github.com/openai/tunnel-client/blob/10995608eeefac930f7199bccbb146378f883de8/pkg/mcpclient/shared_connection_transport.go#L23)

stdio は channel ごとの同じ child connection を共有する。deadline/cancellation に対する connection 保持は process hot swap ではない。単に initialize を送り直す、TTL を待つ、ファイルを書き換えるという行為では、稼働 Node process 内にロード済みの companion 実装は交換されない。Console の `package/local-folder-mcp.mjs:180` も起動時に session を一つ作る構造で、外からの reload entry はない。

[公式 deployment contract](https://github.com/openai/tunnel-client/blob/master/docs/configuration.md#stdio-deployment-limits) は同じ Tunnel ID の同時 daemon を禁止し、更新時の短い重複も禁止する。置換時は旧 instance 終了後に新 instance を開始する。shared child は chat ごとの認証境界にならない。

公式 [client instance](https://github.com/openai/tunnel-client/blob/10995608eeefac930f7199bccbb146378f883de8/pkg/clientinstance/client_instance.go) は process ごとに生成する opaque ID。この値や clientInfo を署名・possession proof / restart attestation とみなさない。公式 [Windows process identity](https://github.com/openai/tunnel-client/blob/10995608eeefac930f7199bccbb146378f883de8/pkg/codexplugin/session/process_identity_windows.go) は一つの process handle から作成時刻・exe pathを採る部品で、[照合](https://github.com/openai/tunnel-client/blob/10995608eeefac930f7199bccbb146378f883de8/pkg/codexplugin/session/process_identity.go) はPID再利用を拒否する。これは process 同一性の候補であり、Console が承認した owner/scope と後継 child を結ぶ完成 provider ではない。今回はその OS 関数を呼んでいない。

## 未知点と実証が必要な事項

使用中の固定 exe と上記 revision の対応は **UNKNOWN**。source 記載の exe SHA は `1946de55a038313a9b9b2458d05fe1719fa9cf1f20a94dd5f38fc26a98bfdd42`。公式 release metadata 19 releases / 498 assets の digest に直接一致はなかった。ただし Windows release は ZIP を配布するため、ZIP digest と内部 exe digest は別であり、不一致から unofficial / incompatible を導かない。公開 artifact 内 exe と固定 hash の照合、release→commit の対応確認が残る。今回 archive のダウンロード・binary 読取り/実行はしていない。

固定 binary の child終了挙動、Windowsでの終了確認、初回一度の置換、後継 client proof、vault の原子的 rotation/recovery、clock rollback、Console と daemon restart の整合は実証未済。現 official source の事実を、対応不明の固定 binary の実測 PASS に置き換えない。

公式 [権限資料](https://github.com/openai/tunnel-client/blob/master/docs/permissions.md) の runtime Read+Use と管理用 Manage/admin key は別。env/file secret reference は保管 provider ではない。Control-plane runtime key、Console 管理 possession proof、用途別 MCP key / renewal を共用しない。

## 次に本人が承認・操作する最小手順

いま新しい承認質問やログインは出さない。以下の前提を実装側で先に満たす。

1. 固定 binary↔公開 artifact/source を読取りで対応付ける。identity / vault / durable epoch provider を接続し、credential・grant を有効化しない受入を完了する。source の具体的な差分と OS vault 使用条件をレビュー可能にする。今回は禁止されている新規実装・OS vault 受入を勝手に開始しない。
2. 稼働 child が古い場合は、対応が確定した binary の契約に沿う **初回一度の更新** を準備する。現 revision では旧 daemon の終了確認→新 daemon一つ起動の手順になる。無停止 child 交換を約束せず、対応確認前に停止を依頼しない。Pi / orchestrator がその時点で停止していることと、本人の実更新承認は別途必要。過去の停止回答を現在の確認や新承認として使わない。
3. 準備完了後、本人は一か所の連携画面で **「ローカル連携を始める」→既存本人 browser 確認→親 folder / 操作 / 期限を選んで明示許可**。初回3本のキーを本人が作成・貼付する工程は不要とする。OS protected 保存を含む開始確認は同じ操作の中で用途を明示する。
4. 対応 MCP client が既存接続を未選択の場合だけ、その client で対象 tunnel / connection を一度選ぶ。その後は metadata-only の接続確認を一度行う。既に選択済みなら選び直さない。通常 credential 更新は内部処理とし、本人の再承認を繰り返す手順を完成 UX と数えない。

従って本人操作は、前提が満たされた後の「必要なら初回更新承認」「一回の browser/親許可」「未選択 client の接続選択」に絞る。対応しない client は期限切れ時に明示停止し、万能な自動連携を約束しない。Folder 許可は任意 Pi command の OS sandbox でも、run/history/final 本文公開でもない。解除は既存の本人連携管理一か所に結び、作成 repo や送信済み本文の削除とは分ける。

## fixture の残存確認

保持された HTTP 所有記録 **57件 / 4 PID（74352,80924,82548,87292）** を `Get-Process -Id` の読取りだけで照合し、全4 PID が不在だった。記録自体も全件 closed=true。current process の command line / env / profile、実 Console や tunnel の status endpoint は取得していない。他 process を検索・停止していない。

初期 run の失われた PID/start 記録は復元できず、その部分は **UNKNOWN**。全 system の残存 process がゼロとは断定しない。保持されたPIDが再利用されていれば、PIDだけで所有を判断しない方針だが、今回該当PIDは存在しなかった。

今回は source/公式資料の読取りと新しい報告書の保存のみ。実 key/grant 読取、OS vault、daemon、MCP有効化、設定・通信設定変更、本番適用、新規実装、試験実行は0。pi-warden の source/dist/試験/設計/OS isolation には触れていない。
