# 固定binary照合の恒久記録

既存資料の固定 exe hash は、公式 **v0.0.15 Windows amd64 ZIP 内の exe と一致**した。tag commit は `a390c168ff1b2d14e73a95991c186c6aba3ff5a0`。source上でも child終了/EOF/write failure→daemon shutdown要求であり、無停止child交換は採用しない。

- [原結果](result.ja.md)：Temp完了時点の記述をそのまま保全。保存場所についての「このTemp」は原記録の場所を指す。
- [機械可読の確認結果](verification.json)、[archive/exe比較](v0.0.15/comparison.json)
- [release tag→commitと公開asset URL](tag-source.json)、[source URL・SHA-256](source-manifest.json)、[Git blob一致](source-git-verification.json)
- [公開metadata取得のhash/host記録](public-metadata-transfers.json)
- [次の公開dummy DPAPI受入の承認案](os-vault-dummy-approval.ja.md)：**未実施・未承認**。実credentialの操作は含まない。
- [追記前README](README.before-append.ja.md)、[保全・変更範囲](preservation.json)、[本資料の整合manifest](integrity.json)

ZIP SHA-256: `3b53133a1e24d43f63088d843860cb1701a4c3ed6390de2e19f69089e43bddc1`。

exe SHA-256: `1946de55a038313a9b9b2458d05fe1719fa9cf1f20a94dd5f38fc26a98bfdd42`。

公式 [release](https://github.com/openai/tunnel-client/releases/tag/v0.0.15) と [対応 source](https://github.com/openai/tunnel-client/blob/a390c168ff1b2d14e73a95991c186c6aba3ff5a0/pkg/mcpclient/stdio_command.go) に対応付けた。公開SBOMのexe hash、および公開provenanceのZIP/SBOM digest・resolved commitも読み合わせた。Sigstore署名・証明書chain・透明性ログの暗号検証、再現build、実動作は未実施。

現行exeを今回読んだという証明ではない。実行・service操作・実vault・credential・本番code/config変更は0。原Tempの公開archive/exeそのものはこのdocsへ複製せず、非秘密の結果・hash・URL・未検証事項を保全する。前段26/26のdummy証明と今回の配布物照合を、実接続やvault受入のPASSに合算しない。
