# 統合反映・管理再起動・broker起動確認 完了

2026-10-20。本人の現在jobなし確認後に再照合し、承認済み範囲の **統合反映 → Console管理再起動 → broker transportのみ起動確認** を完了した。接続資格の作成/更新、保存接続の復元、実MCP接続試験、権限/期限変更は実施していない。

## 適用と検証

- 候補sealと現行source140ファイルを再照合、競合0。既存変更前source8ファイルをTempのsource-beforeへ保全。候補12ファイル（既存8更新・新規4追加）を候補と同じbytesでDへ統合した。
- 反映後のD sourceで選定したdummy受入 **216/216 PASS、失敗0**。管理brokerの新機構はfake IO、接続復元/更新はmemory/fake providerだけを使った。実資格を使った接続試験ではない。型検査済み候補と同一hashであることも照合した。
- 既存transport回帰1件の所有HTTP fixtureはPID3384 / 127.0.0.1:64182、allClosed=true、試験runner終了済み。OS暗号/native専用試験は実行していない。
- 最終144 sourceファイルが期待hash一致。元baseline140のうち対象8だけを更新し、他132は不変、新規4を追加。dist37ファイル、既存Codex設定、HEAD23815ba260320e3fc720ad3288ca89728f99b4f7は不変。既存未コミット変更を維持し、commit/reset/push/publishはしていない。

## Console管理再起動

既存startupEnvironmentで停止前にインストール済みPi1.1.0のpublic selector/manifest/cliを解決し、正規restartManagedServerを1回呼んだ。Pi自体の実行やインストールはない。新旧runtimeの所有は正規管理helperの認証済みidentityで照合した。

| 項目 | 確認値 |
| --- | --- |
| 旧Console | PID43932、startedAt 2026-10-20T01:16:33.010Z |
| 新Console | **PID41232、version0.5.2** |
| 新identity startedAt | **2026-10-20T06:33:21.560Z**（JST15:33:21） |
| Console listener | **127.0.0.1:31717** |
| 管理再起動 | **1回**、再試行なし |

## brokerだけの実起動確認

2026-10-20 **06:34:24.629–06:34:24.663 UTC**（JST15:34:24）。新しいNode processから既存正規管理export **ensureManagedResumeBroker** を1回呼んだ。新しいHMAC管理POSTが本人loginと分離して既存listener開始だけを行い、戻った署名付きdescriptorを検証できた。

| 項目 | 結果 |
| --- | --- |
| broker受付 | **127.0.0.1:56113** |
| 結び付くruntime | **PID41232 / startedAt06:33:21.560Z** |
| 結果 | broker_transport_verified_no_connection_calls |
| ensure要求 | **1回** |
| fallback / read-only追加照合 | **0 / 0**（初回で成功） |

helperは管理identity GETと専用broker-open POSTだけを使った。owner-login、bootstrap code/cookie発行、localResume.get/view/claim/resume/renew/rpc、接続client起動は呼んでいない。descriptorのsignature・nonce・管理token等は保存/出力していない。記録は検証済みhost/port/PID/開始時刻と固定状態だけである。

この結果は**受付が起動し、管理proofでその所有を確認できた**という意味。fcf等の保存済み接続を復元した、MCP資格を渡した、Codexから実接続できた、という結果ではない。

## 認証情報・既存データの保全

settings-owner、workspaces、local-mcp-resume/client/enrollmentの保護stateとlock、既存profile/grants/workspace-permissions等、既知14項目をmetadataだけで前後照合した。資格・grant・registry側の **12項目は開始前から不変**。source以外の保護データ本文を手動取得・復号・コピーしていない。

管理再起動に伴い、既存lifecycleの **server-state.json / server-tokenの2項目だけ** は更新された。これは管理processのper-start管理記録/tokenであり、MCP用途別接続資格の更新とは区別する。値は出力していない。broker開始の直前/直後で比べると、管理2項目を含む **全14項目のmetadataが不変** であり、broker開始が保護stateや資格を書き換えていないことをコード経路と合わせて確認した。

## 操作数と残る範囲

実施: source統合12ファイル、反映後dummy216件、Console管理再起動1回、実broker起動確認1回。

**未実施0回**: MCP接続資格の生成/更新、保存接続の実復元、実MCP接続試験、新規申請、grant/scope/期限変更、実データdirectory/repo/workspace作成、owner-login、新たな本人認証、永続アクセス設定変更。PC全体の再起動、VTSを含む他アプリの終了/起動も0回。画像0、UI操作0。pi-wardenには触れていない。

拒否・不確実結果・残る阻害要因は、この承認範囲ではなし。broker/Consoleは稼働を維持して終了する。次の実接続・対象復元・資格更新は今回の対象外であり、ここから自動的に進めない。既存fcfの初回材料や元の期限/generationの問題を、この受付起動で回避したとは扱わない。

## 証拠

before.json、pre-apply-verification.json、job-confirmation.json、application.json、installed-acceptance.tap、restart.json、after-restart-data.json、broker-start.json、after-broker-data.json、final-verification.json。以前のpending段階はpreflight.ja.mdにそのまま残した。

作業root: C:\Users\leade\AppData\Local\Temp\pi-console-on-demand-apply-20261020-813c。元候補docs/on-demand-resume-candidate-20261020とsource-beforeバックアップも保持している。
