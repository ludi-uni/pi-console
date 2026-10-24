# 次の実装・確認と本人承認の最小単位

この文書は実行許可ではない。今回の追加OS呼出し、実資格、profile読取/移行、実grant、client接続、stop/restart、source/dist適用はすべて0。

## 実装前の固定事項

実装は稼働Dと分離し、production issuer/store/client portをfake注入できる構成にする。fixture public vector制約はfixtureに残す。変更path一覧、差分、schema、容量/receipt上限、固定保存先の解決方法、artifact hashを先に揃える。receipt満杯時は勝手に過去requestを忘れず新しい操作を止め、UIで示す。未知のファイル・symlink/junction/reparse・親差替え・異なるowner・複数writerは拒否する。

既存test一覧からnative/OS/本番起動を除外し、pure/Temp/fake/loopbackだけでproduction compositionの回帰を行う。今回の136件fixtureと公開ダミーDPAPI helper1回は参照証拠であり、未実装の本番配線の検証数には算入しない。

## 必須のdummy受入

| 場面 | 確認する結果 |
| --- | --- |
| 初回／二重click／戻る・取消 | 本人認証済みreviewだけが一度commit。未承認の実鍵・grant作成なし。 |
| 応答喪失・同ID再送・異なる内容の同ID | resultで照合。完了済みの副作用を繰返さず、内容不一致は拒否。 |
| 更新中の全await・同時呼出し | old/new credentialともdispatch不可。commit・最終guard後だけ新epochをopen。 |
| server通常再起動・companion維持 | family/期限/scope/親identityが同じ。承認期限を変更せず、内部鍵が切れていれば更新して接続。browser再承認不要。 |
| companionも通常再起動 | 承認済みclient-stateのproofで同じfamilyへ再接続。保存していないclientは再承認を案内。 |
| 期限切れ・owner/client/device変更 | 自動更新・復元を拒否。cookieを復元しない。別clientInfoで本人を装えない。 |
| 複数client | family/secret/取消を分離。一件取消は他familyを維持、owner全解除は全件停止。 |
| owner解除後の再起動 | tombstoneで旧proof/renewal/bearerを拒否。新しいrequestでも取消familyは復活しない。 |
| 解除保存失敗・crash・残留lock | 現在のadmissionを閉じ、次bootも閉じる。永続解除成功と表示しない。 |
| 破損／途中temp／key生成・DPAPI失敗 | 正本を黙って作り直さない。元データ保全、unknown表示、後続dispatchなし。 |
| 境界外path・親差替え・reparse | 拒否、追加権限なし。native本試験に置換しない。 |
| directory/git/workspace途中失敗 | 段階receiptを残し、再起動後も同requestの二重作成を拒否。fake side-effectのみ。 |
| 旧profile併存とexact権限 | 旧profile/期限/grant hash不変。folder許可からread/control/final本文は取得不可。 |

UI現物はdummy専用loopbackで、開始→本人確認→親/操作/期限→確認、取消、二重click、応答喪失の照合、再起動復元表示、単独/全解除、保存不確実表示を撮影する。実行時に操作数・画像数を記録し、今回の文書作成をUI確認済みとは数えない。

## 本番へ進む時の具体承認（今は求めない）

1. **検証済みコードの適用と一回のmanaged再起動。** 最終source/artifact hash、変更path、復旧artifact、対象D、現在のjob停止確認、解決済み非秘密の絶対dataDirを提示する。新flowは未登録/OFFで起動し、この操作だけで実資格やgrantを生成しない。既存profile/既存grantは変更しない。OS helperの過去の1回承認を再試験や配布へ流用しない。
2. **本人が選んだ一件の新ローカル連携を保護保存し利用開始。** 対応client/非秘密設定ID、許可する実親folder、list/directory/repo/workspace、承認期限、server/client-stateの絶対保存先、CurrentUserで内部資格を生成・保存すること、ローカル解除の効果を本人browserに一画面で示す。「この内容で始める」を本人が押した時だけ生成/保存/private handoff。人にキー3本を作らせない。この許可はexact Pi controlや本文公開を含めない。

実repo作成は上の作成scopeを本人が明示した場合だけ、その範囲・名前で実行する。導入確認のため勝手に実repoを作らない。既存profileの移行/消去、別アカウント/別端末への移行、ciphertext backupの復元、実clientへの設定変更、追加OS検証が必要なら対象と影響を限定した別操作として提示する。初期の最小導入には旧profile移行・削除は不要である。

## 承認後の通常確認手順（未実施）

初回保存後、秘密を表示しないstatusでfamily/client、親folder、scope、本人承認期限、内部資格のactive/expiredだけを確認する。鍵やproof、profile本文を取得しない。実repoは作らず許可対象列挙のみで確認する。

job停止を本人が確認したうえでmanaged通常restartを一回行い、同じfamily・期限・scopeが復元されること、期限切れ内部資格だけが更新されること、旧資格は利用できないこと、cookie復元がないことを確認する。companion再起動はclient-state保存の明示同意がある場合だけ確認し、期限やfamilyが増えないことを見る。

解除はConsole Settingsの同じ接続一覧で行う。確認前の「取消」は何もcommitせず、確認後の「連携を解除」はそのfamilyのruntimeを閉じtombstoneを保存する。応答喪失なら同request IDのresultを照合する。全解除はowner record更新前に全familyを永続失効する。再起動して復活しないことを確認する。repoや送信済み本文が残ることと資格解除を混同しない。

保存失敗や結果不明なら追加click/restart/自動retryで押し切らず、閉じたstatusと所有lock/receiptを照合する。復元を目的に旧backupを自動で戻さない。完全な古いbackup復元で取消が巻き戻り得る限界は残る。
