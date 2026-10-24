# DPAPI保存を本番へ配線する最小適用計画（未適用）

今回の作業は読み取りと文書作成のみ。実資格の生成・保存・移行、既存grantの変更、本番source/dist適用、restart、listener・ネット設定変更は行わない。外部正本、online lease、TPMを追加しない。

## 到達するUXと範囲

対応stdio clientへ非秘密の起動設定を一度登録し、「ローカル連携を始める」→既存browserで本人確認→親folder・操作・承認期限を選択→確認、で内部資格を生成・保護保存する。人にランダムキー3本を作らせない。本人の承認期限7日/31日/明示した無期限と、内部鍵5分・応答照合2分・browser cookie10分を分ける。通常再起動・内部更新は本人の承認期限を縮めず、新しい許可も作らない。

親folderはConsole管理APIの作成・登録境界。list/directory/repo/workspaceだけで、既存上書き・削除、clone URL、push/公開、任意初期化コマンド、Pi全体のOS隔離は含めない。read/control/finalの内部鍵は分離しても、run/history/final本文の許可を自動付与しない。既存exact契約は別のままにする。

初期の対応経路はこの製品が管理するstdio companion。MCP clientInfoは表示用で、認証には使わない。companionが持つ非公開proofでserverのfamilyへ結び付ける。client本体に鍵3本を配らず、URL/argv/logへ秘密を出さない。stdio未対応clientやprivate継続経路未対応clientは、自動連携を約束せず、対応companion経由へ案内する。client-stateを保存しない選択ではcompanion停止後の再承認が必要だと表示する。汎用HTTP OAuth対応を今回追加済みとは扱わない。

## 新しく配線するもの

| 変更対象（候補名） | 最小の責務 |
| --- | --- |
| 新server/local-mcp-persistence.ts | production schemaとCurrentUser DPAPI I/O。一つのdocumentに承認、stable binding、用途別bundle、epoch/replay、取消tombstone、操作journalを格納。fixture vector生成を参照しない。 |
| 新server/local-mcp-continuation.ts | randomBytesによる用途別issuer、同一用途内/用途間/既知legacyとの重複拒否、閉じた状態での更新、永続commit後のactivate、再起動復元、owner revokeの一元化。 |
| DPAPI port | 受入済みの固定helper本文を再利用し、private stdin/stdout、固定system PS、timeout/出力上限/固定errorを持つ。source-only sync adapterと受入用async harnessは同一production APIではないため、最終配線そのものの隔離dummy検証が別途必要。 |
| server/folder-mcp.ts | 隔離実装で確認済みのclosed admission、trusted restore、操作前intent/各段階receiptを移植。既存D実装のMapだけでは再開しない。 |
| server/index.ts / local-folder-composition.ts | launcher由来dataDir・本人認証・safe providerを明示注入。新storeが存在し、本人有効・復号/検証成功のfamilyだけを復元。作成時はOFF、HTTPから保存先/loaderを選ばせない。 |
| local-owner-bootstrap.ts / settings-mcp.ts | 既存session認証のまま、本人確認済みreview/save/result/revokeをcontinuationへ接続。キー入力欄の追加で済ませず、server側生成に置換する新flowを用意。旧profile APIは互換経路として独立保持。 |
| 新package/local-mcp-client-state.mjs / local-folder-mcp.mjs | companion専用のCurrentUser保護proof保存と再接続。非秘密のclient設定IDで複数clientを分離。別clientのproofを使ったfamily切替・上書きを拒否する。 |
| web/local-owner-main.tsx / 必要な既存Settings UI | 生成対象、保存先、親folder/操作/期限、既存profileとの併存を確認画面で示す。取消・応答喪失照合・一か所の解除を接続する。新Web機能採用時はAGENTS.mdのMDN Baseline確認とブラウザー検証を行う。 |

通常startup entry自体は変更しない。server-managerの管理tokenも今回移行しない。production folder providerが安全に利用できるかは独立の前提であり、DPAPI配線を理由にnative binaryを実行・交換しない。provider不明/不一致時はfolder機能を閉じる。

## 保存契約

候補は既存dataDir直下の固定専用directory `local-mcp-resume`。serverの正本は `state.dpapi`、同directory内に所有記録付きtransaction tempと `.lock`。companion用は同じstable dataDir内の別固定directory `local-mcp-client-state` に `clients.dpapi`（複数client recordを一つのdocumentへ）。実際の絶対保存先と既存ファイルの有無は将来の本人確認で固定する。今回は作らない。

既存trusted-local-credentials.jsonを新store名へrenameせず、読み替え・自動移行・平文の新規backupもしない。既存profileに新キーをwrite-backしない。新flowは新しいfamilyを本人が承認する。旧profileに既存利用がある場合は独立保持し、同じ許可を自動で合算しない。全面移行/旧profile削除は、必要になった場合だけ別の具体的操作として扱う。

CurrentUser、purpose/schema、OSから取得するSID、Consoleのstable installation ID、本人record IDをbindingに用いる。SIDは環境変数の表示名やclient入力で代用しない。installation IDは初回本人確認時に作り、更新・通常再起動で変えず、絶対に秘密とは扱わない。本人recordは既存Access ownerまたは新local enrollmentの認証済み結果から作り、clientのowner自己申告を採用しない。アカウント/端末/本人が一致しなければ閉じる。bindingのserializationとschemaを固定し、復号成功だけで許可しない。

read/control/final/handoff/renewal/client proofは独立の暗号乱数。復号後もサイズ、schema、owner、revision、family/epoch、親identity、scope、期限、receiptの整合性を全件検証する。秘密をerror/path/JSON-RPC idへ混入させない。JSON stringなどJS内のコピーを完全消去できると約束しない。

transactionは排他lock→現在revision確認→閉鎖/intent→全document保護→同directoryの新規tempへwrite/fsync→atomic replace→再検証→activate。保存のawait中は旧鍵・新鍵ともadmissionを閉じる。多重writerは拒否し、競合を自動takeoverしない。crashや保存不確実時のlockは自動削除せず、起動もfail closed。電源断耐久・Windows置換/親差替えの最終production I/Oは今回のhelper単体受入では未検証である。

familyごとの承認期限・親identity・scope・操作journalはcredential rotationで変更しない。既存管理APIのworkspace登録と別ファイル間の原子的commitは仮定しない。操作前intentと段階receiptで部分成功を表し、不明/partial/completeの同じrequest IDを再実行せず照合する。未知のclient・parent差替え・期限切れ・時計巻戻し・未commit更新は復元しない。

owner全解除はruntime admissionを閉じ、全family tombstoneをこの正本へcommitしてからsettings-ownerの非秘密recordを更新する。二つのファイルが同時commitできるとは扱わない。途中停止しても正本のtombstoneまたは残留lockで復元を阻止する。永続commit不確実なら「現在は停止、再開阻止を要確認」と表示し、成功と表示しない。サーバー停止と許可解除を区別し、通常shutdownは承認を取り消さない。

## 復旧と受け入れる限界

source/dist適用前のbackupは、差分で指定したコード/artifactとhashだけ。データdirectory全体を無差別コピーしない。旧profile/既存grantは元のまま保持する。新storeを更新する場合だけ、同じCurrentUserの固定backup先にciphertextと非秘密manifestを保存する（将来の具体承認対象）。復号平文をbackupへ出さない。

code rollbackはlistener/新flowを閉じてから対応artifactだけ戻す。新storeを削除・旧時点へ戻して「解除を巻き戻す」操作は通常rollbackに含めない。schema downgradeや読取失敗時は新storeを保全し閉じる。新方式を無効にしても、旧profileを自動有効化しない。

破損・残留lock・失われたproofでは無条件にbackupから復元しない。本人が状況を確認し、新しいfamilyを承認する再登録が簡素で確実な復旧経路。過去の有効なstore一式を戻すと取消/epoch/receiptも戻り得る。このroll-back耐性は追加しない受容済みの限界である。送信済み本文や作成済みrepo/workspaceは解除でも消えない。

DPAPIは通常同じWindows本人・端末で復号するが、roaming profile等の例外があるためアプリbindingも検証する。同一ユーザーの悪意あるprocessや管理者を隔離する仕組みとは扱わない。[Microsoft CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)

改変時の特定error codeだけに依存せず、復号結果の全schema/整合検証を行う。[Microsoft CryptUnprotectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptunprotectdata)
