# connected 表示・本人承認の自動処理と専用companion

対象 **304215fd-0ff6-416f-831c-cd03bd3a35b4**。この報告は source と、親が目視確認したユーザー提供画像の情報、専用holderの非秘密receipt/statusに基づく。こちらでは画像pixelsや資格値・保護storeの内容を読んでいない。

## 結論

**この製品の画面上の connected は、本人承認によってserver側の接続が承認済み・受入可能になった時点でも表示される。** companionによる資格受取、復元、一覧取得、4操作の実行成功を示す受領記録ではない。

本人承認の完了報告と画像の connected は、**server側で初回資格の発行・保護保存とgrant有効化が進んだ設計と整合する**。一方、この専用companionはclaim / resume / renew / RPCを送っていない。holderのpending表示は08:47:50の受理結果のキャッシュなので矛盾しない。

## sourceで確認した自動処理

| 段階 | 処理 | 根拠 |
| --- | --- | --- |
| 本人の最終ボタン | owner approveをPOSTし、返された非秘密current viewを画面に表示 | `web/LocalResumeMcp.tsx:50` |
| server承認 | read/control/finalとhandoffの4資格を発行し、親・操作・grant期限・短期期限を設定。`c.state='connected'` | `server/folder-mcp.ts:149` / `:151` |
| 初回永続化 | renewalとclient継続proofを追加発行し、bundle・grant・epoch1・approved状態を正規保護storeへcommit | `server/local-mcp-composition.mjs:25`〜`:28` |
| 受入開始 | 初回commitと本人/期限再検証の後でadmissionをopenにする | `server/folder-mcp.ts:152`〜`:157` |
| UI行 | server viewのstateとparent、grantのexpiresAtをそのまま表示 | `web/LocalResumeMcp.tsx:57` |
| clientへの受渡し | claim → client state.accept → companion.reconnectは、別の get 呼出しで行う | `package/local-resume-session.mjs:31`〜`:35` |

つまり本人承認はserver側で **6つの用途分離された資格材料（役割3・handoff・renewal・client継続proof）**を初回発行し、保護保存する設計。今回資格値を読み出して確認したわけではないが、正常なconnected応答が返る前にこの初回commitが必要になる。失敗時は正常なconnectedとして返す経路ではない。

これらの内部資格名から、run/history/final本文共有やPi制御の権限を追加したとは解釈しない。folder scope と既存 exact read/control/final は別契約のまま。

## 表示の限界

- owner承認時にserverのlogical connectionはconnectedになり、clientからのclaimを待たずに表示できる。外部clientの接続検知・資格受領ackではない。
- server viewは短期資格期限も見てexpiredを返すことがある。7日grant期限とは別。
- UIの1秒timerはclockを更新するだけで、viewの自動fetchはしていない（`web/LocalResumeMcp.tsx:42`）。行のconnectedは最後に受信したviewを保持し、現在の短期資格の有効性まで保証しない。
- connectedの行にはoperationsを表示していない。4操作の実grantを画像から推定できない。
- 初期化時の tools/list 7件は承認前にも返る固定カタログ。許可親一覧のRPC成功や作成操作成功の証拠ではない。

## 画像情報として受領したもの

| 項目 | 証拠 |
| --- | --- |
| 接続数 | 1件 |
| 名称 / ID | MCP stdio companion / 304215fd-0ff6-416f-831c-cd03bd3a35b4 |
| 表示状態 | connected |
| 親 | c:\users\leade\appdata\local\temp\pi-console-local-mcp-trial-20261019 |
| 許可期限 | 2026/10/27 17:55:02。追加delegationで **JST** と明示確認 |
| UTC換算 | **2026-10-27T08:55:02Z、秒精度**。millisecondsは画像から不明 |
| 操作4件の一覧 | **画像にない。実grantのoperations配列は未確認** |
| claim / 一覧 / mkdir / git init / workspace成功 | 画像では確認できない |

画像の親は申請した親とWindows上のcase違いだけで一致。reviewが7日で作成されたという仕様に合う表示だが、reviewの正確な作成時刻・最終クリック時刻・短期資格期限をこの画像だけから確定しない。

## 専用companionの既存状態

holder PID **43852** / companion PID **38140**、tool session **97968**。今回もstatusでcompanionClosed=falseを確認した。statusはserverの再照会をしない。

- 受理時のcached snapshotは08:47:50.951 UTCのpending / grantActive=false。承認後のserver状態の否定には使わない。
- 非秘密receiptのprivate requestは1件、管理identity GETは27件で変化なし。guardの許可外通信/書込は0。
- controllerはstatus / closeだけを受け付け、claim / resume / renew / rpcはguardで禁止。browserのapproveからこのprocessへ自動通知・資格受渡しをする経路やpollingはない。
- この専用companionによる承認済み資格の受取・client資格storeへの保存・更新・復元・許可親一覧・作成は未実行。他の独立したclientの実行有無までは今回の証拠から断定しない。
- 申請準備で生成・取得・保持した初回request/claim proof、local enrollmentの保護保存は既に実行済みであり、「clientの資格は何も保存していない」と一括表現しない。承認後の役割資格のhandoff保存とは区別する。

## 過去の「未実行」の限定・訂正

08:47〜08:51の申請準備証拠にある「役割資格発行0 / grant有効化0」は **その時点のagent操作**の説明。その後の本人承認を含むシステム全体について使う表現としては不正確になる。

以後は次のように区別する:

1. **本人承認でserver側の初回資格発行・保護保存・grant有効化が行われる設計で、画面証拠と整合する。**
2. **agentの専用companionによるclaim / 承認済み資格の受取・保存 / restore / renew / 一覧・作成は未実行。**
3. 画像だけで、4操作の実grantや、その実行成功、MCP一覧成功を追加認定しない。

以前の封印済み証拠を事後改変せず、この報告を時点・主体を明確にする追補として残す。

## 追加許可と残っている実行条件

09:04 UTCのユーザー許可により、このIDだけの必要な資格受取・保護保存・復元・短期更新と一覧1回は許可済み。**同じ許可を再度求める必要はない。** ただし「scopeと期限の一致を資格操作前に確認できない場合は停止」が条件で、実operations配列の確認が残る。

本人画面の親・JST期限は一致。**actual operationsが list/directory/repo/workspace の4件と確認できるまで、claim前で保留する。** 欠けているのは許可ではなくメタデータ。

`owner-metadata-read.js` に、既存の認証済み本人ブラウザから正規viewを1回読むだけの手順を用意した。**agentは実行していない。** 固定の同PC owner origin以外では止まり、同origin fetchでcookieを通常利用するがcookie値を読まない。target1件の非秘密parent/operations/期限と一致判定だけを出力する。APIが拒否したら新loginや資格発行を自動で行わない。cookie/profile抽出やHTTP本人境界の迂回はしない。

scope確認後の次段階では既存の承認範囲を使う。holderのguardを勝手に緩めず、元requestIdと元の初回期限・broker世代で正規の再照合を行う。新規申請・grant延長・他接続復元・作成を追加しない。**初回期限は09:47:49.759 UTC（18:47:49.759 JST）**。

## 今回の実施

sourceと非秘密receiptの読取、cached status1回、報告と読取手順の保存だけ。資格値・DPAPI blob・生保護recordは読んでいない。claim / 資格保存 / 更新 / 復元 / RPC / 実利用接続 / 再起動 / 新login / 新申請 / grant変更 / source・dist適用は0。追加テスト・画像取得・UI操作は0。pi-warden、OS専用試験、他アプリ、ACL・アカウント・ネットワーク設定に触れていない。
