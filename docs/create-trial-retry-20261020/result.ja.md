# 3操作試験の新規申請・2026-10-20

ユーザーの「もう一度ログインしたから申請してくれる？」という明示依頼に従い、実際のインストール済みCodex MCP clientから新しい申請だけを作成した。本人の最終承認・権限付与・実作成は行っていない。

- **本人画面で選ぶ新接続ID**: `fcf3c891-84b6-4b2a-a074-8dd4637aeaa5`
- **requestId**: `codex-create-retry-194caadc-6795-4c4f-9c5c-049742e0a648`
- **期限JST**: **2026年10月20日 10:26:54**
- 期限UTC: `2026-10-20T01:26:54.443Z`
- 作成応答時: pending / connected=false、残り3599秒。非秘密のrequestExpiresAtと呼出前後時刻から3,599,366–3,601,268msの幅で約60分を確認。再表示で延長しない。

## 本人の最小手順

本人確認済みのConsole PC画面で「ローカル連携を始める」（開いていれば「接続一覧を再取得」）を押し、上の新IDを選ぶ。

親は以下の既存試験親だけ:

```text
C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019
```

操作を **list・directory・repo・workspaceの4つだけ**、期間を **7日**にする。UIの「許可対象一覧」「新しいディレクトリ」「空local repo」「workspace作成・登録」に相当する。「許可内容を確認」で親・4操作・7日・接続IDを照合し、本人が確認チェックと「この内容で始める」で最終承認できる。

本人確認の残り時間はcookieを取得せず確認できない。期限切れと表示された場合は本人がowner-loginで再確認する。こちらでは再認証・コード発行を代行していない。申請待ち60分と本人確認10分は別。

申請APIはclientからscopeを固定して付与する方式ではない。**この4操作・7日は本人reviewで確定する指定内容で、作成応答時にはまだ権限がない。**

## 前回申請の確認と分離

前回a885e50e-c4a4-4c12-880b-db920268a655は、作成時の公開記録がpending、期限が2026-10-19T10:11:21.331Zだった。現在はその期限を過ぎていることを確認し、実Codexのget_local_connectionでもscope unavailableで利用できなかった。もしconnectedや別のpending等が返れば新規化せず停止するguardを置いた。

公開記録と正規client応答による確認であり、秘密を含む暗号化grant記録を直接復号して内部stateを調べたものではない。

正規cancel_local_connectionで期限切れのclient保存状態を閉じた（disconnected=true、ownerGrantRevoked=false）。owner側grantの取消を繰り返したり、以前の権限を復活・拡張したりせず、新しいrequestIdでbegin_local_connectionを1回実行した。新しい接続IDは前回と異なる。

## 境界と証拠

既存pi_console_local設定は所有hashと実Codex CLIのselected設定が一致し、変更ゼロ。試験親の所有file identityが一致し、予定子mcp-create-check-20261019は未存在。内容列挙はしていない。現行brokerは既存管理helper内部の署名照合でPID26656/startedAt=2026-10-19T06:21:30.396Zと確認した。

MCP toolはget_local_connection、期限切れclient保存状態の正規ローカル切断、begin_local_connectionだけ。create_managed_workspace/list_allowed_parents/get_operation/owner approveは呼んでいない。MCP用途別操作資格・grantの作成/受取、ディレクトリ作成・repo初期化・workspace登録はゼロ。申請に必要なprivate proofの生成・保護・送信は通常companion内部だけで、生値を取り出していない。コード/token/cookie/秘密をチャット・URL・argv・logへ出していない。Pi/外部repo/clone/push/package導入/設定変更/pi-warden作業もゼロ。

モデルturn・永続threadはゼロ。申請用app-server PID18212はexit0で終了し、本人processと直接の子が残っていないことをPID metadataだけで確認した。引数/環境は取得していない。

証拠: preflight.json、request-intent.json、public-request.json、codex-real-request.json、owned-processes-ended.json。新ID・期限JST・承認内容は作成後すぐ報告した。その後の本人の最終承認状態は監視していない。
