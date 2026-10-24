# 個人ローカル用途の最小仕様

本人4ec6aa48-dd83-4072-b3ac-d08b7f3bb954の承認を採用。外部正本/60秒online lease/起動時ネットを必須から外す。基本はCurrentUser DPAPIによる端末保存、ローカル失効、通常再起動の自動復元。今回の実装は隔離fixture専用で、実資格や実OS providerを使わない。

## 利用の流れ
1. 初回は既存の本人browserで親folder・操作・承認期限を明示する。用途別credentialとprivate companion proofは内部で用意し、人にランダムキー3本を作らせない。
2. 承認、stable owner/device/client/root/scope binding、用途別credential、epoch/replay情報、解除tombstone、管理操作receiptを一つの保護対象へ原子的に保存する。秘密をURL/argv/log/公開MCP応答へ出さない。
3. 通常再起動はclosedから復号・owner/binding・承認期限・親identity・保存整合性を検証し、成功時だけ復元する。内部credential期限だけが切れていれば、同じ承認の範囲で内部rotationしてからopenする。外部service/ネットは要求しない。
4. 既存owner revoke入口を一つの永続解除処理へ接続する。先に対象runtimeを同期で閉じ、key/proofを使えなくし、tombstoneを保存する。作成済repo/workspaceや送信済本文の削除とは別。

**本人が承認した期限は、内部credentialの寿命やbrowser cookieの寿命と別。** 7日/31日/本人明示の無期限を維持し、更新・再起動で延長短縮しない。内部credentialは最大5分、response照合は2分という既存契約を保つが、5分ごとの本人再承認を要求しない。browserの管理者cookieは保存・復元せず、管理UIの本人確認は既存規則を保つ。

親folder承認はConsoleの作成・登録管理だけで、任意PiコマンドのOS sandboxや全run/history/final本文の公開許可ではない。read/control/finalの内部用途分離を保ち、本文のexact grantとは別に扱う。

## 起動・更新・失敗
保存済みCurrentUser bindingが一致しない、復号/parse/schemaが失敗する、承認が期限切れ、親identity/client bindingが変わった、不完全なprepared状態、時計逆行は閉じる。破損を観測した既存instanceも停止する。ファイル欠落からgrantを勝手に再作成しない。

既存admission修復を維持する。更新開始時closed、stage/保存/検証のawait中は旧新keyとも拒否。最後のguard後に同じserial契約でkey/epochを切替えてopen。復元もrolesをclosedで挿入し、最後の検証までclaim/tools/callを拒否する。

保存前失敗では準備途中の権限を復元しない。保存後の応答喪失では保護された同じ承認・bundle・epochへ照合し、再起動後にそれを検証して復元できる。解除の保存失敗は永続解除完了と表示しない。閉じた管理経路で同requestIdを照合/再送する。書込めなかった解除を、後のbootへ永続保証したとは言わない。

private client proofはfamilyへ結び付ける。trustedな新boot世代は保存されたproofで検証する設計で、clientInfoや自己申告の世代を認証にしない。fixtureでは公開proof/boot IDで模擬し、実OS principal・実client/private handoffの検証は未実施。対応clientの通常再接続は目標だが、全MCP clientの無操作再接続を約束しない。

## 管理操作の再送
権限だけ復元して操作receiptを捨てると、同じ作成要求を再実行しかねない。そのため作成前intentを保存し、directory/git/workspace/完了の各receiptを保存・復元する。結果不明/partial/completeのrequestIdは再実行せずget_operationで照合する。今回のactionはmemory providerのcounterだけで、実git/repo/workspace作成は0。

## 受け入れる残リスク
認可storeを含む古い正常backupを丸ごと戻すと、解除・epoch・receiptが巻戻り得る。negative controlで解除前grantが復活することを再現した。これを防ぐ独立正本は基本仕様に含めない。同じWindows本人権限の悪意あるprocess、trusted installed code/Pi/SDK/extensions、OS/admin侵害からの隔離も保証しない。DPAPIは保存保護の前提で、万能sandboxではない。

単一のmanaged Console instanceで通常stop/crash後に起動する前提。writer fencing/CASは保持するが、複数の同時daemonへ瞬時失効を配る仕組みではない。電源断耐久・native reparse/handle契約は今回のfake/Temp受入から一般化しない。
