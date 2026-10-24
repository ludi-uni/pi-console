# 通常クライアントへの反映 — 読取のみの整理

## 保存先

実証した保存先は **C:\Users\leade\.pi\agent\pi-console\local-mcp-client-state\state.dpapi**。clientIdは **codex-local-v1**。資格は同じWindows利用者のCurrentUser DPAPIで保存済み。

既存の非秘密設定記録 `../local-resume-applied-20261019/config-owned.json` / README は、D:\Develop\pi-console\.codex\config.toml の **mcp_servers.pi_console_local** に、次の起動設定を置いたことを記録している:

```toml
[mcp_servers.pi_console_local]
command = 'C:\Program Files\nodejs\node.exe'
args = ['D:\Develop\pi-console\package\local-resume-mcp.mjs', '--local-resume', 'codex-local-v1']
cwd = 'D:\Develop\pi-console'
```

実証は同じentry/clientIdに **PI_CONSOLE_DATA_DIR=C:\Users\leade\.pi\agent\pi-console** を明示した。通常entryは `consoleDataDir()` を使い、優先順位は PI_CONSOLE_DATA_DIR → PI_CODING_AGENT_DIR配下のpi-console → 同Windows利用者homedirの.pi\agent\pi-console。**同じ利用者・独自env上書きなしなら既定保存先は一致する。**

ただし現在のCodex hostの実環境を調べていないため、**実稼働hostに上書きenvがないことまで確認済みとは言えない**。profile/.env・全env・資格値・process command lineを読んでいない。設定やclientId・保存先を変えたり、資格ファイルをコピーしたりする手順は不要。

## 再読込対象

記録上のアプリは **CodexのD:\Develop\pi-consoleプロジェクト**。対象は **MCPサーバーentry pi_console_local が起動するnode companion**。旧pi_console_echo_test等の別entryを証拠や代用にしない。

Console server、Startup、本人ブラウザの再表示がこのstdio processを読み直すわけではない。反映には、対象entryが**新しいprocessで同じinstalled entryをimportすること**が必要。

ただし記録には `loadedByCodex:false` があり、その後も実証は作業用stdio companionだけ。**Codexが現在この設定を読み込み済みか、対象companionが常駐しているか、正確なhost PID自体が未確認**。提供toolsに対象1件のMCP再読込APIはなく、現行Codex UIの具体的なボタン名・単体再読込機能の有無も確認できていない。

## 他接続への影響

product source上は、通常のstdio EOF/disposeはqueueを待って保護storeを閉じるだけで、forget / cancel / revokeをしない。新規processのinitialize / tools/listもbrokerや資格storeを開かず、固定catalogを返す。**対象processだけの正常な再読込はgrantや他のfamilyを解除する処理ではない。**

一方、Codex hostがそのentryを他の会話と共有しているか、単体操作が他のMCP接続まで再起動するか、再読込直後にget等を自動送信するかは未確認。実行中tool callがあるprocessの強制終了も安全とは断定しない。アプリ全体の再起動を最小操作とは勧めない。

Consoleの「連携解除」や cancel_local_connection は再読込操作ではなく、grant解除や資格忘却につながる別処理なので使わない。

## ユーザーへ依頼できる最小操作

> 同じWindows利用者のCodexでD:\Develop\pi-consoleを開き、MCP設定の **pi_console_local** が認識されているか確認してください。対象1件だけの再接続・再読込操作が用意されていれば、そのentryに実行中の呼出しがない状態で1回使うのが最小候補です。見当たらなければ、設定変更やアプリ全体再起動をせず、その状態を教えてください。

再読込後、UIでtool情報を表示できる場合は **inspect_local_connection の名前が含まれるか（実行せず）**を確認する。新catalogは7件 / serverInfo version2。get / begin / list_allowed_parents を追加の動作確認として呼ばない。既に一覧1回は実証済みで、再申請・本人再承認・Console再起動は今回の残件に含めない。

**現行UIの単体再読込手段が未確認なので、無条件に「このボタンを押せば他接続に影響しない」とは案内できない。** この情報不足は操作許可不足と別。

## 根拠・実施数

根拠: package/data-directory.mjs、package/local-resume-mcp.mjs、package/local-resume-session.mjsのdispose、package/local-mcp-client-state.mjsのdispose、web/local-resume-config.ts、保存済みconfig-owned/README、first-list-successの起動envと終了記録。

今回はこれらの既存code/非秘密記録を読んだだけ。live MCP/HTTP/helper起動・追加一覧・資格読取/更新/復元・新規申請・設定変更・再読込・再起動・新loginは0。実host環境/資格/profile/.envや他アプリを調査していない。source・dist・過去の封印済み証拠を変更していない。
