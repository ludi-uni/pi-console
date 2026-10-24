# Codexからpi-consoleへの正規MCP試行（2026-10-19）

**Codexから既存MCPツールを実際に呼び出したが、既存tunnel-clientが未接続のため状態取得に失敗した。実接続・操作成功とは報告しない。** stdio companion単体呼出しやdummyの成功を今回のCodex実接続成功へ数えていない。

## 呼出元・対象・結果

| 項目 | 実証結果 |
| --- | --- |
| 呼出元 | このCodex会話に既に提供されているMCP pluginツール経路 |
| 対象 | 既存pi-console-echo-test plugin / get_control_status |
| 引数 | {}。新しい接続申請や資格は渡さない |
| 実呼出 | functionsの正規MCP tool呼出として1回実行。手書きHTTPやstdio模擬呼出ではない |
| 応答 | isError、NOT_FOUND、HTTP404、tunnel_client_not_seen。「tunnel-clientが300秒以上確認されていない」 |
| 到達段階 | 既存transport側のエラー。DのConsole tool handlerから状態結果を得ていない |

現在の会話には16 tool定義（folder接続/一覧/管理、Pi接続/状態/指示等）が提供されている。ただし、これは会話の利用候補カタログの観測であり、**接続先から新たにtools/listを取得できた証明ではない**。transportエラー後に他接続へ切り替えたり、begin/new grant/credential処理を呼んだりしていない。

list_allowed_parentsには同じ承認済みconnectionId/generationが必要である。現在それを有効と確認できないため、許可済みfolder metadata取得と隔離対象への操作は**未実施**。他clientのID/資格を拾ったり、存在しないIDを推測して呼んだりしていない。

## ローカルDの現状

- D:\Develop\pi-console\server\index.ts、**PID30988、port31717、version0.5.2**、start2026-10-18T05:24:42.099Z。標準managerでrunning/managed。今回開始/終了時は同じPID/start。Cの別cloneではない。待受はliteral127.0.0.1:31717のみ。
- 簡略化UIを配信したsource9/dist13全22hashは一致・不変。tracked dirty15のpath/statusも不変。今回source/distは変更していない。
- 新トップpreviewはavailable=false、serverの新resume featureもenabled:false。現行の新UIをONへ変更していない。
- local discoveryは409 start_local_connection_in_settingsでbroker未開始。proxy付きdiscoveryは403、公開側MCP pathは404。GETによる読取確認だけで、ConsoleのMCP tool-callの代替実証にしていない。
- folder providerの公開descriptor enabled=trueとbinary存在だけは確認。native load/OS試験をしていないため、実操作可能と断定しない。
- owner-protectedな接続/grant/tunnel一覧、ownerの現在のbrowser認証状態は未読取。profile/.env/keyを手動で読まず、VMC使用中の画面を占有していない。既存grantが無い、または期限切れだとまでは断定しない。

## 最小の次の一手

**VMCの画面利用と調整後、本人が既存の通常Console「設定→ローカルMCP→既存の接続・権限を管理」で、同じpi-console-echo-testの転送状態・owner・保持期限を確認する。** まず必要なのはこの既存接続の確認であり、別のstdio接続を新規登録して既存エラーを回避することではない。

実装のreuseは、同じowner/Console世代、activeのtunnel-ready、期限内、既存bindingのverify成功を必須としている。既存情報を満たせる場合にだけ、正規UIの「既存の接続を確認して使う」を候補とする。これは消えた/期限切れのtransportを無条件に再作成するボタンではない。現在はGUIを操作していないため、再利用可能かは**本人操作待ち**。古いConsole世代のrequest IDを勝手に転用しない。

同じ既存接続が復旧し、同じ呼出元に有効な承認範囲が確認できれば、Codexの同じMCP pluginから状態→有効なfolder handleの照合→list_allowed_parentsでmetadataを取得する。まず一覧metadataだけとし、本番仕事・Pi実行・repo/workspace作成は行わない。

もし既存資格の再入力/新規発行、新grant、新tunnel、期限変更が必要なら、この包括指示だけでは進めない。承認を具体化する際の最小案は、**本人指定の既存の隔離検証用親folder1つ、一覧metadataのみ、10分、作成/Pi/control/history/final権限なし、終了時は検証grantだけ解除**。transport側も同じ既存App/bindingを対象にし、必要な資格入力先は本人PCの正規画面、保持期限は本人が画面で確認する。秘密をチャット・URL・argvへ渡す手順にしない。既存の他grantや他tunnelは変更しない。

今回、新grantの申請すら実行していないので、上記は次の承認候補であって有効化済み設定ではない。

## Codexの接続面の区別

今回使ったのは、**この会話に提供済みのplugin MCP経路**である。ローカルCodex CLIへstdioを新登録した成功ではない。CLIはhelpだけを確認し、mcp add/remove/login/logout、直接設定ファイル読取や資格処理はしていない。CLI help起動時にCLI自身の一時PATH alias準備についてアクセス拒否warningが出たが、MCP設定変更を試す操作はしていない。

[OpenAI公式MCPドキュメント](https://developers.openai.com/codex/mcp/)でも、hostへ設定されたMCPとpluginが提供するMCPを区別している。今回は既存pluginが利用候補に見えることと、実際のtransport到達が失敗したことを別々の証拠として記録した。

## 成功／未実施／待ち

- **成功:** Codexに提供された16tool定義の確認、正規MCP状態取得の実試行、Dの稼働/22hash/既存差分保全の読取確認。
- **試行失敗:** Codex MCP get_control_statusはtunnel_client_not_seenで失敗。Consoleの状態・許可metadata・操作成功ではない。
- **未実施:** 新しいlive tools/list取得、許可済みmetadata、隔離操作、begin申請、資格処理、認証入力、grant変更、tunnel再作成/期限変更、代替接続での回避、GUI、restart。
- **本人操作待ち:** VMCと画面調整後の既存接続状態確認。必要になった場合だけ、上記のscope/期限/入力先を示した個別承認。

AGENTS.mdを確認し、.agents/skillsの実体は無かった。pi-warden、OS専用試験、security設定、他トンネル、本番仕事、配信データを変更していない。記録中のservice内部URL等は省き、エラー理由と非秘密metadataのみを保存した。
