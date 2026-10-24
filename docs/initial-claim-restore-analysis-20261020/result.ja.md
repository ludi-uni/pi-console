# 通常復元の対象と発生契機 — 保存資料・コードのみの調査

今回の確認では申請/復元/更新/接続の実行も、保護stateの手動復号もしていない。以下は現在のsourceと保存済み非秘密資料から分かる範囲であり、現在の保護store内の全grant一覧を取得した報告ではない。

## 結論

主な具体的な対象候補は **fcf3c891-84b6-4b2a-a074-8dd4637aeaa5**。本人観測では画面expired、grant期限は2026-10-27 09:29:05 JST（2026-10-27T00:29:05Z）で未来だった。ここでexpiredは5分の短期資格切れを示し、7日grantそのものの失効ではない。保存状態がその後もapprovedで、本人/installation/親identity等が検証できるなら、通常復元の対象となる。

**grant期限切れやowner解除済みgrantを復活させる処理ではない。** 一方、正規の有効grantのもとでserver側の期限切れ短期資格を作り直し、同じ接続IDでruntimeへ再結合する処理ではある。新規申請の論理要件に旧grant更新はないが、現実装では新規申請を扱うサービス初期化と通常復元が結合している。

前報告の「新規申請時に更新」という表現は広すぎた。正確には **再起動後など、そのサービスinstanceで最初にget()された時だけ**。すでにloadedなら、新規requestのたびにrestoreを再実行するわけではない。

## 接続ごとの保存資料

grant familyのidはconnectionIdと同じで、別のgrantIdを発行するschemaではない。以下の4件が今回関係する公開履歴である。復元loopは特定ID/clientIdを選ばず、保護storeに保存された全familyを条件で判定するため、現在の完全な対象一覧をこの資料だけで断定はできない。

| 接続ID | 非秘密資料で確認できる事実 | 通常復元の扱い |
| --- | --- | --- |
| fcf3c891-84b6-4b2a-a074-8dd4637aeaa5 | 2026-10-20の新規申請。その後、本人がexpected親一致・画面expired・grant期限10/27 09:29:05 JSTを観測。4操作/7日は申請時の選択指示で、保護storeの実際の全scopeは今回独立取得していない | 現在もapprovedでgrant未失効なら対象候補。短期資格切れだけなら5分資格を更新し得る。後日の解除有無は未確認 |
| 6457004c-aeb4-4c0a-904c-27f2eb6c3bff | listのみで接続・許可metadata取得を実証。grant期限10/26 08:34:43.484 UTC。その後本人が解除を報告し、get/listが拒否された | 解除がprotected stateにrevokedとして記録済みならskip。公開試験は拒否までの実証であり、protected state内のrevoked値を直接読んだ証拠ではない |
| a885e50e-c4a4-4c12-880b-db920268a655 | 10/19 10:11:21.331 UTCが元の申請期限。公開作成記録はpending。次の申請時に利用拒否を確認し、ローカル記録を閉じた。ownerGrantRevoked=false | 未承認pendingだけならfamilyがなく、復元されない。承認済みになったという資料は見つからないが、最新の内部状態は断定しない |
| 86b3d68d-ff63-440c-8f41-d2dbb17fcf81 | 最初の5分申請。後のlist用申請直前には、承認済みserver/client stateがないことをmetadataで確認し、古いexpiredローカル記録を閉じた | 公開資料上、承認済みgrantなし。このpendingの復活経路はない |

根拠資料: docs/initial-claim-cause-review-20261020/summary.json、docs/local-list-read-20261019/result.ja.md、docs/local-revoke-read-20261019/public-result.json・result.ja.md、docs/create-trial-request-20261019/public-request.json、docs/create-trial-retry-20261020/result.ja.md、docs/local-list-request-20261019/result.ja.md、docs/local-resume-real-request-20261019/README.ja.md。

## state別の条件

- **approved + grant未失効**: 復元候補。短期bundleが未失効ならそのまま、切れていればepoch+1・5分以内かgrant期限の早い方まででread/control/final/handoff/renewalの5値を更新する。clientProof、親、操作、承認日時、7日/31日/期限なしの選択、grant期限、操作journalは維持する。更新された資格を自動的にclientへ配布したり、clientが接続済みになる処理ではない。
- **approved + grant期限到達**: 更新前にapproval_expiredで拒否しruntimeを閉じる。grant期限を延長しない。
- **revoked**: loop先頭でskip。schema上、bundle/clientProofはnull。解除済み資格を再生成しない。
- **未承認pending / review取消 / pending取消**: durable familyは本人approve時に初めて作られるので、未承認のものをrestoreが承認済みに変える処理はない。
- **cancel_local_connectionによるclient側切断**: ownerGrantRevoked=falseでclientの保存材料を忘れるだけ。owner grantの解除とは違う。server側grantがapprovedのままなら通常復元候補に残り得るが、忘れたclientへproofを再配布する処理はない。
- **本人/SID/installation不一致、壊れたstate、時計巻戻り**: 検証で停止。親identity差替え等もruntime復元を拒否する。ただし短期bundleの更新transactionは親の最終pin検証より先なので、その後に親検証が失敗しても更新の書込だけは既に起こり得る。

対象familyがなくても、既存stateのrevisionがある場合はclockFloor更新の保護state書込がある。したがって初回service読込を「完全な読み取りのみ」と扱えない。

根拠: server/local-mcp-composition.mjs:17,24,29–41（family条件/approve/restore）、server/local-mcp-identity.mjs:17（bundle）、server/local-mcp-state.mjs:9–15（approved/revokedとschema）、server/folder-mcp.ts:189（親pin/復元）。既存dummy回帰に通常再起動、短期失効、grant期限、revoke、identity/親変更の証拠があるが、今回は再実行していない。

## 何の操作で発生するか

1. process起動時のcreateLocalMcpInstallationはgetを保持するだけ。**再起動そのものや管理identity/status確認だけではrestoreしない**。owner-loginのauth/claim・auth/statusもresumeサービスをgetしない。
2. 再起動後、未loadedのserviceへ初めて到達したときにget→createLocalMcpComposition→await restoreとなる。正規のlocal-owner/resume/request、claim、resume、renew、rpc、cancel-requestのいずれでも起動し得る。本人側のview/review/approve/cancel/result/revokeも、boundary/本人認証を通れば同様。
3. 本人UIの「ローカル連携を始める」「接続一覧を再取得」はPOST resume/viewなので、最終承認ボタン前でも初回読込を起こせる。本人アカウント解除bridgeのrevokeOwnerもgetしてからall revokeする。
4. getが一度成功するとserviceをcacheするので、毎requestでrestoreは走らない。restore自体はclientのproof照合より前にサービス初期化として実行される。

根拠: server/index.ts:55–56,75,136、server/local-mcp-installation.mjs:11–24、server/local-mcp-http.mjs:14–16、server/local-owner-bootstrap.ts:67,101,111,144、web/LocalResumeMcp.tsx:47,53,56。

## 新しい申請に必要か

新しいpendingは新しいrequestId/connectionIdで作る独立の申請であり、旧fcfのgrantや資格を更新する論理上の必要はない。しかし **現行コードと承認済み最小修正候補のどちらも、再起動後の新規requestを処理する前に全保存familyのrestoreをawaitする**。新しいclientIdにするだけでは避けられない。

旧grantを更新せず新規申請だけを扱う別経路は、この承認済み候補にはない。新しいstore、旧grantの勝手な解除、復元方針変更などは実行していない。既存の有効grantの通常復元を許可するか、新規申請を保留するかの判断は親へ返す。本人への質問は親に集約し、追加送信しない。

また、新しい候補を適用して再起動しても、元の初回enrollmentを復活するわけではない。clientはbroker generationを照合し、候補のserver claimは元の初回期限を確認する。復元runtimeのpendingUntil=0では初回claimを拒否する。保存済みの正規継続proofを持つclientによる通常再接続と、初回申請の復活は別である。
