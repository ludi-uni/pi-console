# pi_console_local 設定・起動記録の読み取り照合

2026-10-21 05:26 UTC。資格操作・MCP試験起動・再起動・設定変更なし。

## 結論

**ローカルCodex App Serverの起動・初期化成功はログで確認できた。pi_console_local自体の起動成功/失敗と、薄いスイッチ・押せない歯車の理由は未確定。**

親が確認したスクリーンショットでは、設定 → プラグイン → MCPの一覧にpi_console_localが存在し、スイッチは右側・他行より薄い色、歯車は本人が押せないと回答した。これは登録表示の証拠として採用する。ただし色や歯車からenabled=false、policy lock、起動中、起動失敗のいずれかを選ばない。この作業では画面の直接読取はしていない。

## 設定について確認できたこと

`D:\Develop\pi-console\.codex\config.toml` のSHA256は **c947f8e0ac351f8ccaba47892a864b4976ea8c605234b7a79e8e6b63e55ccecd**。既存所有記録と一致したため、この既知の非秘密4行だけを読んだ。

```toml
[mcp_servers.pi_console_local]
command = 'C:\Program Files\nodejs\node.exe'
args = ['D:\Develop\pi-console\package\local-resume-mcp.mjs', '--local-resume', 'codex-local-v1']
cwd = 'D:\Develop\pi-console'
```

このファイルには明示的なenabled=false、env、認証ヘッダー、秘密値はない。commandのnode.exe、entryのlocal-resume-mcp.mjs、cwdのフォルダはそれぞれ存在する。従って「保存設定が消えた」「このファイルで明示無効化された」「指定した3つのパスが存在しない」は今回の証拠に合わない。一方、存在確認は起動可否・依存関係・実効設定の検証ではない。nodeやMCP entryを実行していない。

この設定はproject-scopedである。公式MCP資料でも `.codex/config.toml` はtrusted project向け、cwdはstdio processの作業ディレクトリという契約であり、cwdを指定しただけで会話がそのprojectに所属するわけではない。

前回の正規APIでは本作業会話「ローカルMCP接続とフォルダ権限を改善」はhost durable・projectId null、ローカルproject pi-consoleは別登録だった（../client-load-read-check-20261021/）。**設定のproject/hostへの適用範囲は、現在残っている具体的な確認点**。ただし、これだけでUIの薄い表示の原因と断定しない。別設定layerによる上書きやpolicyも、実効応答がないため除外できない。global config/profileや資格ファイルは読んでいない。

## 診断ログで確認できたこと

通常の診断ディレクトリ **C:\Users\leade\AppData\Local\Codex\Logs** に起動記録があった。アプリ内部DB、web cache、未公開IPCやassetsは読んでいない。2026/10/20・21の7ログを対象名で限定照合した。live logは最初の通常readが3件sharing violationになったが、FileAccess.Read + FileShare.ReadWrite/Deleteという通常の共有読取で読めた。アプリ停止・lock解除・ファイル変更はしていない。

主要ログは `2026\10\21\codex-desktop-ab59381e-6e3c-4756-9f58-efa6583448a3-40636-t0-i1-050910-0.log`。

|行|UTC時刻|診断イベント|
|---|---|---|
|18|05:09:12.685|AppServerConnectionがhostId=local、transport=stdioで起動開始|
|41|05:09:13.000|hostId=local、connecting → connected、initialized=true、connectionError=null|
|94|05:09:15.599|hostId=durable、transport=websocketで接続開始|
|319 / 473 / 642|05:09:20.341 / 24.101 / 28.542|mcpServerStatus/listのmethod trace。対象名・応答payloadなし|

05:26:03 UTCの4768行snapshotでは **pi_console_localの文字列0件**、config/read trace22件、mcpServerStatus/list trace3件、project設定をuntrusted/ignoredとする該当marker0件。残り6ログの照合でも対象名は0件だった。

したがって「再起動が一切されておらずApp Server初期化にも達していない」という見方は、この新しい起動記録とは整合しない。ただしApp Serverがconnectedであることと、対象MCP serverがconnectedであることは別。元のprocessの正常終了まではこの照合で証明していない。

MCPに関するwarning/error記録はあるが、明示されたserverは別MCP、remote hostの接続失敗等であり、対象名との関連がない。**それらの認証不足やOAuth errorをpi_console_localのエラーとして転用しない。** 今回の報告には無関係なserver名・stack・credential metadataを転載しない。ログから抽出した本文も秘密らしい値・URL等をmaskし、raw logのコピーは作っていない。最初の抽出は条件が広すぎたため、後続は対象名・起動イベント・method名の許可fieldだけに絞った。

## 絞れた範囲と残るblocker

- 確認済み: UIの登録表示、既知project設定の維持、指定path存在、local App Server初期化成功。
- 否定できない: project/host適用範囲の差、他layerやpolicy、対象の未起動または未記録エラー、UI編集制限。
- 取得不能: **現在hostの実効mcp_servers.pi_console_localと、対象serverのstartup status / failureReason**。利用可能な正規toolにはconfig/read・mcpServerStatus/listを呼ぶものがなく、診断ログはmethod名だけで応答内容を記録していない。

この不足は同じログを何度も読むことや、歯車を繰り返し押すことで埋められない。追加再起動、スイッチ操作、試験起動、新規会話作成、設定書換えは提案・実行しない。現在の原因を確認できていないため、**現段階の最小変更は「変更なし」**。

次に必要な情報は上記2つの正規診断の応答であり、現在のツール群からは取得できない。後で正規の状態取得機能または対象に限定した診断情報が利用可能になった時点で、project/hostの適用とstartup statusを照合する。global設定への移動やenabled変更が必要と判明した場合も、その具体的な差分を別途示す。現時点で原因を推測して移動・複製する根拠はない。

## 参照と実施範囲

- [公式MCP設定仕様](https://learn.chatgpt.com/docs/extend/mcp): project設定、trusted project、stdio cwd、enabled=false。
- [公式トラブルシュート](https://learn.chatgpt.com/docs/reference/troubleshooting#feedback-and-logs): 診断ログは秘密が含まれないか確認して扱う。Windows保存先そのものは今回のfilesystem metadataで確認した。
- 保存記録: ../local-resume-applied-20261019/config-owned.json、../client-load-read-check-20261021/。

実施は非秘密設定・path metadata・診断ログ・公式資料の読取と、この報告2ファイルの保存のみ。実MCP呼出し/資格claim・復元・更新・再発行・保存/inspect/追加親一覧/設定変更/再起動/プロセス終了/試験起動/UI操作/画像/testはすべて0。source・dist・既存未コミット変更・過去の証拠・pi-wardenは変更していない。
