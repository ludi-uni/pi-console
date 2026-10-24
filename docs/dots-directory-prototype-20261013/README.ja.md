# Dots連携：workspace／directory対象の隔離試作

今回の本人了承は、再設計＋登録workspaceなしのdirectory modeを追加した画面試作と隔離検証まで。現行D source/dist・実認証・grant・接続を変更していない。旧114files／725展開hashアーカイブを維持する。

## まず見る短い流れ

1. 「Dots連携」の対象で「許可したdirectory配下」を選ぶ。rootは試作候補D:\Dummy\AllowedまたはD:\Dummy\Other。登録workspaceが空でも選べる。
2. metadata照合、新規directory、必要なら固定の空local repo構造を選び、期限を入力する。workspace登録は不要。read/write/rename/delete/processは未対応欄で区別する。
3. Dotsまたは一般MCP/stdioの接続照合を模擬する。実App／Tunnel／鍵は使わない。
4. 同じ画面でroot・操作・期限・許可しないものを確認し、checkbox後にその範囲だけの許可を模擬する。
5. 許可済みとclient確認済みを区別し、client確認を模擬する。単一child名で作成を試せる。作成物はmemoryにだけ残り、登録workspaceは0。
6. 戻る・中断・再開、切断、期限切れ、解除を確認する。試験用detailsから状態を変えられる。入力は保ち、許可・worker・転送を勝手に再実行／延長しない。

既存workspaceを選ぶ場合は、登録先と選択sessionのgenerationを明示する既存契約を使う。directory許可を要求しない。一般clientでは同じ対象／操作／期限を使い、DotsのApp／Tunnelを必須にしない。この試作は実client能力を証明しない。

## 操作できる画面を開く

試作ZIPを新しい所有Tempフォルダへ展開し、そのフォルダで次を実行する。現在のDにあるNode/tsx依存を利用するが、Consoleのstartupや実SDK/nativeは呼ばない。

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\launch-preview.mjs'
```

表示されたhttp://127.0.0.1:<dummy-port>をbrowserで開く。自分のConsole URLを入力しない。プロセスは10分後またはCtrl+CでHTTPとmemory providerを正常終了し、review-preview-owner.jsonに終了を記録する。review時は新しい展開コピーを使い、封印済み証拠rootへ追記しない。ポートは31717/31718/31719等の実Console portを使わない。review entryは2.5秒のself-checkで起動・正常終了を確認済み。本人レビュー用の10分起動はまだ実行していない。

**現状は作成系のみで、本人が求める「許可directory以下を操作」全般は未達です。既存file操作とprocess実行の別課題はnot-yet-supported.ja.mdに記載しています。**

## 対応と未対応

- 対応：既存scope APIでの許可root／receipt metadata、新規root直下directory、固定.git構造の新規生成。workspace:falseを強制する。
- 未対応：既存file一覧／本文read、任意write・上書き、rename／delete、任意shell／process、clone／push。画面でdisabled、APIでも拒否する。
- directoryはcwd／UIフィルタではなく、FolderMcpのoperation/expiry/root検査と、コピーしたsource providerのvolume/file identity・relative handle・guard契約で副作用を拒否する設計。
- そのWindows portはin-memory mock。実Windows share mode・native TOCTOU耐性、実Git認識は今回検証していない。将来のread/write等には追加のhandle API、hardlink/alias・overwrite・size・partial-write等の安全契約が必要。任意shellのOS sandboxとは扱わず、pi-wardenへ戻らない。

詳しい追加設計はdirectory-mode-design.ja.md。source/試験/bundleはこの隔離rootにあり、正式適用用diffではない。画像はui-evidence/、試験と保全結果はresult.ja.mdと各JSONで確認する。旧結果はprior-ui-evidence/と途中のRED/GREENに残す。

本人に確認してほしいのは、二つの対象選択が分かるか、登録を通らずroot・操作・期限を一連で判断できるか、未対応操作が誤解なく見えるか、背景更新を気にせず編集・中断再開できるか。テスト本数だけを本人UX受入としない。
