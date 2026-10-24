# セルフレビュー

対象14ファイルのreview.diffを開始時Dと照合した。認証・永続schema・concurrency・公開metadataの変更としてレビューした。

- 期限: dedicated constantとtrusted constructorだけ変更。HTTP strict fields、旧5分共有値、owner code/cookie、review最大5分、grant計算を変更していない。旧記録のexpiresAtはそのまま。期限切れの新id自動生成なし。
- 保存: purpose/schema/revision/owner bindingとCAS/guardを維持。実保存先はmetadataだけ観測。初期証明を保護してから送る順序不変。
- concurrency: session queue、UI lock、保存結果receipt維持。長いpending中の承認済み切断再開で不要なrequestを作らないよう修正。既存のforget直前crash回帰で保証。
- 公開範囲: 新しいpublic fieldはrequestExpiresAtだけ。proof/token/資格は結果へ返さない。clientInfo/名前で認証しない。親folder境界、既存exact内容共有、Pi権限/OS隔離の契約は触っていない。
- UI: owner/review失効をローカル時計で表示し、送信直前も確認。サーバー側のfresh cookie/review guardを維持。認証失敗のレスポンスだけで保存済みreceiptを消さない。OFF branchにeffect/storage/HTTPを増やしていない。
- 運用: watchなし、sourceのみ適用。dist/追加再起動/実申請/秘密操作は未実行。既知PIDの現在不在を未確認事項として明記し、現在の稼働版を推定していない。

コード上の残存blockerなし。実Windows保護・native provider・本番MCP動作は今回dummy受入の対象外。同期runtime反映は追加承認待ち。
