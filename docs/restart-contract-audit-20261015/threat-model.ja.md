# 巻戻しの脅威モデルとfail closed

46試験はfile CAS、短時間の並行更新、receipt/replay/revokeの契約試験だった。正常な古いblobへの復元耐性、実OS store保護、実daemonの再開を証明していない。今回のnegative controlでは、解除後に解除前の同じ正常blobを戻すと、同一bindingでold renewalがcurrentに戻った。試験成功はこの不足を再現できたという意味である。

## 保護する状態と攻撃能力

保護対象はcredential bundle、family/epoch、used hash、revoke、本人approval revision・expiry、owner/client/resource/scope、daemon/Console世代とcontinuity、親folder identity、clock floor。正常な古いblobをbackupや同期で戻す操作と、保存directoryを書けるactorによる差替えを考える。bindingを変えず、checksumや有効な保護blobをそのまま再利用するため、schema/checksum/binding検査だけでは防げない。

独立anchorを使う方式の前提は「そのactorはheadを戻せても、anchorの履歴・最終sequence・revokedを同時に戻せない」である。headの隣の別file、同じ復元対象内のclockFloor/fence、単なる別directory、ローカルの署名/MAC値、vault.protected=trueというmarkerだけを独立anchorとはみなさない。anchor全体も同時に巻戻る場合、今回のmock判定は古い一致を許すnegative controlを含む。独立性は未実装・未証明。

同じ本人権限でtrusted installed codeや実行processを改変できるactor、Pi/SDK/extensionsの任意実行、OS/kernel/admin、全machine snapshotの巻戻しからの隔離をConsole管理APIが提供するとはしない。親folder許可はPiのOS sandboxではない。外部公開endpointからの認証・アクセス境界と、ローカル保存の巻戻しを分ける。

## 再開時の判定（提案mock、実装済保護ではない）

| 条件 | 必須の扱い |
| --- | --- |
| anchor missing/unreachable/unknown、identity不一致 | cold/closedのまま。復元headを初回登録とみなさず、anchorを自動作成しない |
| head/anchor sequenceまたはblob digestの不一致（どちらが新しくても） | partial commit/rollbackとして閉じる。headを正と推測して補修しない |
| anchor revoked、結果不明、prepared receipt、writer fence不明 | key読戻し・公開・renewal・管理操作を拒否。解除完了とも断定しない |
| owner/client/resource/scope/parent identityやapproval revisionが不一致 | 閉じる。clientInfoや表示名、自己申告のattested-restartでは救済しない |
| approval/credential/recovery期限切れ、clock floor逆行、無期限の本人明示なし | 閉じる。credential更新によってgrantを延長しない |
| approval/senderの現在性不明、runtime epoch不整合、まだadmission停止を確認できない | 閉じる。vaultだけ復元して旧runtimeを生かさない |

anchor確認は秘密の復号/返却より前。外側headのdigestとsequenceを読み、独立anchorと照合してから、同bindingの保護stateを読む。その後もapproval/parent/runtimeを確認し、keyをstageしても新規admissionは閉じる。headとanchorの保存・最終再確認が完了した時だけ、runtime内部の同一排他境界でepochとadmissionを切替える必要がある。各awaitの間に通過できる外付けbooleanだけでは足りない。

headとanchorは別保存単位になり得るため、途中失敗はavailabilityを失ってもfail closed。安全なjournal/sequence予約と回復手順は未実装。ownerがrevokeしたことをanchorへ記録できない場合も、runtimeを閉じて「解除の永続化結果不明」と示し、正常完了と返さない。送信済本文や作成済repoの削除とは別である。

## 選べる二つの方針

- 独立anchorを導入しない場合: 再起動後の自動復元を無効にし、本人browserで再確認して新しいfamilyを作る。以前のstate/renewalから新bootへ権限を再構成しない。人がランダムキーを作る必要はないが、再起動時の本人確認は増える。このfallbackも実sourceには未接続。
- 再起動後も無操作で復元する場合: 保存の復元対象と独立し、認証されたCAS/単調sequence/revoke/current bindingを提供するanchorが必要。既存のOS/外部serviceにその契約があるとは確認していない。DPAPI成功記録をその証拠に流用しない。

この選択を本人が決めるまでは、自動復元を約束せずrealConnectionReady=falseで止める。
