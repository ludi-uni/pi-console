# 簡略化UIから実MCP接続まで：現状と最小条件

**非破壊で進められる確認は完了。実際の本人承認済みMCP接続はまだ成立させていない。** 2026-10-16 17:43–17:49 UTCに確認。CAIVI使用中の画面は一切操作せず、実key/grant・権限ON・認証入力・tunnel新設/期限変更・restartは0。

## 今の状態

- Consoleは **D:\Develop\pi-console\server\index.ts / PID29576 / port31717 / version0.5.2**。start2026-10-16T10:37:30.601Z。以前のPID2576からは別の稼働世代になっているが、今回の作業ではrestartしておらず、開始/終了確認を通してPID29576は同じ。待受は127.0.0.1:31717のみ。
- 通常設定の簡略化UIは **LocalResumeMcp available=false**、再接続serviceも **enabled:false**、専用trusted-local既定もOFF。前回適用したsource9/dist13の全22hashは一致・不変。良評価済みUIへ変更していない。
- 読取discoveryは **409 start_local_connection_in_settings**。local owner broker待受は未開始。proxy header付きdiscoveryは403、公開/mcp/dotsと/mcp/readonlyは404で拒否されている。これらはGETだけで、接続申請やtool-callではない。
- folder providerの公開descriptorはenabled=true / contract2 / fixtureProbes=false、指定binaryは存在する。ただし今回nativeをload/起動/試験しておらず、これだけで実パスの安全性やprovider利用成功と断定しない。
- **既存の接続・grant・owner認証・tunnelの実状態一覧は未読取**。本人認証済みのAPI/browserが必要で、設定profile/.env/credentialを手動で読んだり認証を迂回したりしていない。broker未開始という観測から、全ての既存外部接続/許可が存在しないとは結論しない。実利用するclient製品/版/接続方式も未確認。

## 今回できた実証

Dの既存 **package/local-folder-mcp.mjs** を実際のNode子processとして起動し、標準stdio JSON-RPCで **initialize→notifications/initialized→tools/list（16 tool）→ping→終了** を確認した。protocol2025-11-25、server pi-console-folder-management v3、exit0、stderr0、stdoutはJSONのみ。

この子processだけHTTP/HTTPS/net接続・資格用乱数・helper起動・native module読込を拒否するpreloadを使い、全呼出数0を確認。実Consoleに接触せず、beginやtools/callを送っていない。env/cwdは所有Temp内で、実profile/credentialを使わない。**これは既存stdio companionのprotocol入口の実証であり、本人承認済み接続や実client製品の互換性実証ではない。**

新resume serviceについても、pure fake state/transportで **8/8成功**。initialize/catalogが状態・資格・transportを作らない、初期化前や未承認の操作を拒否、server identity不成立時にbegin前で止まる、不正requestを拒否、DotsというclientInfo名にも他名にも権限を与えない、OFF serviceがstorage/provider/Windows保護を呼ばない、folder catalogからPi/history/final本文権限が付かないことを確認した。

stdioはclientがsubprocessを起動してstdin/stdoutでJSON-RPCを交換する標準方式であり、この構成の根拠を[公式MCP transports仕様](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)で確認した。ただし仕様上の標準方式であることをもって、未確認のDots/他client製品がこの方式や本人承認待機に対応すると約束しない。

## 最小限の実接続実証：既存管理経路を使う場合

新しいOFF機能の解除をせず、現行の簡略化済み通常設定内に残した既存管理経路を利用するなら、次をそろえるのが最小。

1. **clientを1つ特定**する。製品・版・同じConsole PC上でnode command/argsのstdio起動に対応するかを確認する。今回のprotocol probeはclient製品の代わりではない。ローカルstdioならtunnelの新設・更新を避けられる。Dots側がremote HTTPのみなら、そのstdio経路が使えるとはせず、既存tunnel/appの再利用可否を本人認証後の読取で先に確認する。
2. **CAIVIと画面利用を調整**する。その後、通常設定→ローカルMCP→既存の接続・権限を管理の既存本人状態を確認する。認証が既に有効ならそれを利用し、必要なら本人だけが既存の画面内で認証する。コード・token・秘密をチャット/URL/argvへ渡さない。
3. **検証の新規許可範囲を具体化して本人が承認**する。既に存在する検証用親folder1つ、**一覧metadataのみ**、本人指定の有限期限を推奨。directory/repo/workspace作成、Pi指示、history/final本文を含めない。既存grantや既存tunnelの期限を変更しない。検証終了時の検証専用grantだけの解除/期限終了も範囲に含める。
4. 上記承認に **broker開始、実clientのbegin申請、内部用途別credentialの自動生成・一時保持、本人のscope承認** が含まれることを確認してから実行する。人がランダムkeyを3本作る作業は要求しない。現在の包括承認ではこれら実key/grant/auth操作を実行しない。
5. client側とUIで照合IDを一致させ、接続結果の照合後 **list_allowed_parentsを1回** 実行して、選んだfolder・許可操作・期限のmetadataだけが返ることを確認する。作成/実行/本文取得は送らない。

これは現在の **既存管理にあるfolder companion経路** の実接続確認である。通常設定の一番上の **新OFF previewからそのまま実接続する確認** と混同しない。実client用の設定形式は製品を特定した後に一次資料で確認し、汎用JSONを自動importできるとはしない。

## 新しいトップ画面から直接実接続するには

現在の上部UIはpreview専用で、既存管理の実APIへ配線されていない。LocalResumeMcpのActive側は/local-owner/resume/を固定使用し、通常設定のsettings APIにはresume status/actionの橋渡しがない。**availableをtrueに変えるだけでは成立しない**。

必要なのは、既存のAccess本人確認とloopback本人cookieを混同しないstatus/action接続、server側の明示的activation、Windows本人用保護を実行する明示許可の配線、client・folder・scope・期限の本人reviewである。現在server compositionはauthorizedOS:trueも渡しておらず、enabledだけ変えてもWindows保護でfail closedとなる。これを実施する場合は別の具体的source/security変更候補と検証を固定してから承認が必要で、server/indexの変更には通常managed restartも伴う。**今回ここへ実装・activation・restartを進めていない。**

どちらの完了を求めるか（既存管理経路で最小の実接続証明／新しい上部UIの直接実接続を完成）が次の判断点となる。前者なら新resume flagやserver変更を避けられる。後者なら上記配線作業を省略して実接続済みとすることはできない。

## 保全と終了

source/dist全22hashは終了時にも不変。Console PID/startも開始時と同じ。所有stdio/fake試験の4PID（20992/24252/32828/38620）は全終了を確認。初回2試行は検証preloadのWindows --import file URL指定ミスでproduct main前に失敗し、所有childを終了。検証側引数を修正した最終試行で成功した。

UI操作0、実Consoleへのstdio接続0、接続申請0、実key/grant/permission変更0、認証入力0、tunnel新設/期限変更0、OS/native試験0、restart0、install/update0、pi-warden作業0。作成物はこの読取記録・限定試験・条件整理のみ。現在の簡略化UIと稼働設定を維持した。
