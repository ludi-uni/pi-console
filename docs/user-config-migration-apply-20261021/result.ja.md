# pi_console_local ユーザー設定への移動結果

**2026-10-21 06:04:39 UTCに移動完了。静的検証済み。通常クライアントへの反映・接続は未確認。**

## 変更内容

本人が指定し今回明示承認した移動先 **C:\Users\leade\.codex\config.toml** に、元のpi_console_localブロック4行を同内容で追加した。元の **D:\Develop\pi-console\.codex\config.toml** は対象4行を除去し、**空の通常ファイル（0 bytes）のまま残した**。

```toml
[mcp_servers.pi_console_local]
command = 'C:\Program Files\nodejs\node.exe'
args = ['D:\Develop\pi-console\package\local-resume-mcp.mjs', '--local-resume', 'codex-local-v1']
cwd = 'D:\Develop\pi-console'
```

command・args・cwd・clientIdを維持した。env/env_vars、enabled、security設定等は追加・変更していない。ユーザー設定の既存17765 bytesはそのまま保持し、末尾への区切り空行と対象blockの追加205 bytesだけ。既存の他設定を再生成・並べ替え・整形していない。

直前の両設定をPython標準tomllibでparseし、移動先に同名entryがないこと、移動元が既知hashの当該4行だけであること、移動候補に他設定の意味的差分がないことを確認してから適用した。秘密値や他設定本文は出力していない。追加のパーサーinstallやMCP起動はしていない。

## 変更前後のhash

|設定|変更前 SHA256|変更後 SHA256|
|---|---|---|
|D側project config|c947f8e0ac351f8ccaba47892a864b4976ea8c605234b7a79e8e6b63e55ccecd|e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855|
|C側user config|f03699075a860a8ca715a98f1cd4d074c3af3e8d7a740d6e7b5cc5bd457e3629|713f39c6aab63a255f09bd5f0ccdd0eb6ddc061eb69a657c91bb2b3b9df378df|

## バックアップと復元条件

バックアップ先:

`C:\Users\leade\.codex\config-backups\pi-console-user-move-20261021-8adf9def-4aff-4835-b472-58864c2ccc04`

- **project.config.toml.bak**: 元のD側config、204 bytes。
- **user.config.toml.bak**: 元のC側config、17765 bytes。
- **manifest.json**: 対象pathと変更前後hashの非秘密metadata。

両backupは書込・flush後のhashを元byte列と照合してからconfigを変更した。backup parent `C:\Users\leade\.codex\config-backups` と上記unique子directoryを今回作成した。既存設定と同じユーザーディレクトリ配下でACLを継承し、ACL変更はしていない。user backupには既存の他設定が含まれるため、公開資料・chat等へ内容を出さない。repo内には元user configの内容を保存していない。

**復元は今回未実施。** 復元する場合はまず現在の両hashを確認する。上記の変更後hashと一致する場合、project backupをD側、user backupをC側の同じファイルへbyte単位で戻せる（既存ファイルのowner/ACLを変えない方法を使う）。project側を戻してから今回user側へ追加したblockを取り除く順とする。

変更後に別の設定変更があった場合は、user config全体をbackupで上書きしない。追加した当該4行だけが未変更か確認し、その逆差分とproject側の復元だけを行う。競合や不一致があれば止めて再確認する。configの復元はgrant解除・credential rollback・資格store削除ではない。

## 静的検証結果

- 変更前の両設定、候補、変更後の両設定のTOML構文が有効。
- 対象entryは移動先だけに存在し、値は承認したcommand/args/cwd/clientIdと完全一致。
- 元ファイルは存在し0 bytes。無関係な元contentはなかった。
- user側の既存部分はbyte一致し、他設定もparse後の値で一致。
- 両backupのhashが変更前hashと一致。
- 両configのfile identityを維持。ファイル置換・ACL/権限変更は行わず、user側へappend、source側をtruncateした。
- 適用receiptは **completed / configurationWrites=2**。

Code Reviewスキルの範囲で契約保持・重複・他設定差分・復元可能性を確認し、この静的変更に必要な未対処findingはなし。実効設定の採用と通常MCP動作は検証範囲外。

## 承認と資格に関する適用範囲

この変更はuser configを使う他の会話でも同じentryを利用可能にするためのもの。server側の親・操作・期限や資格保存先は編集していない。既存の記録上のconnectionIdは **304215fd-0ff6-416f-831c-cd03bd3a35b4**、親は **C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019**、操作は **directory/list/repo/workspace**、grant期限は **2026-10-27T08:55:02.091Z**。今回その有効性をlive照会したわけではない。

新しいclientIdやkeyを作っていない。同じSID・dataDirの通常クライアントが既存承認を使う設計はそのまま。sourceや資格storeには触れていない。設定が現在のhost/会話に採用されたか、通常catalogに対象が出るか、設定監視によるruntime側の自動反映があったかは未確認。

## 今回行っていない操作と証拠

資格の発行・claim・復元・更新・保護保存、資格store読取、MCP tool call、試験起動、親一覧、Codex/Console/PC再起動、新規許可、UI操作、画像、test実行はすべて0。手動でMCPやhelperを起動していない。承認された2config以外のsource/dist・既存未コミット変更・過去証拠・pi-wardenは変更していない。

証拠: **preflight.json**（直前identity/hash/構文/重複/候補）、**receipt.json**（段階と完了）、**verification.json**（変更後byte/構文/対象/backup検証）、**migrate.py**（実施した限定ファイル操作。applyは既存receiptがあれば再実行を拒否）。以上は今回のdirectory内。backup内容はここには含めていない。
