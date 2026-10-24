# Dots result read：実装・隔離確認の結果

## Summary

2026-10-07 13:52:55 UTC承認。D:\Develop\pi-console / openai-codex/gpt-6.1-sol、先行子作業終了（fleet0）を確認し、単一作業で実施。新/mcp/dotsのC1/認証/隔離/更新基盤は拡張せず、4機能の共通read coreと既定OFFのツール契約を追加しました。

| 機能 | 実装 | 隔離確認 | client | 本番 |
| --- | --- | --- | --- | --- |
| 履歴/出力read | retained events＋署名cursor、gap/truncation/body欠落/保存状態、エラー/承認待ちread | PASS | 未確認 | 未反映 |
| 全体状態read | foregroundと子/queue/background coverageを分離、不明をunknown/incomplete | PASS | 未確認 | 未反映 |
| 添付/成果物read | 明示producer登録、opaque ID/run/version、8MiB上限・32KiB base64 chunk、path/identity/hash fence | PASS | 未確認（byte転送含む） | 未反映 |
| 対象metadataread | 許可対象だけの名前/canonicalpath/session、設定と実run modelを分離、未観測=null | PASS | 未確認 | 未反映 |

「実装」は共通coreの意味です。実runtimeでは保存前の全履歴、完全な子作業census、保存/実Pi run modelの確かな投影は未対応で、不明を成功へ変えません。artifact producerの自動登録も未接続。**Dotsから依頼→読むという全経路が既存接続で動く、とする完成報告ではありません。**

## Evidence

新規：`server/results-read.ts`、`server/results-read-tools.ts`、`shared/results-read.ts`、`tests/results-read.test.ts`、`tests/results-read-races.test.ts`。既存の変更はREADMEとRuntimeManagerのpassive projection、ExecutionStateの非再帰・bounded projection helperだけです。初期保全計画からhelperを1ファイル追加した理由は、既存snapshotのtree renderingを呼ばずcorrelation/modelを内部serviceへ渡すためで、旧status-only projectionには新しい項目を加えていません。

- 最終read専用20/20 PASS、fail0/skip0。
- 影響範囲回帰13/13 PASS（execution7、history hydration3、receipt2、readonly scope1）。重複実行分は数えず合計33 case。
- 最終 `tsc --noEmit` exit0。
- Vite別出力build：312 modules、2.41s、exit0。`C:\Users\leade\AppData\Local\Temp\dots-results-build-5UoMEE\dist`。configFile/envFile無効、既存distを上書きせず。frontend変更なし。500KiB超chunk警告あり（既存bundle、今回分割refactorはしない）。build後の修正はserver core/テストのみ。
- Node child環境はclear＋allowlist。テストはTemp内dummy workspace/session/children/SQL store/成果物だけ。junction/hardlinkもdummy Temp内のみ、OS/ACL設定変更なし。
- 読取りからworker.open/resume/prompt/stop/options、worker.call、orchestrator startを呼ぶと失敗するdummyで呼出0を確認。queue dispatch入口を呼ばないコードで、provider/Events/子作業を開始しません。
- generation/expiryの最終release fence、revocation中のpermission_busyと後続stale拒否、親完了子running、failed/cancelled/unknown、未許可metadata、cursor再送/append/gap/duplicate、差替え/削除/link/oversize/URL拒否、70,000-byte binaryのchunk結合と全hash、known-secret跨ぎmask/未知enum拒否を確認。

[保全manifest](dots-results-read-preservation.json)、[終了検証/source hash](dots-results-read-verification.json)、[ツール契約と限界](dots-results-read-contract.ja.md)。実history/data/credential/grantは読まず変更せず、接続切替/本番操作/download/install/OS変更/commit/push/npm公開なし。既存auth/permission/receipt/guard/endpointと先行startup証拠は保持しています。

## Blocked / minimum next operation

本文/path/artifact公開はstatus-only同意ではないため、既存endpointへの黙った追加はしていません。base scopeに加えてexact run＋feature＋expiryの追加grantを要求し、default OFF。旧endpointで新側拒否を迂回しません。auth/管理資源隔離既知リスク、controlIsolationVerified=false、更新拒否はそのままです。

貼付往復をなくすために必要な最小の次段階は、**ownerが対象featureを明示許可する操作・認証済みadapterへの明示接続・producer登録/確かなrun投影・pin client/Dotsでの取得/保存確認**です。今回その実permission/稼働接続を変える権限はないため停止しました。resource/blobは仕様にありますが実clientの取出し/保存能力は未確認で、架空URLは返さず通常tool JSONのbounded base64を用意しています。未対応clientならchunk復号/結合/保存の最小client対応が残ります。「Dotsから依頼」の既存control拒否もreadによって解除しません。
