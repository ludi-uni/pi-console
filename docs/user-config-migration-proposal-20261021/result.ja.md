# pi_console_local をユーザー共通へ移す案（未適用）

## 結論とblocker

対象ブロックを同じWindows利用者・同じCodex hostのuser configへ移し、D側の4行を取り除く案を提案する。command/args/cwd/clientIdを変更せず、秘密値は設定に持ち込まない。**実際の移動先パスが未確定なので、現段階では適用可能な完成差分とはしない。**

公式仕様は **CODEX_HOME配下のconfig.toml**（CODEX_HOME既定は~/.codex）。しかし今回の正規toolには現在の通常クライアントの実効設定/CODEX_HOMEを読むものがなく、現在の診断ログ8885行にもCODEX_HOME・config.toml・configHome・userConfig等のパス記録がなかった。executorのenvをdesktop hostのenvと取り違えず、全process envや未公開app状態も取得しない。

以前確認した **C:\Users\leade\.codex\config.tomlは既定候補**であり、その当該名selectorでは重複はなかった。この証拠を再利用し、再走査はしていない。**候補の存在から実移動先を断定してはいけない。** 実際の通常クライアントが示すuser-layerのpathが得られるまで、移動先を固定して適用しない。後で正規の設定表示/診断からuser-layer pathが得られた時点で、そのパスと当該entryだけを照合する必要がある。現状で使える未確認UI操作は案内しない。

## 最小差分

移動元は前回と同じ **D:\Develop\pi-console\.codex\config.toml**。既知hash **c947f8e0ac351f8ccaba47892a864b4976ea8c605234b7a79e8e6b63e55ccecd**、内容は以下の4行（前回照合記録を再利用）。`<確認済みUSER_CONFIG>` は実パスが未確定であることを表す記号であり、この文字列のファイルを作る指示ではない。

```diff
--- D:\Develop\pi-console\.codex\config.toml
+++ D:\Develop\pi-console\.codex\config.toml
@@
-[mcp_servers.pi_console_local]
-command = 'C:\Program Files\nodejs\node.exe'
-args = ['D:\Develop\pi-console\package\local-resume-mcp.mjs', '--local-resume', 'codex-local-v1']
-cwd = 'D:\Develop\pi-console'

--- <確認済みUSER_CONFIG>
+++ <確認済みUSER_CONFIG>
@@ 既存の別セクションを維持して末尾へ追加
+[mcp_servers.pi_console_local]
+command = 'C:\Program Files\nodejs\node.exe'
+args = ['D:\Develop\pi-console\package\local-resume-mcp.mjs', '--local-resume', 'codex-local-v1']
+cwd = 'D:\Develop\pi-console'
```

変更対象は4行削除・同内容4行追加だけ。既存末尾との空行はTOMLの構造を壊さないよう補う。元ファイルは空のまま残し、ファイルや.codexディレクトリを削除しない。この4行以外が適用時に増えていたらその内容を維持し、想定外の変更は止めて再照合する。

**元ブロックを残さない理由:** project設定はuser設定より優先され、残すとD内だけ別の値が優先される状態が続き、共通設定の修正が効かないように見える。単一の管理場所にするためuser側の挿入成功を確認してから元ブロックを取り除く。同名が複数layerにあるだけで必ず2 process起動するとは断定しないが、別名への複製は重複processと別経路を作り得るため行わない。

実移動先に同名entryがあれば、標準table・子table（env等）・inline指定を限定確認する。既存entryが異なる場合は上書き/自動mergeせず差分を再提示する。既存default候補で重複なしという前回証拠は、別の実移動先や適用時点の競合なしを保証しない。

## 環境変数・起動位置

現ブロックにenv/env_varsはない。最小移動案にも足さず、Node絶対path、entry絶対path、Dのcwd、clientId codex-local-v1を維持する。user共通化しても、他repoをcwdにして起動する案ではない。

前回成功runnerはPI_CONSOLE_DATA_DIRを **C:\Users\leade\.pi\agent\pi-console** に明示した。productの解決順は PI_CONSOLE_DATA_DIR → PI_CODING_AGENT_DIR配下pi-console → homedir配下.pi/agent/pi-console。現在の通常hostが何を子processへ渡すかは未確認。同じWindows利用者・上書きなしなら既定は成功時と一致するが、別host/envまで保証しない。

その保存先の明示固定も必要と判断した場合だけ、前回報告の任意1行を別変更として扱える。

```toml
env = { PI_CONSOLE_DATA_DIR = 'C:\Users\leade\.pi\agent\pi-console' }
```

これは既存の意図したenv上書きを無視する可能性があるため、今回の最小移動には含めない。検証runnerのUSERPROFILE/PATH等を丸ごと転記しない。env名を許可/転送するenv_varsと、値を明示するenvは別契約。credentialや3用途のkeyをenv/TOMLへ追加しない。

## 利用できる会話とアクセス権の違い

user設定になると、**同じ利用者の同じCodex hostで、その設定layerを使う他projectやproject外の会話**へ対象MCPが提供され得る。projectごとの無効指定・override・policyは引き続き適用される。Windowsのuser configを移しただけで、現在host durableの会話やcloud上の「フィオ」に必ず反映されるとは言えない。別hostは別の設定・接続条件であり、今回そこへ設定や資格を配布する案ではない。

serverが保持する承認済み親・操作・期限はconfigの所在地とは別。移動のためにserver APIやgrantを変更しないので、以下の**既存記録上の範囲**を増やす操作ではない。

- connectionId: **304215fd-0ff6-416f-831c-cd03bd3a35b4**
- 親: **C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019**
- 操作: **directory / list / repo / workspace**
- grant期限: **2026-10-27T08:55:02.091Z**

これは10/20の成功記録であり、現在も有効・未解除であるとは今回照会していない。親以外のpath、削除/上書き/clone/push/公開/任意初期化コマンド、Pi実行/run/history/final本文の権限を追加しない。Consoleの管理APIの範囲でありOS sandboxを追加する話でもない。

一方、**既存範囲を行使できる会話が増えること自体は利用範囲の拡張**。他repoの会話からも、この同じ親と操作を使える機会が増える。「grantのpath等が変わらないからセキュリティ上の影響なし」とは説明しない。会話ごとの新しい本人確認・grant取得が自動的に必要になる設計でもない。

## 既存資格と新しいclient process

configには秘密がなく、移動はcredentialのコピー・新規発行・新規登録ではない。**logical clientIdをcodex-local-v1のまま維持する**。同じWindows SIDと既存dataDirなら、新たに起動された同じentryのprocessは通常の保護storeを共有して、同じclientIdの継続情報を利用する設計。新しい会話ごとに隔離した資格を新設するわけではない。

従って「新clientへkeyを手動設定」は不要だが、「別の会話/processから既存資格を利用可能にする」効果はある。別Windows利用者/別dataDir/別hostへその資格が使える保証はなく、DPAPI本人性はconfig移動では変わらない。

entry起動とinitialize/tools/listは固定catalogを返し、資格のclaim/復元/更新を行わない。後のget_local_connectionはexpectedConnectionIdによる対象固定が必要で、短期期限切れなら通常の更新・保存が発生し得る。前回の短期期限は2026-10-20T09:47:55.371Zで経過済み。grant期限とは別である。

複数processは同じprotected stateと更新用file lock/CASを使う。競合時に失敗し得るため、全会話から同時に使っても問題ないと保証しない。今回並行実クライアント試験はしていない。解除・forget・再登録を競合解決として勝手に行わない。

## バックアップ・適用・復元計画（今回未実施）

適用前提は、実USER_CONFIGの正規パス確認、対象entry/envの非秘密部分だけの重複照合、source hash一致、他会話への適用範囲を含む移動の明示許可。現在はこの前提が揃っていない。設定変更だけでhostが自動refreshする可能性もあるため、適用作業の影響範囲を決めずに書かない。

1. 2つのconfigの元byte列・存在有無・hashを通常のファイルバックアップとして保全。保存先は**確認済みCODEX_HOME配下の本人用backup領域**等、既存の本人専用領域を確認して選び、unique名で作る。repo・公開資料・chat・共有Tempへuser configをコピーしない。user configには他サービスの秘密が含まれ得るので、backupの内容はモデルへ表示/ログ化しない。ACL変更や資格storeのbackupは含めない。
2. user configの他entryを維持して対象4行だけ挿入し、TOMLと限定差分を確認。書込前hashが変わったら停止。検証後に元のproject blockを取り除く。途中で失敗したら再読込/再起動へ進めない。
3. 復元時は、移動元の当該4行を戻し、user側で今回追加したblockだけを戻す。全体hashが適用直後と一致する場合はbyte backupで正確に戻せる。途中に他設定が変わった場合はuser config全体を上書きせず、対象blockの一致を確認して逆差分だけにする。想定外の同名変更があれば停止。
4. config復元はgrant解除や保存資格の削除ではない。credential rollback・再発行・作成済みrepo削除・送信済み本文の回収は含まない。

## 適用後の最小確認（今回未実施）

まず静的に、実user configに対象entryが1つ、Dの元blockは除去、command/args/cwd/clientIdは一致、他entryは維持されていることを確認する。その後、**通常クライアントの正規catalog**でpi_console_localと新7ツール（inspect_local_connectionという名前を含む）が利用可能かを見る。inspectはhelperを起動し得るため名前だけで、呼ばない。別companionや手動CLIで代替成功を作らない。

設定の反映にどの正規操作が必要かは、対象hostの機能と影響範囲を別途確認する。ここでは未確認のUI操作や追加再起動を手順に埋め込まない。catalogに出ない場合はそこで止める。

end-to-endの確認まで必要なら、対象connectionIdの通常クライアント動作と親一覧1回を**別途明示された範囲で**行う。初期get/短期更新等が必要ならその事実を先に報告する。移動調査の許可だけで資格処理・一覧要求を行わない。過去の一回要求は対象tool不在で未送信であり、成功済みとは扱わない。

## 根拠と実施状況

公式: [config/stateの場所とCODEX_HOME](https://learn.chatgpt.com/docs/config-file/config-advanced#config-and-state-locations)、[設定優先順位](https://learn.chatgpt.com/docs/config-file/config-basic#configuration-precedence)、[MCPのstdio設定](https://learn.chatgpt.com/docs/extend/mcp#stdio-servers)。既存資料: ../config-direct-edit-review-20261021/、../client-load-read-check-20261021/、../client-startup-correlation-20261021/、../first-list-success-20261020/。source: package/local-mcp-client-state.mjs、package/local-resume-session.mjs、server/local-mcp-file-backend.mjs。

今回新たに行ったのは、利用可能な正規tool metadata確認、パスを特定するための既知診断ログの限定読取、公式資料取得、必要なsourceの静的確認、この調査記録2ファイル保存だけ。既存の設定hash・成功記録・候補user configの限定重複確認は再利用した。

設定書込/移動/削除・backup作成・資格操作・新規許可・再起動・MCP試験起動・親一覧・UI操作・画像・testは0。source/dist/既存未コミット変更・過去証拠・pi-wardenは変更していない。**残るblockerは実USER_CONFIGと対象hostの実効設定を正規に確定できないこと。**
