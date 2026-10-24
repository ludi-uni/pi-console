# 最終レビュー

必要修正として見つかった点は次の通りで、いずれも修正し回帰確認した。

- 高: local-mcp-state/file-backend。codecや保存前の失敗で旧grantが次bootに再開し得た。保護処理前に排他lockをfsyncし、不確実時に残す構造へ変更。before/rename/after/codec失敗の再起動拒否をTempで確認。
- 中: local-mcp-composition.revoke。同じrequest IDを別対象へ再送すると、拒否前に別clientを停止し得た。永続receiptの対象照合を先に行い、不一致で他clientのadmissionを変えない回帰を追加。
- 中: local-mcp-client-state。更新応答の喪失後に新IDを作るとreplay判定され得た。送信前にrequest IDを保護保存し、companion再起動後も同IDを照合する。
- 中: index/installation。既存manual profileの鍵がissuerのreserved集合に渡らず、profile不明時も新規発行を許し得た。期限切れを含む既存profileキーをstartupの既存読取結果から別集合で保持し、既存profile validatorへ自己キーを混入させず、新issuerへ渡す。不明時は発行を拒否する。実profileは今回読んでいない。

追加の必須修正所見はない。残る検証上の限界は、新Windows SID取得とasync transport/store全体の実OS動作、実profile/実client、全アプリのリリース用build/配布が未実施なこと。旧1回のDPAPI helper受入をこれらの完了とは扱わない。

保存先はtrusted managed dataDirを前提とするNode I/O。既知symlink/junction、root/file identity変化、UNC/device/相対pathを拒否するが、同一Windows本人の悪意あるprocessをOSで隔離する保証ではない。folder操作は別の既存handle-anchored providerへ依存し、不明なら拒否する。公開本文/Pi実行の境界も別のまま。外部正本・TPM・全backup巻戻し耐性は追加していない。

手順上はLudi focused TDDで既定OFFのRED（未実装module）を確認してからGREEN、機能・障害・lifecycleへ拡張した。最終74件と型確認は成果物のログで確認できる。通常npm testやOS/native専用entryは実行していない。
