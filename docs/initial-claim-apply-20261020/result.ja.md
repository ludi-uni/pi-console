# 初回claim修正 — Dへ適用・管理再起動完了、新規申請は保留

2026-10-20。対象はD:\Develop\pi-consoleだけ。本人の適用/再起動承認 Sentinel_0f642298b33881919b6cd1bdf25429ed と、現在jobなしの回答 Sentinel_6ebca0beddd08191b28de3ba3f413341 に基づき実施した。既存MCP資格の通常復元/更新を伴い得る新規申請は、親の指示通り保留した。

## 反映と受入

候補seal・既存source138ファイル・各対象hashを照合し競合0。変更前3実装をTempのsource-beforeへ保全し、次の4ファイルを候補と同じbytesで適用した。

- server/folder-mcp.ts
- server/local-mcp-composition.mjs
- package/local-resume-session.mjs
- tests/local-resume/initial-handoff.test.mjs（新規）

反映後のD sourceで、既存local-resume79件 + 新規27件、**106/106 PASS、失敗0**。memory/fake provider、公開dummy codecと所有literal127 HTTP fixtureだけ。OS暗号0、native専用試験0、通常npm testは未実行。fixture PID42856/127.0.0.1:60246はallClosed:true、process不在も確認した。候補段階の106件とは別の反映後確認で、212種類の試験という意味ではない。

## 正規管理再起動

停止前に既存startupEnvironmentでインストール済みPi1.1.0のpublic selector/manifest/cliへ解決。既存restartManagedServerを**1回**呼び、追加インストール・設定変更・手動kill・再試行はない。

| 項目 | 結果 |
| --- | --- |
| 新runtime | **PID43932 / pi-console0.5.2** |
| identity startedAt | **2026-10-20T01:16:33.010Z**（JST10:16:33） |
| listener | **127.0.0.1:31717** |
| 起動 | Dのserver-managerとStartup resolver、既存D server/index.ts |
| 実行ファイル | C:\Program Files\nodejs\node.exe |
| 旧runtime | PID26656終了・不在 |

正規管理helperの認証済みidentity/statusと新PID/開始時刻が一致。processは限定PIDの実行ファイル/開始時刻だけ確認し、CommandLineや環境一覧は取得していない。sandbox側からhost processが見えないため、限定metadataはhost側の読み取りで確認した。新runtimeは稼働中。Pi実行/orchestratorの開始なし。

## 保全の最終照合

新規回帰を含む139ファイルで期待hash一致。元のbaseline138のうち対象実装3だけが候補hashに変わり、その他135は不変。既存未コミット変更を維持した。**dist37ファイルは全hash不変**、既存Codex設定もhash不変。UI build/dist配布は不要な変更であり未実施。

settings-owner.json、workspaces.json、local-mcp-enrollment/state.dpapi、local-mcp-resume/state.dpapi、local-mcp-client-state/state.dpapi等、既知8項目の存在/size/mtime/file identityは開始前・反映直前・再起動後で一致。lockも新しく残していない。保護state本文を手動取得/復号/コピーしていない。正規管理helperは承認された通常lifecycleとして既存token/.envを内部利用し、管理用per-start tokenを通常通り更新するが、値は出力していない。MCP用途別資格bundleの復元/更新やgrant変更とは区別する。

## 保留範囲と本人の次操作

再起動自体はMCPサービスのgetを呼ばず、通常復元は遅延される。今回は管理identity/statusだけを確認し、resume/request・view・get/claim/resume/renew/rpc、owner-loginは呼んでいない。保護stateのmetadata不変も確認した。

新規申請に旧grant更新の論理上の必要はないが、現実装は初回サービス読込で全保存familyのrestoreをawaitしてからrequestを扱う。主な対象候補はfcf3c891-84b6-4b2a-a074-8dd4637aeaa5で、本人観測の7日grant期限は10/27 09:29:05 JSTと未来、UI expiredは短期資格切れだった。approvedが維持されていれば5分bundleを更新し得る。owner解除済みrevokedやgrant期限切れを復活する処理ではない。現在のprotected store全一覧を資料だけで断定はしていない。

調査詳細は **docs/initial-claim-restore-analysis-20261020/result.ja.md** に分離した。4接続の公開履歴、状態別条件、発生契機、新申請との結合、client切断とowner解除の違いを記録している。

**新申請ID/期限は未発行。本人への新しい操作依頼はなく、質問は親へ集約する。** 「ローカル連携を始める」「接続一覧を再取得」も初回service読込を起こすため、今は押すよう指示していない。後続でも古いIDを再利用せず、試験親・list/directory/repo/workspace・7日を本人最終承認とする方針を維持する。

## 操作数と証拠

実装3 + 新規回帰1の適用、dummy106件、正規管理restart1回。dist変更0、MCP資格操作0、grant変更0、新規申請0、実client起動/接続0、実データdirectory/repo/workspace作成0、画像0、UI確認操作0。commit/push/publish、pi-warden作業なし。

証拠: before.json、pre-apply-verification.json、job-confirmation.json、source-application.json、installed-acceptance.tap、runtime-application.json、final-verification.json、process-metadata.json。途中の未適用報告はpre-approval-checkpoint.ja.mdに保全した。

作業root: C:\Users\leade\AppData\Local\Temp\pi-console-initial-claim-apply-20261020-a73d。元候補docs/initial-claim-fix-candidate-20261020は封印のまま保持。
