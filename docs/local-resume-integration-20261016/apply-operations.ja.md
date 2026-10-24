# 未実施の本番操作と適用対象

今の実装場所は C:\Users\leade\AppData\Local\Temp\pi-console-dpapi-integration-impl-20261015-c8d162a4\work。対象repoはD:\Develop\pi-consoleだけ。changes.jsonが既存9/追加14の23ファイルを列挙し、現在Dのbefore SHAと適用候補after SHAを示す。source-payloadは既定OFF。重要な既存未commit変更を取り込んだ同じ現行sourceを基に作成した。

## 反映する場合の最小操作（今回は実行しない）

1. source23件とbefore hashを再照合する。不一致なら上書きせず止める。差分対象の既存9ファイルと配布対象build artifactだけを、所有記録・hash付きでbackupする。profile・dataDir全体・.env・server-tokenをbackup目的で探索/コピーしない。旧profile/既存grantはそのまま保持する。
2. source-payloadを別のリリース作成領域でbuildし、変更assetとserver sourceのhashを固定する。この成果物を含めて本番適用を本人に提示する。今回の一画面bundleはdummy UI受入用であり、本番配布用distではない。commit/push/publishやnative provider更新を含めない。
3. 本番運用を始める場合は、別途示したactivation-preview.jsonのserver/index.ts候補（enabled:true/authorizedOS:true）まで含めた最終hashを提示する。これは未適用。Windows本人SIDの読取と、本人承認後のCurrentUser保護保存を許す候補であり、単なる配布承認へ混ぜない。旧profileの移行や全run/history/final公開を含めない。safe folder providerが既に利用可能か不明なら有効化しない。今回native binaryの試験・交換は行っていない。
4. 既存launcherが解決する非秘密の絶対dataDirと、server/client保存先を固定し、通常job停止を確認したうえで、本人承認された範囲のmanaged stop・source/build配置・startを一回行う。dataDirは再起動・更新で変えない。複数daemonを手動起動せず、PID所有確認は既存managerを用いる。稼働Dと現在Startupの関係は変更しない。
5. 対応stdio clientへUIの非秘密起動設定を一度登録する。Console本人browserで親folder・list/directory/repo/workspace・7日/31日/解除まで・表示された絶対保存先を確認し、本人が「この内容で始める」を押す。ここでだけ新方式の内部資格/新grantを生成・保護保存・private handoffする。既存manual profileは取り込まない。実repo作成は導入確認のために勝手に行わない。

この5段階は実運用へ進む場合の操作説明であり、現在の承認要求ではない。source適用/再起動、有効化/OS port利用、本人の具体scope承認を区別する。実資格・実grant・実client接続に今回のdummy承認を流用しない。

## 固定保存先と取消

serverは `<dataDir>/local-mcp-resume/state.dpapi`、companionは `<dataDir>/local-mcp-client-state/state.dpapi`。公開headerはschema/revision/owner binding、bodyはCurrentUser保護。server/clientでpurpose/entropyを分ける。初回の専用directoryは明示承認commitの時だけ作る。既存profile・grantの名前を置換しない。

暗号化前から所有transaction lockを作ってfsyncし、保存結果が不明ならlockを残して次bootも閉じる。解除はowner brokerの同じ一覧で個別または全件を行い、runtimeを閉じてからtombstoneをcommitする。settings-owner全解除はその前に新方式も解除する。設定上ownerがrevoked/不明ならbindingを拒否し、後日featureを戻しても古いfamilyを自動復元しない。送信済み本文・作成済みrepo/workspaceは消さない。

## 通常再起動と復旧

通常restartは同じowner/SID/installation/client/root identity/scope/承認期限と、有効なstoreだけを復元する。内部鍵が切れていれば承認期限内で更新する。browser cookieは復元しない。確認では許可対象列挙と非秘密statusを使い、履歴本文を取得しない。companion再起動は保護されたprivate proofで再接続する。更新応答喪失時は保存済みrequest IDで2分以内に照合し、自動で別requestを作らない。

code rollbackでは新経路を閉じ、backupした指定source/buildだけを戻す。storeの取消・epoch・receiptを以前のbackupへ戻すことを通常rollbackに含めない。破損/残留lock/owner変更/schema不一致は保全し、既存許可を自動再作成しない。明示した新規登録を復旧経路とする。古い有効store一式を戻すと解除が巻き戻り得る限界は維持する。

現在の運用上限はstate 1MiB、family16、owner request receipt256、管理操作receipt128/family、renewal digest32768/family。満杯時は閉じ、過去receiptを黙って消して二重作成を許さない。無期限の許可が無限容量を意味するとは扱わない。
