# ローカル親フォルダ連携（配置済み・本人承認待ち）

本人が選んだ親フォルダ配下に、新しいdirectory、固定の空local Git repo、workspace登録を作るConsole管理APIです。許可対象と作成結果のmetadataだけを列挙します。既存内容の削除/上書き、clone URL、push/公開、任意初期化コマンドは扱いません。任意コマンドを実行するPi全体のOS sandboxではありません。

## 本人の最短操作

1. 承認済みprovider配置後、対話terminalで `node D:\Develop\pi-console\package\pi-console.mjs owner-login`。本人が `yes` と答え、表示された2分有効コードを開いたliteral127のbrowserへ入力します。cookieは10分。コードをコピー保存・共有・logへ出さないでください。
2. owner画面の「ローカル連携を始める」を押します。画面に出る非秘密command/argsを、対応MCP clientのstdioサーバー設定へ一度登録して起動します。
3. client stderrの接続IDとowner画面のIDが一致することを確認します。親folder、操作（list / directory / repo / workspace）、期限を選び、review確認後に承認します。本人が3本のランダムキーを用意する作業はありません。read/control/final用途は内部で分離し、handoffはprivate brokerとcompanionのメモリ内だけです。
4. agentは `list_allowed_parents`、`create_managed_workspace`、`get_operation` を使います。createには新しいrequestIdを指定します。応答喪失時は同じrequestIdのget_operationで照合し、同じ作成要求を再送して新しい副作用を起こしません。partial結果では既作成artifactを保持し、登録の成否も確認できます。
5. 戻る/取消で未承認reviewを破棄できます。承認結果不明は画面の照合で確認します。解除はowner画面の全接続解除（個別接続も可）にまとめています。解除/expiry/restartは以後の操作権限を失効させ、送信済本文や作成済repoを削除しません。

## 対応clientの必要条件とfallback

commandはNode（必要なら `C:\Program Files\nodejs\node.exe` の絶対path）、argsは `D:\Develop\pi-console\package\local-folder-mcp.mjs` と、現在のowner画面が示す `http://127.0.0.1:<owner-port>/local-owner/` の2個です。このURL/argvに秘密はありません。portはrestart後に変わるので画面で更新します。自動的にclient設定へ書き込みません。

clientは標準stdio subprocess起動、newline UTF-8 JSON-RPC、対応protocol（2025-11-25 / 2025-06-18 / 2025-03-26）、initialize待ち最大2分、stderr接続IDの表示/確認を必要とします。stdio対応だけでは待ち時間・stderr UXまで保証しません。Dotsを含む実製品clientは未確認です。clientInfoは表示情報だけで認証に使いません。

clientがstdio command/argsを登録できない、initialize待ちを許容できない、stderrを見られない場合は、この接続は成立しません。最小fallbackはこれらを設定できるstdio clientを使うことです。HTTP-only clientへこのowner URLをMCP endpointとして登録しないでください。汎用HTTP/OAuth bridge・自動discovery・万能自動接続を実装済みとは扱いません。

[MCP標準transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)でstdio subprocessとstdout/stderr分離を確認しています。[Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)はinitialize/capabilitiesとtimeout設定を規定し、clientInfoの実装情報を本人認証とは規定していません。[Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)のOAuth flowはHTTP向けで、stdioに同じflowを要求しません。この実装は標準stdio transportにConsole独自の本人承認を組み合わせています。stdio credentialの環境取得の推奨に対し、秘密の環境・設定への保存を避ける目的でlocal private brokerからメモリhandoffにしています。標準OAuth実装とは称しません。

親folder grantから既存run/history/final本文の閲覧を導きません。既存exact final/read/control契約は別の承認とscopeが必要です。public listener / Cloudflare経由のMCP拒否と既定OFFは維持します。複数clientの承認、scope、期限、receipt、失効は各接続に分離されます。

配置とruntime制限は [native provider手順](../package/native/README.ja.md) を参照してください。2026-10-11にprobeなしbinaryをDへ配置し、隔離load/export契約と稼働Console内の実ロード元/SHAを確認しました。新binaryでの実folder/repo操作・競合条件の再試験と実製品client互換性は未確認です。MCP listenerはOFFで、本人の接続承認はまだ行っていません。
