# ローカルMCPの3点仕上げ（未適用）

2026-10-19。承認された不足3点を隔離コピーで実装した。対象はpi-consoleだけ。稼働Dのsource/dist、実資格、grant、保存済みデータ、既存接続とトンネルには変更を加えていない。pi-wardenの調査・変更・再試験は行っていない。

実装場所: `C:\Users\leade\AppData\Local\Temp\pi-console-resume-finish-20261019-a64c820e\work`。
配布候補: `source-candidate.zip`（ソース/試験18ファイルのみ）、`changes.patch`、`apply-manifest.json`。**NOT_APPLIED**。稼働distの配布や本番再起動はしていない。Dの現在の作業状態に対する `git apply --check` は成功した。

## 変更した動作

1. **通常設定からの本人確認案内**。Local MCPのOFF画面から「本人確認と接続手順」を開ける。既存のConsole PC上の `owner-login` を一回実行し、本人がyesと答え、本人の端末にだけ表示される短期codeをローカルbrowserへ入力する経路を再利用する。通常画面での閲覧・開閉は認証/接続を開始しない。Access認証をloopback本人認証へ流用しない。本人確認は手動コマンド1回を経由する点を明示している。
2. **Codex設定案内**。通常画面と本人用画面で同じ案内部品を使用。Codex用 `[mcp_servers.pi_console_local]` TOMLと、他stdio client向けのJSON例を切り替えられる。絶対Node/入口path、安定した `codex-local-v1`、同じWindows利用者/保存先という条件を示す。設定の自動保存・登録はしない。複数clientは識別子を別にする。clientInfoを認証にしない。stdio非対応clientには対応hostを使う最小fallbackを示す。
3. **初回応答喪失の復旧**。送信前にrequestId/private proof/検証済みbroker世代/作成時刻を別purposeのCurrentUser保護storeへ保存する。署名検証後にのみアクセスする。serverは同じclientId+requestId+private proofの再送に同じpendingを返し、改変再送・期限切れ・取消を新規要求にしない。companion再起動後も同じ保存記録から照合できる。broker世代変更は自動再登録せず停止する。

新規保存先は管理data directory内の `local-mcp-enrollment/state.dpapi`。SIDとdata directoryに束縛した**承認前要求の復旧専用**で、親grantや登録ownerの証明ではない。既存のserver/client保存schemaは変更していない。既存の確認待ち5分定数を使用し、本人のgrant期間や保持期限は変更していない。

取消も保存してから処理する。取消直後の中断後は、既存の承認済みclientがあっても取消意図を再接続より先に処理する。取消結果は `ownerGrantRevoked:false` とし、本人画面の許可解除と区別する。個別解除は作成済みrepoや送信済み本文の削除ではない。

## 検証

- **70/70件成功**：既存の新方式54件をリポジトリの安全な試験群へ移し、追加16件で応答喪失、再送、保護保存失敗、companion再起動、broker世代変更、失効、時刻巻戻り、複数client、取消応答喪失、取消と再接続、Codex設定を検証した。fake codec、memory backend、fake provider、公開固定dummy値のみ。`test:local-resume` を追加した。OS/native試験を含む全体npm testは実行していない。
- **Focused RED/GREEN**：修正前は初回応答喪失/companion再起動の2件がともに `not_started` となり失敗。修正後は同じpendingを取得して成功。追加レビューで取消意図が再接続に負ける余地を修正し、専用回帰を加えた。
- 型検査 `tsc --noEmit`、隔離 `vite build`、変更mjs4本の `node --check` が成功。稼働Dのdistへはコピーしていない。
- **最終採用UI run：20項目、24操作、画像5枚**。実SettingsPage/本人画面コンポーネントと実stylesheetを使用し、APIは専用fakeだけ。1280/390/320px、Codex/stdio切替、再表示、取消、二重click、承認応答失敗の照合、本人期限切れを確認。画像の390/320pxも目視確認済み。runtime error 0、live Console request 0。headless Edgeのみで、他browserの実機確認はしていない。
- UIの途中試験もTemp成果物に保全。socket切断fixtureではChromium自身がPOSTを再試行したため、アプリの二重押下検査はcommit後HTTP失敗応答で分離した。非同期結果待ち、モバイルの詳細階層、full-page撮影時の表示変化も試験側で補正した。最終画像はviewport撮影。途中runを最終合格数や実接続証明に合算していない。
- Dの既存**356ファイル**の前後SHA-256は一致。コピー時の既存差分を上書きしていない。各fixtureの一時listenerはclose済み、headless browser終了済み、専用profile削除済み。

画像: [通常設定390px](images/02-normal-codex-390.png)、[本人画面320px](images/04-owner-codex-320.png)、[応答喪失後の照合](images/05-owner-response-lost-320.png)。

Web部品は既存のbutton/select/readonly textareaとReact stateを使用。新しいclipboard/native picker等は導入していない。MDNで[textarea](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/textarea)と[select](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/select)のBaseline Widely availableを確認した。

## Codexで新方式を試すための次段階（未承認・未実行）

親へ確認すべき対象・操作・期限を以下にまとめる。この段階で実行していない。

| 対象 | 必要な操作と許可内容 |
| --- | --- |
| DのConsole | 18ファイル候補をmanifestで照合して適用し、対象UIをビルド・配布する。既存OFFを有効にするには、別途 `enabled:true` と `authorizedOS:true` の適用が必要。管理された本番再起動も別途必要で、実行中jobがないことをその時点で確認する |
| 本人確認 | Console PCで既存owner-loginを一回実行。本人のyes、2分の一回用code入力、10分の本人cookieを使う。codeをチャット/URL/argv/log/接続設定へ渡さない |
| Windows保護とbroker | 実SID/CurrentUser保護、管理されたloopback broker、承認前private復旧proofと承認後の用途別資格の生成・保護保存・private受渡しを許可する。実helper/providerの呼出を伴うことも確認する。今回のfake成功はその実証ではない |
| Codex設定 | 提案はDプロジェクトの `.codex/config.toml` に新規 `mcp_servers.pi_console_local` だけを登録すること。既存設定がある場合は上書きしない。Node/入口path、同じWindows利用者とdata directoryを確認する。実際にどのCodex hostへ読み込むかも本人確認する。現在の会話の旧plugin tool一覧を新方式に切替済みとは扱わない |
| 親フォルダ | 提案は試行専用の空フォルダ `C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019` のみ。**まだ作成していない**。本人がこの対象、または別の具体的対象を選ぶ必要がある |
| 操作 | 初回は **listのみ**。repo/workspace作成、git init、既存データ操作、clone/push、Pi実行、run/history/final本文取得は含めない |
| 期限と解除 | 初回grantは既存の最短有限選択肢 **7日**を提案し、試行終了直後に新方式の対象接続1件だけ「この連携を解除」で解除する。7日より短い期間を設定可能と捏造しない。管理者登録や旧トンネル全体の解除は使わない |
| 実行順 | 登録/再読込 → initialize/tools/list → 本人確認 → begin → ID/親/list/7日を照合して本人承認 → get → list → 個別解除後の拒否確認。応答喪失では同じrequestIdを照合し、期限/世代変更時は取消後に本人の確認へ戻る |

実資格、実grant、実データでのrepo作成、Codex永続登録、本番broker起動、既存トンネル変更、公開/pushは今回すべて0。**Codex実接続成功とは呼ばない**。旧トンネル復旧をこのローカルstdio経路の前提にしていない。

Codex設定は[Codex公式MCP文書](https://developers.openai.com/codex/mcp/)のstdio command/args/cwdとTOMLに基づく。MCP側は[stdio transport仕様](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)を使用し、内部private HTTPを公開MCP endpointや汎用OAuthとは呼ばない。
