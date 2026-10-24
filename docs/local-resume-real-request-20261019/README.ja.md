# 実Codexから新方式の申請成功・本人承認前

2026-10-19。owner-login完了の本人報告を受け、新方式の接続申請だけを実行した。grant承認・許可対象の列挙・repo/workspace作成はまだ行っていない。

## 実証した範囲

- インストール済み実Codex CLIの `mcp get pi_console_local --json` で、Dプロジェクトの設定1件が有効なstdio設定として読み込まれ、command/args/cwdが所有設定と一致した。raw設定、env、stderrは出力/保存していない。
- この会話には新しい直接stdioサーバーのtool定義がまだないため、旧pi_console_echo_testのtoolで代用しなかった。
- Codex公式app-server APIとインストール済みCLIから生成したschemaで `mcpServer/tool/call` を確認。実Codex CLI app-serverのMCPクライアントを使い、対象1件だけを指定する一時接続コンテキストから呼んだ。これは自作stdio clientやdummyではない。
- 独立した所有TempのCODEX_HOMEを使い、実設定と同じ対象サーバーだけを非永続CLI overrideに指定。他MCP接続は開始していない。`thread/start` はephemeral接続コンテキストのみで、**モデルturn0、永続タスク0**。推論や子agentは起動していない。
- 新サーバーinfo `pi-console-local-resume` / version1と正しい6 toolを実際に列挙し、そのCodex MCPクライアント経由で `begin_local_connection` を1回呼んだ。
- 戻り値は connected:false / pending。実際の申請がConsoleに届いた。本人cookie/codeを取り出していない。資格値の手作業抽出・出力・転送0、grant承認call0。

## 本人画面で照合する内容

**接続ID（画面で選ぶID）:** `86b3d68d-ff63-440c-8f41-d2dbb17fcf81`

再送/照合用の非秘密requestId: `codex-trial-2a637779-6228-4d08-8c4d-2a1fa4a14fdb`

申請送信: 2026-10-19T05:24:14.850Z。確認待ちの実装上限は5分であり、おおむね05:29 UTCまでの申請。期限切れ時に別要求や期間を勝手に作り直さない。

1. 先ほど本人確認した「Pi Console ローカル本人管理」の **ローカルMCP連携** を開き、「ローカル連携を始める」または「接続一覧を再取得」で一覧を表示。
2. 上記の接続IDを選ぶ。表示名だけで判断しない。
3. 親フォルダに次を指定:

   `C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019`

4. **list（許可対象一覧）のみ、7日**。directory / repo / workspace の3項目は外す。既定で他のcheckboxが入っていても承認しない。
5. 「許可内容を確認」で、接続ID・上記親フォルダ・一覧のみ・7日を確認する。ここが本人の最終承認「この内容で始める」の手前。

こちらが照合済みなのは、接続ID、空フォルダの所有identityと空であること、Codex設定の不変、指定すべきscope/periodである。**本人の認証済み確認画面の内容は読んでいない**。親フォルダ/list/7日は本人がこの画面で設定して確認する内容であり、begin申請自体がそれらを付与したわけではない。

本人cookieは10分で期限切れになり得る。期限切れなら本人がowner-loginを再実行して新しいcodeを本人画面へ入力する。codeや資格をチャットへ渡さない。

## 終了と今後

Codex app-serverとその一時MCP接続は正常終了済み。pendingの復旧情報は製品のCurrentUser保護保存に残り、同じclientIdの次回接続で照合できる。手作業で資格やprotected fileを読み出していない。

次は本人による接続承認。その後に同じ新方式のCodex MCPクライアントでget/listを検証し、対象接続だけを解除、list拒否を確認、今回のCodex設定1件を除去する。今回の成功は**実CodexからのMCP読み込みと申請成功**であり、grant承認後の一覧取得や試行完了・解除成功ではない。

根拠: [Codex app-server公式](https://learn.chatgpt.com/docs/app-server)、インストール済みCLIの公開protocol schema。証拠root: `C:\Users\leade\AppData\Local\Temp\pi-console-resume-connect-20261019-5b4c028d`。
