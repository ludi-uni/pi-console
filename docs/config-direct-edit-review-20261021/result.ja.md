# pi_console_local の直接編集要否と最小差分案

2026-10-21 05:41 UTC。調査・提案のみ。UIから編集できないという本人説明を前提とし、ファイルへの書込失敗とは扱わない。

## 結論

**現時点で必要な修正は見つからない。推奨差分は0行。** UIから編集できないことだけを理由にenabled指定や起動パスを変える根拠はない。project設定がUIで編集できない可能性と、MCP起動/接続不良は別問題。公式資料はproject設定を認めているが、現在のUIの歯車が押せない理由までは確定できない。

今回指定された **D:\Develop\pi-console\.codex\config.toml は、前回も調べた同じパスの同じ既知内容**。SHA256は **c947f8e0ac351f8ccaba47892a864b4976ea8c605234b7a79e8e6b63e55ccecd** のまま。所有記録docs/local-resume-applied-20261019/config-owned.json、直前2件の照合報告とも一致する。今回初めてこのファイルを発見したわけではない。

## 設定と成功記録の照合

```toml
[mcp_servers.pi_console_local]
command = 'C:\Program Files\nodejs\node.exe'
args = ['D:\Develop\pi-console\package\local-resume-mcp.mjs', '--local-resume', 'codex-local-v1']
cwd = 'D:\Develop\pi-console'
```

|項目|照合結果|
|---|---|
|command|web/local-resume-config.tsの生成値、前回成功companionのnode実体と一致。存在も直前照合で確認済み|
|args|同じentry、--local-resume、clientId codex-local-v1。entryはこの2引数を受け取る契約|
|cwd|生成値と成功時のrepo cwdに一致|
|enabled|このファイルにenabled=falseはない。true追加の必要性を示す証拠なし|
|env / env_vars|どちらも未指定。秘密値・bearer/OAuth設定なし。stdio companionにHTTP MCP用の認証欄を足す必要なし|

前回成功記録は2026-10-20の作業用stdio companionによるget1回・親一覧1回（completed/guardsPassed）。現在のCodexへの統合成功ではない。成功runnerにはNodeの `--import receive-guard.mjs` があるが、これは試験用の監視・限定実行の仕組みであり、通常設定に転記しない。通常configとentryの起動引数が異常に不足しているわけではない。

成功runnerが指定した環境変数名は **SystemRoot / WINDIR / PATH / USERPROFILE / PI_CONSOLE_DATA_DIR**。PI_CONSOLE_DATA_DIRの非秘密値は既存の通常保存先 **C:\Users\leade\.pi\agent\pi-console**。test用envを丸ごとconfigにコピーしたり、USERPROFILE/PATHを上書きする必要はない。

productのconsoleDataDir()は、子processに実際に渡された値を次の順で使う。

1. PI_CONSOLE_DATA_DIR
2. PI_CODING_AGENT_DIRの配下pi-console
3. Nodeのhomedir配下 `.pi\agent\pi-console`

**同じWindows利用者・該当env上書きなしなら既定保存先は成功時と一致する。** ただし現在のdesktop子processが受け取るenvや解決先を今回は取得していない。Codex側にはenv（明示設定）とenv_vars（許可して転送）という別の契約があり、親processの任意envがそのまま渡されると仮定しない。

## 設定階層とユーザー設定の限定照合

公式の優先順位は、CLI/--config → trusted projectの.codex/config.toml（cwdに近い方）→ 選択profile → user config → cloud-managed defaults → system defaults → built-in defaults。requirementsによる強制制約は別に適用される。untrusted projectではproject layerがskipされる。

`cwd` は起動するstdio processの作業ディレクトリ。これを指定しても、Codex会話がDのprojectに所属したり、別hostの会話へ設定が伝播したりすることを意味しない。前回APIで確認したこの作業会話はprojectId null/host durable、local project pi-consoleは別登録。そのため実効設定の適用範囲は引き続き未確認であり、UIに名前が出ていることだけでは埋まらない。

競合確認は **C:\Users\leade\.codex\config.toml の当該サーバー名に関係するsection/keyの有無だけ**を限定selectorで確認した。通常のtarget table、child table、[mcp_servers]内のtarget inline key、root inline指定に同名entryは見つからなかった。値は取得結果に出していない。これはfull TOMLの検証や現在hostの実効設定取得ではない。profileファイル・資格ファイル・全envは読んでいない。

従って、確認したdefault user configに同名の通常entryがあるという競合証拠はない。一方、実際のCODEX_HOME、選択profile、CLI override、policyなどを調査したとは主張しない。適用外のproject設定を直接編集しても現在の会話のcatalogを直す効果は保証できない。

## 条件付きの任意1行案（未適用・現状の修正推奨ではない）

「成功時と同じ通常保存先を明示的に固定したい」、または子processの解決先相違が後で実証された場合に限る候補。**UI編集不可や接続不良を直すと実証した差分ではない。**

```diff
 [mcp_servers.pi_console_local]
 command = 'C:\Program Files\nodejs\node.exe'
 args = ['D:\Develop\pi-console\package\local-resume-mcp.mjs', '--local-resume', 'codex-local-v1']
 cwd = 'D:\Develop\pi-console'
+env = { PI_CONSOLE_DATA_DIR = 'C:\Users\leade\.pi\agent\pi-console' }
```

効果: このentryの子processのデータ保存先だけを既存成功先に固定する。clientId、command、args、project scope、grantを変えるものではない。鍵をTOMLに置かない。

適用範囲: このproject設定が実際に採用されるhost/会話に限る。globalへの移動・複製は不要。設定編集そのものと、その後の資格読取/復元/更新は別操作。

リスク: 意図して使っていたPI_CODING_AGENT_DIR等を無視するため、相違を未確認のまま足すと別保存先を選び得る。この利用者のabsolute pathに固定され、別Windows利用者や別PCには移植できない。SID/DPAPIの本人性はenv指定で変更できない。設定の採用・再読込方法と対象startup statusは別途確認が必要であり、この案を理由に再起動を重ねない。

## 未確定部分と今回の実施

前回の起動ログでlocal App Server初期化成功は確認済みだが、pi_console_local名の起動/失敗記録はなく、実効config・対象startup statusの応答を読む正規toolもない。UIが編集不可である理由、対象の有効状態、実際のdataDirはまだ不明。これらを新たに確認したかのようには扱わない。

変更は今回の調査記録2ファイルだけ。対象config・user config・資格の書換え、権限変更、global移動、試験起動、再起動、claim/復元/更新/再発行/保護保存、追加親一覧、UI操作、画像、testはすべて0。source/dist/既存未コミット変更/過去証拠/pi-wardenは変更していない。

根拠: [公式設定優先順位](https://learn.chatgpt.com/docs/config-file/config-basic#configuration-precedence)、[公式stdio MCP設定](https://learn.chatgpt.com/docs/extend/mcp#stdio-servers)、package/data-directory.mjs、package/local-resume-mcp.mjs、web/local-resume-config.ts、docs/first-list-success-20261020/receive-once.mjsと受領・検証記録、前回のclient-startup-correlation-20261021報告。公式2ページを今回取得して照合した。
