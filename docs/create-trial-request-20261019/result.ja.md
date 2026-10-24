# 3操作試験用・新しいCodex MCP申請

実際のインストール済みCodex CLI app-serverのMCP clientから、既存pi_console_localの同じcommand/args/cwdを使って、新しい未承認申請を作成した。作成応答はpending / connected=false。最終承認・権限付与・作成は行っていない。

- **本人画面で選ぶ新接続ID**: `a885e50e-c4a4-4c12-880b-db920268a655`
- **新requestId**: `codex-create-trial-6939eff4-3f94-4de2-a314-9f8d0d751129`
- **申請待ち期限**: `2026-10-19T10:11:21.331Z`（日本時間19:11:21）
- 応答時の残り3599秒、非秘密のrequestExpiresAtと呼出前後時刻から3,599,426–3,601,139msの幅となり、固定約60分を確認した。再表示で延長する期限ではない。

## 本人の最小手順

本人確認済みのConsole PC画面で「ローカル連携を始める」（開いていれば「接続一覧を再取得」）を押し、上の新IDを選ぶ。

親はこの**既存試験親だけ**:

```text
C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019
```

期間を**7日**、操作を**list・directory・repo・workspaceの4つだけ**にする。UIでは「許可対象一覧」「新しいディレクトリ」「空local repo」「workspace作成・登録」の項目に相当する。「許可内容を確認」で親・操作・期間・新接続IDを確認し、本人が確認チェックと「この内容で始める」で最終承認できる。

本人確認の残り時間はcookieを取らずに確認できない。本人画面が期限切れ表示なら、先に本人が通常のowner-loginを実行する。こちらではコード発行や再認証を代行していない。本人確認10分と申請待ち60分は別である。

この申請APIはclientがscopeを固定して送りつける方式ではない。**現在はまだscope未付与であり、試験親・4操作・7日は本人のreviewで確定する指定内容**である。他の権限をこちらで追加していない。

## 作成予定（まだ作らない）

承認後の別段階で予定している子は以下の1個。同じ場所にdirectory→固定空.git→Console workspace登録の3段階を行う計画である。

```text
C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019\mcp-create-check-20261019
```

事前確認で親の所有file identityは一致、子は未存在。内容列挙はしていない。create_managed_workspace/get_operation/list_allowed_parentsは今回呼んでいない。外部repo・clone・push・package導入・Pi実行もしていない。

## 取消済み接続との分離

旧ID6457004c-aeb4-4c0a-904c-27f2eb6c3bffについて、同じclientでget_local_connectionを試し、scope unavailableのままであることを確認してから処理した。もし予期せずconnectedだったり、別のpending状態なら、閉じずに停止するguardを置いた。

その後、確認済み計画のとおり、正規cancel_local_connectionで**client側の旧保存状態だけを閉じた**。戻り値はdisconnected=true / ownerGrantRevoked=false。owner側grantの取消を重複していない。旧grantの復活・拡張もしていない。新しいrequestIdと新しい接続IDでbegin_local_connectionを1回呼んだ。

使ったMCP toolはget_local_connection、必要なローカル切断、begin_local_connectionだけ。既存Codex設定のhashと実CLI selected設定を照合し、設定は変更していない。現行brokerはPID26656/startedAt=2026-10-19T06:21:30.396Zと既存管理helper内部で検証した。MCP用途別資格・grantの作成/受取はまだ行っていない。新規申請に必要なprivate enrollment proofの生成・保護・送信は通常のcompanion内部に留め、生値を取り出していない。コード・token・cookie・秘密をチャット/URL/argv/logへ出していない。

モデルturn・永続threadはゼロ。申請用Codex app-server PID34212はexit0で終了し、processと直接の子が残っていないことをPID metadataだけで確認した。引数・環境は照会していない。接続待ちintentは通常の保護状態として残り、client終了で自動取消しない。

証拠: preflight.json、request-intent.json、public-request.json、codex-real-request.json、owned-processes-ended.json。作成直後に新ID・期限・承認内容を先に報告した。その後の本人操作による最終承認の有無は監視していない。
