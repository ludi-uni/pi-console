# Codexへの反映方法 — 公式資料の読み取り調査

2026-10-20 10:40 UTC。対象はpi-consoleの通常クライアントへの反映方法。単体再読込UIが見当たらないという本人回答を前提とする。この調査では再起動・プロセス終了・設定変更・資格操作を行っていない。

## 結論と次の最小操作案

**既存のpi_console_local設定を維持したまま、全会話の実行終了後に本人がCodexを通常終了し、同じWindows利用者で起動し直してD:\Develop\pi-consoleを開く**ことが、現状で提案できる代替候補。今回は実行も依頼もしていない。Console・brokerの再起動、PC再起動、新規登録、連携解除はこの操作に含まれない。

公式MCP資料はデスクトップでの設定保存後に「Restart」を案内する。ただしこの記述だけではボタンの配置・再起動範囲・現在のインストールでの存在を断定できない。本人が見つけられなかった単体UIを再度探す手順にはしない。通常のアプリ終了・再起動案は、この公式案内とMCPのプロセス方式からの判断であり、実機で反映成功を確認した手順ではない。ウィンドウを閉じるだけでバックグラウンドhostまで終了するかも未確認。

再起動後は、公式に記載の `/mcp` の接続一覧で **pi_console_local** が認識されるかを確認する。ツール詳細を表示できる場合は **inspect_local_connection** の名前を表示するところまで。新catalogは7ツール、serverInfoはpi-console-local-resume/version 2。ただし現在のUIが名前やversionの詳細まで表示するかは未確認。表示できない場合にget/begin/listを代替の確認として呼ばない。新規チャットを作るだけで既存hostのMCPを再読込できるという保証も公式資料からは得られなかった。

**他のMCP接続に影響しないとは約束できない。** アプリの通常再起動は対象1件より広い操作。別の設定済みMCPが起動・再接続される可能性があり、その資格利用・自動処理は各実装による。今回のpi-consoleのsourceから他MCPの挙動は保証できない。公式トラブルシュートもアプリ再起動前にactive chatsの完了を待つよう案内している（同資料ではterminal不調の文脈）。

## 公式の別経路と利用上の限界

App Server公式APIには **config/mcpServer/reload** があり、ディスクからMCP設定を読み、読み込み済みthreadのrefreshをqueueする。したがって「Codexには再読込機能が一切存在しない」は誤り。一方、今回利用可能なtool metadataにはこのAPIを呼ぶtoolがなく、現在のdesktop hostへの正規接続先・対応versionも確認していない。単体server限定の引数や他の接続に影響しない保証も取得した説明にはない。

このAPIをshell commandとして案内したり、別のapp-serverを新規起動して既存desktopが更新されたことにしたり、非公開IPCへ接続したりはしない。`codex mcp list` は設定列挙、`/mcp` は接続一覧という公式説明であり、どちらもreload commandとして扱わない。設定のoff/onや同内容の書き直しも調査範囲外で、提案の必須手順に含めない。

## 保存済み情報の利用と現在の実機状態

既存記録のentryは `.codex/config.toml` の **mcp_servers.pi_console_local**。commandは既存node、argsは `D:\Develop\pi-console\package\local-resume-mcp.mjs --local-resume codex-local-v1`、cwdはDのrepo。今回10:39 UTCのSHA256は **c947f8e0ac351f8ccaba47892a864b4976ea8c605234b7a79e8e6b63e55ccecd** で、既存所有記録と一致する。中身の再表示・変更はしていない。公式資料によればproject設定はtrusted projectが対象。

前回の作業用stdio companionでは、同じclientIdの通常DPAPI保存から **304215fd-0ff6-416f-831c-cd03bd3a35b4** の資格受領・短期資格更新と許可親一覧1回が成功済み。これはdesktop統合の成功証拠ではない。保存先は **C:\Users\leade\.pi\agent\pi-console**。通常entryの解決順は PI_CONSOLE_DATA_DIR → PI_CODING_AGENT_DIR配下 → 同Windows利用者のhomedir既定。同じ利用者・env上書きなしなら保存先が一致する。現在のdesktop hostのenv上書き、実効設定、standing companion、PID、読込済みcatalogは未確認。profile/.env・全env・process command line・実資格は読んでいない。

このsourceではentry起動時にdataDirを計算してbackendを構築するが、その構築とinitialize/tools/listだけではbroker通信・SID/DPAPI helper・資格復元/更新/保存をしない。通常EOF/disposeはstoreを閉じ、forget/revokeはしない。ただし実行中の明示tool callは別。

後で明示的に **get_local_connection(expectedConnectionId)** を呼ぶ段階では保存資格の読取、broker照合、resume、必要なら短期資格のrenew/saveが発生し得る。前回短期資格の期限は2026-10-20T09:47:55.371Zで既に経過している。grantの記録上の期限2026-10-27T08:55:02.091Zとは別であり、grantが今も有効かは今回照会していない。再起動と資格の復元は別の段階として扱い、今回の読み取り許可でgetや追加一覧を呼ばない。別clientId・別の接続を自動復元する処理を起動時に加えていない。

## 追加の説明上の不整合

**inspect_local_connectionのtool descriptionにある「no helper」は実backendについて正確ではない。** sessionはstate.inspect/enrollment.inspectを呼び、main側のneed()/pendingStore()はcodec.currentSid()を使う。両inspectのstore.read()はProtectedJsonStore.read()を経由し、既存stateがあればcodec.unprotect()を使う。Windows実backendではこれらが所有helperを起動する。通信・resume・renew・commitをしないローカル読取という意味では維持されるが、「helperも資格復号もない確認」とは案内しない。今回呼出しもsource修正もしていない。通常MCPのcatalogを表示するだけならこのinspect自体を実行する必要はない。

## 根拠と今回の実施数

- [公式MCP設定・Restart・/mcp・project設定](https://learn.chatgpt.com/docs/extend/mcp#configure-in-the-chatgpt-desktop-app) — fetched 2026-10-20。
- [公式App Server API overview](https://learn.chatgpt.com/docs/app-server#api-overview) — config/mcpServer/reload。fetched 2026-10-20。
- [公式トラブルシュート](https://learn.chatgpt.com/docs/reference/troubleshooting#terminal-issues) — active chats完了後の通常再起動。fetched 2026-10-20。
- source: package/data-directory.mjs、package/local-resume-mcp.mjs:5、package/local-resume-session.mjs:21、package/local-mcp-client-state.mjs:9、package/local-mcp-enrollment.mjs:16、server/local-mcp-state.mjs:27、server/local-mcp-windows.mjs:16。
- 既存証拠: ../first-list-success-20261020/、../local-resume-applied-20261019/config-owned.json、../client-reload-read-check-20261020/。古い証拠は編集していない。

公式search 7回・取得3ページ。既存source144ファイルのhashは前回成功時の基準と全一致（10:39:31 UTC）。今回の変更はこの調査記録だけ。実MCP/HTTP/helper起動0、再起動/終了0、設定変更0、資格取得/更新/復元0、追加親一覧0、UI操作0、画像0、test実行0。pi-warden・OS試験・他アプリ・実データ作成は扱っていない。実機の反映確認と、その後の対象を固定した資格復元は未実施。
