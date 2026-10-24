# 新ローカルMCP適用・本人確認前の準備完了

2026-10-19。Sentinel_07c3d5d86d24819187ade477498f8a04の明示承認（今回試行に限る新ローカルMCP/Windows本人用保護の有効化と追加再起動1回）で、拒否された反映操作を一度だけ再試行した。今回は自動承認審査を通過した。05:00の承認を直前承認として扱う最新指示に従い、重複の状態質問への回答を要求していない。新たな作業や競合の証拠はなかった。

## 現在の適用状態

- D:\Develop\pi-consoleへ**19ソース/試験ファイル**を適用。元候補18ファイル＋ `server/index.ts` の新方式 `enabled:true,authorizedOS:true`。有効化に合わせたsource構成回帰1件の条件調整を含む。
- 検査済みdist7ファイルを照合し、差分5ファイルを配置。旧assetは残した。旧/public MCP設定は変更していない。
- 正規managerで停止・起動を各1回行い、新PID **7476**、port **31717**、version **0.5.2**、startedAt **2026-10-19T05:10:37.520Z**で稼働を確認。
- 今回承認分の追加再起動は**1回**。前回の元OFF版復帰分も含む履歴全体では2回。旧PID16452からの更新。
- 無関係なソースの変更0、既存保存データのlstat identity/size/mtime変更0。private/資格データの手作業複写・値の出力0。管理tokenは正規再起動の内部処理で更新されている。

## 試行用の準備

- 空の専用フォルダを作成: `C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019`。所有identityと空であることを記録。まだgrantはない。
- 新規 `D:\Develop\pi-console\.codex\config.toml` に **mcp_servers.pi_console_local の1件だけ**を追加した。既存fileは存在せず、上書きしていない。Node/入口は絶対path、clientIdは `codex-local-v1`。
- Codexでの読み込み・実接続は**未確認**。現在の会話で確認できたbegin_local_connectionのtool定義は旧pi_console_echo_test側であり、新しい直接stdioサーバーの読み込み証拠に使っていない。旧toolは呼んでいない。
- 実保存先は `C:\Users\leade\.pi\agent\pi-console` のまま。`local-mcp-enrollment` / `local-mcp-resume` / `local-mcp-client-state` はまだ存在しないことを確認した。
- owner-login、本人code発行、code入力、接続承認、実MCP資格生成、実grant作成は実施していない。本人操作前で停止した。

今回のCodex設定は秘密を含まない:

```toml
[mcp_servers.pi_console_local]
command = 'C:\Program Files\nodejs\node.exe'
args = ['D:\Develop\pi-console\package\local-resume-mcp.mjs', '--local-resume', 'codex-local-v1']
cwd = 'D:\Develop\pi-console'
```

## 検査

- 有効化候補でdummy70/70・型検査・隔離build成功済み。その候補hashを再照合して適用した。
- **適用後の実Dソースでもfake回帰70/70成功**。専用の一時literal127 HTTP、fake codec/provider/memoryのみ。実client接続・実資格/grantは0。
- 適用19ファイルと配信対象7ファイルのhash一致。無関係ソースの変更0。元source/dist356ファイルの保全backupを所有Temp内に保持している。
- UIの20項目/24操作/5画像は、同じUI候補の既存隔離検証。今回新たに認証済み実画面を撮影していない。コードや資格を撮影・転送していない。
- 通常設定画面はOFFのプレビューを残している。新経路の実操作は、本人確認後のローカル本人画面が `resumeAvailable` で開く。通常画面のプレビューだけを本番接続状態の証明にしない。

## 本人に渡す短い手順

1. **Console PCの本人のPowerShell**で次を実行する。

   ```powershell
   & 'C:\Program Files\nodejs\node.exe' 'D:\Develop\pi-console\package\pi-console.mjs' owner-login
   ```

2. 本人が明示的に `yes` と答える。端末に表示された2分有効の一回用codeを、開いた「Pi Console ローカル本人管理」のcode欄へ本人が入力し、ログインする。codeはチャット/設定へ貼らない。
3. この段階では**ログインだけ**にして、「本人確認できた」と返す。接続IDは次段階で新しいCodex接続から発行・照合する。権限の承認や旧read/control/final設定の変更はまだ行わない。

Codex側の新しい `pi_console_local` の読み込みは別途確認する。製品の自動再読込を保証せず、Dプロジェクトの再読込等で対象1件が認識される必要がある。旧Appのtoolで代用しない。

## 次段階の範囲と解除

本人確認後、新しいCodex接続のbeginで出たIDを照合し、上記の空Tempフォルダ、**listのみ、7日**を本人が確認して承認する。現UIの操作checkboxにdirectory/repo/workspaceが入っている場合は3つとも外し、確認画面がlistのみになるまで承認しない。Pi実行、run/history/final本文、repo/workspace作成は含めない。

試行直後に対象接続1件だけを本人画面で解除し、以後のlist拒否を確認する。その後今回のCodex設定を除去する。全接続や管理者登録を解除しない。`config-owned.json` のidentity/hashが変わっていれば他の変更を保全し、設定ファイル全体を削除しない。試行フォルダの削除は今回の解除手順には含めない。実接続成功/解除成功は現時点では未検証。

証拠/保全root: `C:\Users\leade\AppData\Local\Temp\pi-console-resume-retry-20261019-3e6a492d`。attempt-once、stop/apply/start、verification、applied-tests、trial-owned、config-ownedを保持する。VTS/pi-wardenへの操作は0。
