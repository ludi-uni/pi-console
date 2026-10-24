# directory modeの達成範囲と残る課題

今回のdirectory modeは作成系のみ。本人が求める「許可directory以下を操作」全般は未達。試作は登録workspace不要の対象選択・権限確認をレビューするもので、通常のfile作業を一通り行える完成品ではない。

## file操作

現在のfolder APIのlistは、許可rootと作成結果のmetadata照合。既存file/child一覧や本文を返すものではない。portにはrelative directory open、新規exclusive directory/file作成、identity確認、close等があり、既存fileのenumerate/read/write/rename/unlinkの公開操作がない。固定repo生成時のfile writeを、任意file編集の許可へ読み替えない。

安全に追加するには、次の部品と別の検証が必要。今回実装していない。

- **一覧・read**：許可したhandleからのbounded enumeration、relative componentごとのopen、全ancestorとfinal fileのreparse・volume/file identityの検査、hardlink/aliasの扱い、read size／種類の制限、expiry/revokeの直前guard。未知なpath／volume／identityは拒否する。
- **write・編集**：新規と既存overwriteを別operationにする。既存handleに結びつくread→編集→保存のversion/identity照合、hardlinkによるroot外の同一fileへの影響の拒否、share/replace競合、size limit、途中write／flush失敗のreceipt。任意pathのfs.writeFileへ置換しない。
- **rename・delete**：sourceとdestination双方のrootとidentityを保持して照合し、root自体・範囲外・別drive・未知のreparseを拒否。既存name競合、削除対象とrecursive境界、部分失敗を別契約にする。現portにrename/delete APIがないためdisabledのまま。

これらはfile操作の課題。Windows native handle／sharing／実TOCTOUの耐性を今回のmock試験だけで証明しない。新しい安全なfile操作を通すにはprovider／scope API／ownership receiptと独立受入が必要。

## 任意shell／process実行

cwdをrootに設定しても、processはroot外のfile・network・子process等へ到達し得る。directory permissionやfile APIの保護を、任意shellのOS sandboxとは扱わない。実行を提供するならfile操作とは別に、許可するprogram/引数/環境/入出力と、実効的な制約の証明が必要。現在その安全契約は未確認で、今回は実行APIを追加しない。Pi/SDK/extensionsの信頼前提もdirectory隔離に変わらない。pi-wardenは凍結対象のまま。

固定の空repo構造はmemory内の固定.git file生成で、Git process・任意shell・hooks/template・clone/pushを起動していない。実Git認識も今回の受入外。

レビューでは、対象の二択、workspace登録不要、root・対応操作・期限が同じ導線で分かることを先に確認する。「file一般操作までできる」という誤解があるなら受入未達として残す。正式な新permission有効化と本番適用は別確認。
