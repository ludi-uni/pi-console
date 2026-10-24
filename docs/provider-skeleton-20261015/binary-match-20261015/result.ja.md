# 固定 hash と公式公開配布物の照合

**固定 hash は公式 v0.0.15 Windows amd64 配布物の exe と一致した。** 現行 exe の読取り・実行はせず、既存資料の固定 hash と今回取得した公開物だけを比較した。

| 項目 | 結果 |
| --- | --- |
| 公式 release | [v0.0.15](https://github.com/openai/tunnel-client/releases/tag/v0.0.15)、公開 2026-09-25T04:40:41Z |
| 配布物 | `tunnel-client-v0.0.15-windows-amd64.zip`、28,098,744 bytes |
| ZIP SHA-256 | `3b53133a1e24d43f63088d843860cb1701a4c3ed6390de2e19f69089e43bddc1` |
| ZIP の照合 | GitHub release API digest と公式 SHA256SUMS.txt の両方に一致 |
| ZIP 内 exe SHA-256 | `1946de55a038313a9b9b2458d05fe1719fa9cf1f20a94dd5f38fc26a98bfdd42`。既存資料の pin に完全一致 |
| tag commit | `a390c168ff1b2d14e73a95991c186c6aba3ff5a0` |
| source | この commit から6ファイルを保存し、全6件の Git blob SHA が commit tree に一致。VERSION は `0.0.15` |
| 公開 SBOM | release API digest に一致。exe の SHA-256 一致項目が1件 |
| 公開 provenance statement | ZIP subject digest、SBOM subject digest、resolved Git commit、workflow repository/ref が一致 |

取得時期を示す既存資料の日付（2026-10-05）より前の最新公開 release を第一候補にした。候補選択は推測だったが、その後の exe hash の完全一致が根拠となった。Windows ZIP 候補の取得はこの1件だけで、別versionへの置換・更新はしていない。

## source から確定できた制約

対応 commit の [stdio lifecycle](https://github.com/openai/tunnel-client/blob/a390c168ff1b2d14e73a95991c186c6aba3ff5a0/pkg/mcpclient/stdio_command.go) は、child stdout EOF・stdin書込失敗を shutdown 要求へ結ぶ。`waitForExit` も停止処理中でなければ同じ要求を行い、`requestShutdown` が Fx shutdowner を呼ぶ。保存した raw source の該当行は111、117、194–212、227–243。

[transport provider](https://github.com/openai/tunnel-client/blob/a390c168ff1b2d14e73a95991c186c6aba3ff5a0/pkg/mcpclient/transport_provider.go) は stdio に context-cancellation-preserving shared connection を使用する。これは子processの交換APIではない。対応 source に基づく判断として、**childを終了させて daemon を維持する更新手順は採用しない**。実更新が必要なら、本人が承認した別段階で旧daemonの終了確認→新daemon一つ起動を検討する。今回はその操作をしていない。

## 証明の境界

解消したUNKNOWNは「既存資料の pin hash に一致する公式公開 exe がどの release にあるか」と、その release tag / source commit の対応。公開 provenance の本文の読み合わせまで行った。

残るUNKNOWN / 未実施は次の通り。

- Sigstore署名・証明書trust chain・透明性ログの暗号検証は未実施。公開 statement の記載一致を、暗号検証済みattestationと表現しない。
- 再現build、実行時のchild/daemon終了、Windowsでの終了確認、現行machineのbinary/runtime状態は未実測。
- 現行 exe は今回読んでいないため、現在そのpathにあるbytesが pin と一致するかは今回の観測に含めない。
- identity / issuer / protected vault / durable epoch backend はこの照合で実装・有効化されない。実接続・本番更新の承認にもならない。

## 対象・取得先・保全

この所有 Temp 内だけに保存。取得先は `api.github.com` の `openai/tunnel-client` metadata、`raw.githubusercontent.com/openai/tunnel-client/<commit>/...`、公式 release の `github.com` → `release-assets.githubusercontent.com` のみ。download redirect は自動追従を切り、hostを検査してから追跡した。認証を使用せず、未知host・401/403には進まない。今回その停止条件には遭遇していない。署名付き公開download URLのqueryは記録・チャットに出していない。

ZIPは全entryについてpath traversal、absolute/device-style path、symlink/reparse属性、entry数・総展開量の上限を検査し、対象exe1個だけを固定した所有pathへ展開した。展開した exe は保存・hash読取りだけで、一度も起動・ロードしていない。sourceやrelease workflowも実行していない。

受入記録は `verification.json`、`v0.0.15/comparison.json`、`source-git-verification.json`、`public-metadata-transfers.json`。HTTP client / stream / archive handleは終了時に閉じた。実serviceやlistenerは起動していない。現行binary、daemon、credential、OS vault、本番source/dist/configへの操作0、画像0・UI操作0、pi-wardenへの操作0。

この結果と公開archive/SBOM/provenance/sourceはレビュー用に保全する。実運用操作へ自動継続しない。
