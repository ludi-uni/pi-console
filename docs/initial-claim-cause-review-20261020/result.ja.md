# 初回受取り期限の照合と最小修正案（未実装）

追加された本人画面の情報: 接続 **fcf3c891-84b6-4b2a-a074-8dd4637aeaa5** はexpired、親は予定どおり、許可期限は **2026/10/27 09:29:05 JST**。

今回も既存実行記録と既存sourceの読み取りだけ。拒否再試行、MCP/HTTP照会、秘密/認証情報読取、再申請、期限/権限変更、実作成、source修正、build/test/配布/再起動はすべてゼロ。

## 分かったこと

**画面のexpiredは7日grantの期限切れではなく、短期接続資格側の失効と絞れる。** FolderMcp.viewは、connectedのgrantが有効でもconnectionUntilが切れるとstateをexpiredと表示する。親と未来のgrant期限が表示されることは、この分岐と一致する。取消の場合のrevoked表示とは区別される。

現在の初回ハンドオフが「承認済みgrantは有効でも、最初の短期資格が切れると継続用proofを受け取れず、通常renewへ進めない」構造であることをsourceから確認した。この構造が今回の失敗を説明する有力な経路になった。ただし以下の時刻起算に注意が必要。

## 時刻を正確に照合する

**7日を引いた09:29:05は、実装上はreview生成時刻であり、最終承認ボタンを押した時刻ではない。**

local-mcp-composition.mjsのreviewがapprovedAt=now()を取得し、その時刻+7日をexpiresAtとする。approveは後からそのreviewを承認し、FolderMcp.approveが短期資格期限をその承認処理時刻+5分で設定する。変数名approvedAtは実際の承認時刻を意味していない。

| 時刻/期間 | 既存証拠・sourceから分かる内容 |
| --- | --- |
| 新規申請 | 2026/10/20 09:26:54頃JST |
| 申請待ちの期限 | 同日10:26:54 JST。失敗時点では未到来 |
| review生成 | 許可期限から7日を引くと同日09:29:05頃JST（画面は秒精度） |
| reviewの最大有効期限 | およそ09:34:05 JST。承認ボタンはこの範囲内で押す必要がある |
| 最初の短期資格期限 | **実際の承認処理時刻+5分**。レビュー時刻だけからは概ね09:34:05〜09:39:05 JSTの範囲となる |
| 実行記録の範囲 | 09:34:31.994開始〜09:34:33.694終了。その間にget_local_connectionを1回だけ実行 |

最初の確認はreview生成の約5分27〜29秒後だった。review直後の最初の約27秒以内に承認していたなら、実呼出時には短期資格が切れていた計算になる。承認をもっと後で押していたなら、実呼出時にはまだ有効だった可能性がある。

したがって、**09:34:05に必ず期限切れした、と確定してはいけない**。今回の最終承認時刻/connectionExpiresAtの実値は未保存であり、画面のexpired観測が後刻なら、それだけでは失敗時点の期限を確定しない。保存binding/状態エラー等を完全に除外したわけでもない。

元のRPC errorはラッパーがapp_server_rpc_rejectedへ畳み込み、数値codeを保存していない。この不足も残る。Consoleのcatchはsource上-32602/local_resume_or_scope_unavailableだが、今回の実値と置き換えてはいけない。実行環境の自動承認拒否ではなくapp-server RPCエラーまでが実測済み。

## 失敗するsource経路

1. 本人のapproveで、7日grantと最初の5分資格・継続用proof/renewalがserver側に保存される。
2. clientに承認済み保存状態がまだなければ、get_local_connectionはenrollmentを復旧し、初回claimを呼ぶ。
3. FolderMcp.claimがlive(c)を呼び、**初回ハンドオフにも5分access期限**を要求する。
4. ここで失敗すると、clientは継続用proof/renewalを保護保存できない。
5. 自動resume/renewはその保存済み継続用proof/renewalを前提にするため、最初の受取りを逃したclientには利用できない。

本人browserの10分cookieはprivate client claim/resumeの認証には使わない。owner-loginだけを繰り返しても、この構造が解消する根拠はない。申請待ち60分、review最大5分、短期access5分、grant7日の別々の期限を混同しない。

## 最小修正案

**5分資格や7日grantを延長せず、初回の「継続用proofの受取り」と「短期accessの利用可能性」を分ける。** 新規scopeやgrantを作る修正にはしない。

主対象はserver/folder-mcp.tsのcontinuation初回claimと、package/local-resume-session.mjsの初回受取り完了処理。既存local-mcp-compositionのfamily/owner検証と、既存resume/renew・原子的epoch更新を利用する。公開MCP引数や保護state schemaを増やす必要は基本的にない。

### Server側

- continuationの初回claimでは、正しいconnection/proof、current runtime/generation、元のenrollmentの固定期限内、admission/epoch、本人承認済みかつ未取消・未失効のgrant、同じparent/operations、owner/SID bindingを検証する。
- 条件を満たす場合、短期accessが切れたことだけを理由に**継続用proofのprivate handoff**を妨げない。
- 期限切れのaccess tokenでlist/create/RPCを通す変更はしない。未承認、revoked、grant失効、元のenrollment期限切れやbinding不一致は引き続き拒否する。
- generic/legacy FolderMcpの非continuation契約は変えない。初回受取りを、別のrequestIdでの新grantや7日延長に置き換えない。

### Client側

- private handoffをCurrentUser保護stateへ保存した後、直ちに既存のreconnect/resumeを通し、短期資格が切れていれば既存renewで**新しい5分資格**を得る。
- 有効な短期資格を得てから公開結果のconnected=trueを返す。期限切れtokenを操作に使用しない。
- 既存のpendingRenewal・receiptによる応答喪失/再起動復旧を使う。初回claim自体の再送で新しい資格を何度も発行する方式や、無条件のliveチェック削除にはしない。

これにより、承認済みでまだ受取可能期間内の本人clientは通常更新へ入れる。一方、元のenrollmentの固定60分期限やgrant/取消の境界を超えて接続を復活させない。短期資格の寿命は5分のまま、7日grantの親/操作/期限も変更しない。

### 必要なfocused dummy受入（まだ実行していない）

- 初回受取り前に5分を越える→有効grant/元enrollment期限内なら通常更新後に接続可能。期限切れaccess token自体のRPCは拒否。
- 5分未満/正確な境界、enrollment60分の境界、grant失効、取消、wrong proof/client/owner/SID/generation、親差し替えはfail closed。
- 応答喪失や二重get、state保存/更新途中の失敗、client再起動で、新grant・重複更新・暗黙再申請にならない。
- 親・4操作・7日の値が変わらず、本人cookie10分/review最大5分/legacy既定5分を維持。
- 今回の試験ラッパーは非秘密の数値error codeと許可済みの固定reasonだけを保存するようにし、raw error本文・秘密を保存しない。これは診断補助であり、認可緩和ではない。

UIでgrantが未来でも短期access切れだけで一律expiredと表示する問題は別途ラベル改善の対象にできるが、上記の機能修正へ大きなUI改修を抱き合わせない。

## 適用と本人操作

今回は提案だけで未実装。現行serverはwatchなしなので、後日のsource適用だけで稼働中動作は変わらず、本番反映には別途承認された再起動が必要になる。再起動はbroker generationも変えるため、**この案だけで今のfcf接続を再起動越しにそのまま救済できるとは約束しない**。generation跨ぎの初回bootstrapを緩めることは最小修正に含めない。

追加の画面情報は受領済みなので、今は本人に再ログイン・再申請・承認押し直し・期限/権限変更をお願いしない。既存grantは変更せず、3操作も未実行のまま。修正案の検証/適用や今の接続の扱いは、後続で明示された範囲に従う。

参照source: server/local-mcp-composition.mjsのreview/claim/renew、server/folder-mcp.tsのapprove/claim/live/view、package/local-resume-session.mjsのget、package/local-mcp-client-state.mjsのaccept/reconnect/renew。保存済み実行証拠はdocs/create-trial-execution-20261020/codex-read.json。秘密stateや認証情報は読んでいない。
