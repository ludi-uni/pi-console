# 新方式ローカルMCP / Codex 接続の現状調査

2026-10-19。対象は D:\Develop\pi-console の現在ソース。今回は読取と既存の隔離dummy試験だけを実施し、実装・dist・アクセス設定は変更していない。旧 pi-console-echo-test のトンネルエラーは新方式の可否判定に使わない。pi-warden は対象外で、調査・変更・再試験していない。

## 結論

新方式は「まだ実装途中」である。内部資格の自動発行、保護保存、本人承認、scope/expiry/revoke、stdio companion、署名付きbroker発見は実装されている。一方、現在のサーバーは明示的にOFF、通常設定画面は操作不能のプレビューであり、Codexに新方式を登録して接続できた証拠はない。旧接続の復旧は、この方式を完成させる前提ではない。

## 現在の配線

| 部品 | Dの実装と到達条件 | 現在の状態 |
| --- | --- | --- |
| 通常のLocal MCP設定 | `web/SettingsLocalMcp.tsx:37` は `LocalResumeMcp available={false}`。旧管理UIは別の展開操作の中 | 新方式はプレビューのみ |
| 本人確認済みloopback画面 | `web/LocalOwner.tsx:20` は認証statusの `resumeAvailable` でActiveを選ぶ | バックエンドOFFなのでActiveにならない |
| Active UI | `web/LocalResumeMcp.tsx:36` 以降。view/review/approve/cancel/result/revoke、二重送信lock、承認結果の照合、解除がある | APIは `/local-owner/resume/` 固定。通常画面のAPIへ自動接続しない |
| サーバー構成 | `server/index.ts:55` の `createLocalMcpInstallation({enabled:false,...})` | OFF。`authorizedOS:true` も渡していない |
| 本人用broker | `server/local-owner-bootstrap.ts:67,101` から新HTTP handlerへ接続。既存owner-loginが短期codeとcookieによる本人確認を行う | 遅延起動の実装はある。今回起動していない |
| HTTP境界 | `server/local-mcp-http.mjs` はliteral127、Host/Origin等を検査。本人経路はcookie、client経路はbrowser header/cookieを拒否 | 公開MCPではなくcompanion内部用HTTP。通常Access認証の代用品ではない |
| broker発見 | `server/index.ts:136` は新方式enabled時だけportを署名付き管理identityへ含める。`package/server-manager.mjs:336` → `managed-resume-broker.mjs` がpid/start/generation/portを照合 | OFFでは署名付きresumeBrokerが返らない。既存broker起動だけでは不足 |
| stdio入口 | `package/local-resume-mcp.mjs` の `--local-resume <clientId>`。stdin/stdoutのJSON-RPCとprivate HTTPを接続 | 実装あり。実CLI・実Codexとの接続は今回は実行していない |
| stdio session | `package/local-resume-session.mjs` はinitialize/initialized/tools/list/pingと6 toolsを提供 | 現行Dを使ったdummy試験で動作確認 |
| 保存・資格更新 | installation → composition → state/file backend/Windows protection。clientも別の保護storeと再接続・更新処理を持つ | 構成あり。今回の試験はmemory/fake codec/providerのみ |
| 旧owner解除との連動 | `server/settings-mcp.ts:42` は旧接続解除より先に `resumeRevokeOwner` を呼ぶ | bridgeあり。新方式OFF時は新serviceを起動しない |

内部issuerは用途別read/control/final/handoff/renewal等を別々に発行し、既存資格との重複を拒否する。人が3本のキーを作って入力する経路ではない。MCPのtool結果へ内部proof/token/renewalを出さない。親フォルダの許可はPi実行、run/history/final本文、既存exact final/read/control許可を増やさない。

## 残る最小実装と運用承認を分ける

### 実装側

1. **通常画面から本人確認へ進む導線**。通常画面の `/api/settings-local-mcp/` には新resume status/action経路がない。Active UIは別originのloopback本人API固定なので、単にavailableをtrueにしても動かない。最小の初回試行なら既存owner-login → 本人loopback画面を再利用できるが、通常設定画面から滑らかに始める完成UXには、本人確認を保つ明示的な引渡し、または認証境界を検証した専用bridgeが必要。既存Access cookieをloopback owner cookieとして扱わない。
2. **Codex用設定の出力と安定したclient識別子**。現Active UIの出力は汎用 `mcpServers` JSON、commandはPATH依存のnode、入口はDの固定path。Codex用の `mcp_servers` TOML、実在Node/入口path、同じWindows利用者・同じConsole data directoryの照合を案内する必要がある。clientIdは秘密でも認証要素でもないが、設定を再生成するたび新clientにならない再利用導線が必要。現在のUIのidはコンポーネントmount単位のメモリ値である。
3. **初回beginの応答喪失と保留復旧**。sessionはtransport.requestより先にrequestIdを記録し、同じidの再送にはpublicViewだけを返す。server.requestにはrequestIdを渡していない。応答喪失時はpending proofを照合取得できず、同じidを再送するとnot_startedのままになり得る。companion再起動時の未承認pendingもメモリだけなので復旧できない。既存の承認commit照合・更新応答喪失の試験は通るが、これらは初回begin応答喪失の検証を代替しない。これはコードからの所見で、今回新しい再現試験は追加していない。
4. **継続実行できる回帰試験の配置**。新方式の主要54試験は既存Temp成果物から再利用した。Dの通常 `npm test` 一覧には今回のresume integration/stdio/transport/readinessは含まれない。安全なfake試験をリポジトリ内で継続実行できる形にまとめる余地がある。OS/native試験を通常テストに混ぜない。

起動ゲートは未発見の機能ではなく、意図的な未適用である。既存 `docs/local-resume-integration-20261016/activation-preview.json` にも enabled:true と authorizedOS:true の案が **NOT_APPLIED_NOT_AUTHORIZED_FOR_PRODUCTION** として残っている。今回適用していない。enabledだけを変更してもWindows保護はfail closedになり、通常画面の導線も完成しない。

### 本人による実運用の承認が必要な操作

- 新方式を有効にするソースの適用と必要な本番再起動。
- 実Windows SID/CurrentUser保護を使用し、本人承認後に実資格を内部生成・保存・private配布すること。
- Codexへ新しいstdio serverの起動設定を登録すること。汎用JSONの表示や旧pluginのtool定義は、その登録完了の証拠ではない。今回プロジェクトの `.codex/config.toml` は存在せず、グローバル設定やprofileは読んでいないため、全環境に未登録と断定もしない。
- 試行用の親フォルダ・操作・期限を本人が選び、実grantを明示的に承認すること。初回実試行はlistのみと有限期限に限定できる。repo/workspace作成は別の実操作である。

以上は今回実行していない。旧トンネルの変更、Cloudflare/public listenerへの新MCP公開、3本の手作りキーはこのローカルstdio経路の前提にしない。

## Codex向けの未適用設定例

これは説明用の例であり、Codex設定ファイルには保存していない。固定clientIdは例示値。data directoryは実Consoleとの一致を別途確認する必要がある。設定を入れただけでは本人の親フォルダ承認は発生しない。

```toml
[mcp_servers.pi_console_local]
command = 'C:\Program Files\nodejs\node.exe'
args = ['D:\Develop\pi-console\package\local-resume-mcp.mjs', '--local-resume', 'codex-local-example']
cwd = 'D:\Develop\pi-console'
```

有効化後の試行手順は、同じWindows利用者のローカルCodexへ登録 → initialize/tools/list → 本人確認済みConsole画面を開く → begin_local_connectionで出たIDを照合 → 親/操作/期限を本人が承認 → get_local_connection → list_allowed_parents。実操作を伴う手順は今回は未実行。clientがstdioを起動できない場合の最小fallbackはstdio対応client/hostを使うこと。非対応clientの自動連携や旧公開トンネル経由を保証しない。

Codex公式はstdioのcommand/args/cwdと `[mcp_servers.<name>]` を説明している。MCP一次仕様はstdioでclientがsubprocessを起動し、改行区切りJSON-RPCを送受信すると定める。HTTP OAuth仕様はstdioへ適用するものではなく、この実装のローカルbroker承認は製品内部の方式である。「全MCP clientの標準OAuthで自動接続済み」とは言わない。

- [Codex MCP公式](https://developers.openai.com/codex/mcp/)
- [MCP 2025-11-25 transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP 2025-11-25 authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

## 今回の検証と限界

- 既存integration37、stdio3、transport6、readiness8、**重複を除く54件成功**。現在のDへのimportに置き換えて実行し、旧work copyの動作をDの結果と混同していない。
- 初回は53成功/HTTP1件EACCES。試験listenerはclose済み。その1件だけ、実行環境の許可を受けた専用loopback試験で再実行し成功した。55回実行を55種類の試験とは数えていない。
- HTTPは所有する一時literal127 listenerだけ。2回の所有記録ともallClosed:true。fake provider、public dummy codec、memory backend、固定公開dummy資格のみ。
- 再起動後の復旧・資格更新、期限・owner/client/parent変更、個別/全解除、二重承認、承認結果照合、更新応答喪失、scope外、部分失敗、本人未認証拒否、clientInfoに権限なし、OFF無副作用を確認した。
- 実DPAPI、native folder/provider、実repo、実Codex接続、公開endpoint、UI操作は検証していない。**今回の画像0、UI操作0**。過去のUI画像を今回の接続証明として使わない。
- 全体npm testは一覧を確認し、OS/nativeを含むため実行していない。file/native/OS専用試験も実行していない。
- ソース/既存distの183ファイルの前後SHA-256を照合し、変更0を確認。実key/grant/期限/アクセス設定の変更、本番broker起動、stop/restart、dist配布、commit/push/publishは0。

証拠の所有root: `C:\Users\leade\AppData\Local\Temp\pi-console-new-mcp-wiring-20261019-9e6b31d4`。ownership、実行TAP、初回/再実行の終了コード、listener終了記録、source前後hashを保持する。
