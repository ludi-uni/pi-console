# 既定OFF候補のリリースbuild確認

旧隔離実装のseal868件を照合し、同じ候補329ファイルを新しい所有Tempへコピーした。実装済みsource23件は変更していない。

既存導入済みTypeScript 5.9.3 / Vite 7.3.6で、package buildの内容（tsc --noEmit → vite production build）が成功。tsc終了0、Vite終了0、328 modules変換、静的成果物13件。既存vite.config.tsのindex/owner両entryを使い、cache/env/outputを所有Tempへ分離した。実.envやprofileは読んでいない。設定はNode native loaderで読み、node_modules/.vite-tempへ書くbundle config loaderを避けた。

依存のインストール・更新・package lifecycle hookは0。一時node_modules参照は所有Temp内に限定して終了時に削除した。検査した既存依存6ファイルのhashは不変。Node server/SDK worker/実client/新Windows portは起動していない。

default OFFのsource23件とdist13件をrelease-default-off.zipへ格納し、全entry hashを検証する。activation-previewを含めない。before/afterの対象はdeployment-manifest.json。現行本番dist20ファイルは読取hashのsnapshotだけで、実backup/置換は行っていない。旧assetは配布時も削除せず保持する方針。

74件のdummy/fake受入と5枚のheadless UI画像は前段の確認であり、今回再試験していない。build成功を新Windows transport/実profile/実client/本番Windows E2E成功へ一般化しない。差と限定確認案はwindows-verification.ja.md、本人へ返す適用承認文案はapproval-text.ja.mdに分けた。

既定OFF配布の承認と、新規連携有効化・資格生成・grant作成を分ける。後者は今回の候補に含めない。managed再起動時は従来どおり管理用server-tokenが更新されるため、承認文案にも明記した。
