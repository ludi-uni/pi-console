# Dots live final preflight

## Recommendation

**現稼働を変更せず、起動・配布identityを先に確定する。将来の初回接続候補は、空の専用data/workspaceを持つ別local instanceで、既知のテスト回答一件だけ。** ただし現コードのまま有効化してよい、という結論ではない。

技術的な最小対処セットは (a) workerへの秘密非継承、(b) workerから取得できないowner管理認証によるHTTP管理面保護、(c) owner管理資源とagent/workerのOSアクセス主体分離。どれか一つだけでは不足。別OSユーザーだけでもlocalhost owner APIを偽装できるため不足する。新broker/connector registry/本人認証プラットフォームは提案しない。

**実行停止条件:** 稼働entry/build/Accessが不明、Access有効、秘密保護と管理HTTP境界が未成立、専用credential分離不明、実Dotsの接続方式不明、失敗時の解除/停止を確実にできない場合。チェックボックス・localhost・本人のリスク同意を技術的分離に置き換えない。

本人に次回判断してもらう事項: 配布元と起動対象／別local試験instanceか／限定したowner管理gateとworker分離の変更許可／秘密の本人設定／既知text・exact run一件・keyholders・絶対期限（推奨5分）／実Dotsへの接続・解除拒否確認／その試験instanceだけの停止・無効復帰。各許可は別段階。

## Observed

今回許可は調査・文書のみ。cwd=`D:\Develop\pi-console`、モデル=`openai-codex/gpt-6.1-sol`。新subagent、実grant/キー/接続、試験、build、インストール、停止再起動、OS変更なし。

| 項目 | 観測事実 | まだ言えないこと |
|---|---|---|
| repository | `package.json` version 0.5.1。通常 `server/index.ts:33` はliteral `enabled:false`、credential loaderなし | このworking treeが現在稼働しているとは言えない。version番号だけの一致もソース一致証明ではない |
| inherited environment | Access team/AUD/public originの3項目とdata-dir/Pi-command設定が存在することだけ確認。値の本文は記録/出力せず、有無だけを確認 | 値の妥当性、server起動時の有効設定、stable .envとの関係は未確認 |
| listener metadata | PORT未指定時の候補31717について `127.0.0.1:31717` Listen、PID 68540をOSの非秘密metadataで確認 | pi-console serviceであること、entry/prefix/version、Access/final状態、worker SIDは未確認。port/PIDだけで管理所有を証明しない |
| CLI resolution | このPowerShellで `Get-Command pi-console` に結果なし | Pi extension・Startup・別CLI・直接起動のどれを本人が使用しているか不明 |
| historical source candidate | `package/stopped-update.mjs:6-13` は reviewed-releases/0.6.0 のentryを固定。Events archive hashを持つ | これは歴史的update target。今のlistenerへの対応も、final-ownerを含む配布物であることも証明しない |
| accepted fixtures | acceptance-5（154 bytes/5 calls）とAgentSession proof-3（82 bytes/3 calls、自然な保存/ACK、abort/revoke拒否）をread/hash保全 | 実Dots接続・本番権限境界・現稼働に対するPASSではない。再試験・再計上なし |

### 起動・配布のコード上の関係

- Pi `/pi-console` (`extensions/pi-console.mjs:1,26`)、package CLI (`package/pi-console.mjs:1`)、Windows Startup (`package/startup.mjs:1`) は同じmanagerへ委譲する。
- managerは **自分がロードされたpackageの** `../server/index.ts` を起動する (`package/server-manager.mjs:24,181`)。cwdはそのpackageRoot。stable data/.envをmergeし、明示envを優先する (`package/environment.mjs:8-16`)。管理state/token/logはstable data側 (`package/data-directory.mjs:5`)。
- 既存managed PIDが一致していればstartはalready runningを返す (`server-manager.mjs:160付近`)。repositoryの編集や別packageのCLI呼出しだけで、稼働serverが新版へ切り替わるわけではない。
- direct `npm start/dev` はrepository .envを読む別起動入口 (`package.json`)。legacy launcherもある (`package/launcher.mjs:46`)。どの入口を現在利用したか不明。
- **通常statusも今回呼ばない。** `managedServerStatus():278` は `loadConsoleEnvironment()`、`readToken()` を内部で実行する。出力がstatusでもエージェントに実.env/tokenを読ませることになる。process command line、Startup shortcut引数、実profile、ログも取得しない。live HTTP APIへの照会も未実施。
- 必要な最小不足は、本人が秘密を除いて確認した「実際の起動entry/package prefix、配布artifact/build identity、適用Access mode、管理対象instance」。APIを追加するならboolean/mode/build IDだけの非秘密status候補だが未実装。既存CLI statusではbuild sourceまで確定しない。

### local/nativeとAccess

`server/access.ts:6-15` はorigin/team/AUDを三つ一組とし、設定時はpublic Hostを固定する。通常owner APIはそのHost/Access gateの後 (`server/index.ts:101-114`)、さらにliteral-loopback Host＋local Originを要求する (`server/dots-permissions-api.ts:14-20`)。現在契約のfinal composition自体もAccess/unknownをblockedにする (`server/final-owner-composition.ts:22-25`)。

native readは独立のliteral `127.0.0.1:<port>` peer/Host、Originなし、proxy/CFなしを要求する (`server/readonly-mcp.ts:71-81`、`server/final-answer-mcp.ts`)。server/indexのfinal-mode分岐はMCP native routing用で、Access owner管理への例外ではない。**Access設定を消す、public Hostを偽る、headerを除去する、旧endpointへ迂回する案は不採用。** 現listenerがlocal owner入口と両立するとはまだ言えない。Access稼働だった場合はそのinstanceでは進めず、既存Accessを変更しない別local候補の承認に戻る。

## Boundary

以下はコード上の不足と成立する攻撃経路であり、実workerに攻撃を実行した結果ではない。現在のACL/token/整合性level/handle rightsは調べておらず、具体的なfile/processへのアクセス成功は未証明。

| 資源/経路 | コードから分かる能力・不足 | 現在の防護と限界 |
|---|---|---|
| server環境 | `PiProcess.start():75-76` が `...process.env` をspawnへ継承。managerは起動時に `PI_CONSOLE_MANAGEMENT_TOKEN` をserverへ渡す (`server-manager.mjs:181-190`)。将来final-keyを普通のserver envへ置くとworkerにも渡る | 現在final key未設定。SDK version確認やgeneration framingはenv秘密の隔離ではない |
| 公開review/save | native processはOrigin/Fetch Metadata/admin=1等の静的headersを自分で付けられる。`permissionOwnerRequest()` はpeer SIDや本人credentialを確認しない。local modeならsession→review→confirmed saveの合法API手順をworkerが自分で行い得る | CSRF/cross-origin/proxy対策、一回限りreview、CASは有効。しかし「人の確認」をworkerと区別しない |
| その他Console API | local `allowedPost()` はOriginなしを許す。`server/index.ts:115-165` にworkspace追加/text/directories/session/model/prompt/stop等のowner権限で動く一般APIがある。別SID workerでもloopback HTTPを送れる | **final owner routesだけに新しい管理認証を付けても不十分。** serverを代理にして保護領域へ到達/起動設定を変更する別の入口を残してはいけない。実経路を試していない |
| permission/config/code | same token/SIDにread/write権があるならstable permission JSON、workspaces、.env、token/profile、package/SDK/extension sourceを読む/置換できる可能性。permission readはschema/CAS検査で、disk snapshotの変更主体を認証するsealはない (`workspace-permissions.ts:44-55`)。現在epochを知り合法schemaに沿って書換える/正式APIで保存する攻撃は別問題 | lock/rename/syncは競合・部分保存・crash対策。`0o600` 指定はWindowsでworker拒否のDACLを確認した証拠ではない。同じSIDの「人だけ許可」はそのままでは区別できない |
| journal/SDK保存 | workerは自分のSDK session保存を担当し、stdout proofをserverへ送る。same SIDの読み取り可能なjournalには公開予定textがある。source/protocolを任意変更できれば保存証拠の信頼も変わる | journalのmemory seals/descriptor/identity/hashが単純な外部書換えをfail closedにする (`final-answer-journal.ts:25-34`)。任意書換えで本文が公開される、と断言しない。producerを敵対的processから認証する仕組みではない |
| process/keys | owner/serverと同等tokenならprocess操作・credential取得の可能性も評価対象。実memory/handle権は未調査 | OSの権限検証なしにprocess秘密は安全としない。file隔離だけで管理key読出しを防げたとも扱わない |

保存＋ACK＋foreground completion、exact target、期限、epoch、response後fence、専用read-key認証、secret masking、restart失効は通常動作/競合に十分な点として継承する。status/controlからの暗黙本文許可もない。ただしkeyholders認証はworkerがkeyを取得できないことが前提。connector/本人限定ではない。OS分離を追加しても、許可済みrunのmodel出力を真実にするわけではない。初回は固定test本文/hashを独立に照合する。

Windows根拠: Microsoft [Access Tokens](https://learn.microsoft.com/en-us/windows/win32/secauthz/access-tokens) はprocessのuser/group SID・privileges・restricted SIDを説明し、[How AccessCheck Works](https://learn.microsoft.com/en-us/windows/win32/secauthz/how-dacls-control-access-to-an-object) はDACLとtoken SIDの照合を説明する。今回実token/ACLを取得・変更していない。

## Minimum changes

すべて**未実装候補・別承認対象**。今すぐ実行する手順ではない。

1. **P0: identity/local条件の確定。** 正しい配布元/entry/buildを本人の安全なmetadataで確定。先行Events配布物をfinal新版扱いしない。現Access不明のままbootstrapをONにしない。
2. **P1: 管理面と秘密の最小software対処を一緒に。** worker spawnを明示allowlistにし、管理/final/status/control/実Dotsの秘密とowner設定を渡さない。owner管理HTTPにworkerが持たないactivation-scoped認証を追加し、final/base permissionと一般Console APIの代理アクセスも閉じる。全local管理API共通gateが小さい候補で、MCP専用keyとは分離する。既存management資源を利用するなら、現shutdown HMACをそのままgrant proofに再利用せずmethod/path/body/期限/再送を束縛する。現在のGUIへ安全に本人の認証を渡すbootstrapも未実装。公開HTMLや誰でも読めるendpointからその秘密を配る案は不可。外部SSO/新registry/brokerは不要。
3. **P2: OS主体/権限の分離。** 普通のsame-SID継承spawnにはACLで人/workerを分ける根拠がない。優先候補は非管理者の専用workerユーザー（または実証されたrestricted token）。owner/server/キー・管理store/journal/software prefixへのread/write/process操作を拒否し、workerは専用dummy workspace/sessionと必要なSDK読取だけ。agent/任意子processも同じ非信頼側へ置く。単にserverまで同じ新ユーザーへ移すだけでは問題を移すだけ。現在のPiProcessはWindowsの別token起動に対応しておらず、既存stdio protocolを保つ小さな起動adapter/所有handle管理が必要。アカウント・ACL・launcherは変更前に別承認と負アクセス確認が必要。UAC昇格/ACL文字列/別user名称だけを合格にしない。P1のHTTPgateも必須。
4. **P3: final-only明示構成と配布。** default OFFを保ち、承認されたinstanceだけにenabled/local、owner保護された専用read credential、既存keyとの分離情報、private journal/session/data rootsを注入する最小loader/activationを作る。今は通常bootstrapがliteral falseで、設定名/保存先/loaderは存在しない。`.env`へ一行足すだけで有効化できると案内しない。workerが読めないkey供給・epoch invalidation・local確認を一体で受入する。`controlIsolationVerified()` をtrueにしない。

P1/P2を行わない低コスト案は「任意コードを実行しないと信頼したfixtureとtestデータだけのデモ」であり、技術的分離ではない。本人の同意だけで実運用を認める推奨案にはしない。workerを先に終了すれば解決するとも言わない: 現在のfinal eligibilityはlive projectionを必要とするため (`final-owner-composition.ts:39-45`)、停止後の静的公開には新機能が必要で今回は提案範囲外。

## Approval stages

| 段階 | 作業と本人判断 | 現状/別承認 |
|---|---|---|
| 0 | 起動対象と配布hash/entry、Access modeを非秘密で提示。不明なら停止。今回報告を確認 | 文書・コード調査だけ完了。稼働identity確認は不足。実statusの秘密を含む出力を要求しない |
| 1 | P1/P3の狭いsoftware変更範囲を承認。秘密を置くowner保護領域、管理gateの対象、activationの失敗時offを確定 | 未実装。機能追加/通常bootstrap変更の別承認が必要 |
| 2 | P2のOSユーザーまたはrestricted-token方式、保護対象、stdio launcher、PID/handle所有確認を承認 | 未実装/未検証。OS/ACL/account操作は別承認。workerからfile/secret/管理APIへ届かないことが確認できない間は接続しない |
| 3 | 正しい新artifact・別local試験instanceの配布/起動を承認。既存Access instance/実dataは触らない。必要変更の受入後だけ進む | 稼働版/導入手順未確定。既存stopped updaterの外部起動baseline blockerを緩めない。インストール/停止再起動は別承認 |
| 4 | 本人が秘密を設定。以下の候補経路が実装済みと確認してからのみ実施 | 実キー生成/設定/配布・実Dots接続準備の別承認。今は入力場所が実装されていない |
| 5 | 本人が固定応答run一件、final text、keyholders、絶対expiry（推奨5分）、実Dots取得/保存・revokeを承認 | 接続と本文公開の明示別承認。初回は実モデル/実履歴不要 |
| 6 | 実Dotsでcatalog→同run tools/call→結合UTF-8/hash一致。解除review/save→保存結果照合→同target再call拒否。本文余計なしを確認 | 未実行。先行pin/control plane dummy試験を実DotsサービスPASSに読み替えない |

### 本人だけが秘密を入力する候補経路

- final read-key: 将来のloaderが対応する**owner SID保護のlocal設定領域**へ、本人が信頼したlocal UI/editorで入力。形式は現contractの64桁lowercase hex、status/control/managementのkeyと別。具体file名/設定スイッチは未実装なので今は作らない。チャット、エージェントstdin、argv、スクリーンショット、リポジトリ、ログに渡さない。
- owner管理認証: 将来の保護されたowner launcher/browser bootstrapで本人に渡す。final-keyをowner認証に流用しない。OSユーザーのpassword等はOSの本人UI/承認済み標準手段に限定し、エージェントへ渡さない。
- Dots client: 実際の製品が対応する本人専用private profile/secret storeで、本人が専用read-keyと必要なDots認証を設定する。隔離pinは `extra_headers` のenv参照とliteral loopback server URLで通った (`tests/helpers/final-owner-pin.ts:15-29`) が、実clientの保存先/既存接続方式は未確認。vendorの認証入力欄/方法を先に確認し、既存profile全文をエージェントに見せない。secret値なしのprovider方式・protocol・endpoint種別だけ提示する。環境参照はclient processだけに供給し、server/workerへ丸ごと継承しない。
- endpoint候補はliteral loopback `/mcp/dots` をnative client自身がHTTP接続する形。Origin/CF/proxy付与が必要な実構成なら止める。public Access URLへの付替えやheader除去で通さない。clientInfoで本人/connectorを限定できたとは表示しない。

### 一件だけの取得・失敗時

承認済み変更/導入が完了している場合だけ: 専用空workspace/sessionを本人が確認→既知固定応答runを開始→SDK saved/ACK/foreground completionを確認→独立final UIでexact run/本文範囲/keyholders/短い絶対expiryをreview→confirmed save/result照合→実Dots取得/hash一致→独立解除review/save/result照合→同run再取得拒否。本文貼付・history/artifact公開は不要。実Dots側がconst targetを使えるか、tool選択/結果表示・pagingを扱えるかは未確認であり、そこで途切れたら成功にしない。

失敗/未知の応答では自動再送しない。owner UIが利用可能なら既存revokeをreview/saveしresultを再読取、read拒否を確認する。client停止だけをgrant解除と扱わない。revoke確認不能なら別承認した試験instanceの停止/activation無効化を本人の管理経路で行い、短いexpiryの経過も確認する。設定のoff反映は現在hot reloadできず、将来loaderの定義と承認済み停止再起動が必要。restart/new epochで旧grantは失効するが、旧キー配布先の回収や送信済みbytesの回収とは別。キー削除/変更の反映を確かめ、再起動で古い許可を復活させない。lock tombstoneを勝手に消したり再確認なしで再grantしない。対応する停止/無効化手順が用意できない場合は段階5へ入らない。

## Preservation

今回新規文書だけ。前回result、acceptance-5、AgentSession proof-3、製品default OFF、既存未commit sourceを313ファイルのbaseline SHA256で保全。型/回帰/build/新隔離試験は変更不要のため実行しない。Temp/worker/clientを作らずcleanup対象なし。実credential/.env/profile/history/log/command line/ACL/SID本文は取得しない。許可外の不足は上記の非秘密identity情報と未実装の境界だけであり、取得・実装・運用を継続しない。
