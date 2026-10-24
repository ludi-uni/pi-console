# 統合反映・brokerのみ起動 — 現在job確認待ち

承認範囲は216件合格候補の統合反映、Consoleだけの正規管理再起動、broker transportの起動確認。接続資格の生成/更新、保存接続の実復元、grant/scope/期限変更、実接続試験、新規申請は行わない。PC全体やVTS等の他アプリの起動/終了も対象外。

## 完了した作業

- 候補sealとsource140ファイルを現行Dと照合し、競合0。HEADは23815ba260320e3fc720ad3288ca89728f99b4f7。既存差分はtracked15・untracked336で、reset/commitはしていない。
- 変更前の公開source8ファイルを本作業Tempのsource-beforeへ保全した。新規4ファイルは既存pathがないことを確認。候補12ファイルのbytes/SHA一致。
- 既存の保護state/owner/profile/workspaces/管理state/token/lock等14項目はmetadataだけを記録。内容を手動取得・復号・コピーしていない。dist37ファイルと既存Codex設定のhashも照合した。
- 正規管理statusはPID43932、startedAt=2026-10-20T01:16:33.010Z、0.5.2、127.0.0.1:31717、running/managed。
- 停止前に既存startupEnvironmentを確認し、インストール済みPi1.1.0のpublic selector/manifest/cliへ解決できた。readonly MCP OFF。Pi自体は起動していない。
- apply.mjs、restart.mjs、broker-only.mjsを準備した。前2つは現在jobなしの本人確認を記録したjob-confirmation.jsonがなければ動かない。実行していない。

## broker操作の分離

候補の既存正規管理export ensureManagedResumeBrokerだけを、新しいNode processから使う。GET管理identityと専用HMACのPOST管理broker-openだけで終わる。server側はlocalOwnerBootstrap.startBroker→open（listener作成）のみで、owner-login issue、bootstrap code/cookie、localResume.get、DPAPI、資格issuerを呼ばない。

このため、新たな本人認証や永続grantを必要とせず、brokerだけを資格処理から分離して起動確認できるコード境界になっている。今回はまだ実呼出をしていない。拒否や不確実な応答は繰り返さず、必要なら正規read-only helperで結果状態だけを照合して止める。新規申請や別経路へ迂回しない。

## 残る前提 / status: pending

**現在のPi実行・orchestratorが停止中か、未確認。** 管理APIには実行件数がなく、run/history本文や秘密を取得しない条件で、その代わりに過去の停止回答を今回へ流用していない。再起動で別jobを中断しないため、親から本人への現在状態確認を待つ。本人への重複質問は送っていない。

これは操作の拒否でも結果不確実でもなく、稼働job確認という前提がpending。統合反映、stop/restart、broker起動はいずれもまだ0回。資格/接続/権限操作0、他アプリ操作0。候補自体の保全・競合チェックは完了した。

証拠root: C:\Users\leade\AppData\Local\Temp\pi-console-on-demand-apply-20261020-813c。before.jsonとsource-before/。現在状態確認後、反映直前にhashとmetadataを再照合し、許可範囲だけを進める。
