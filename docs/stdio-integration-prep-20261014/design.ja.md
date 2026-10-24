# stdio / discovery / Folder の最小統合案

独立コピーだけ。D source/dist/config/credentials/grant/security、現行daemon/固定binaryを変更しない。new real token、real grant、OS vault、native/Pi/実repoを使用しない。旧adapter337filesと各旧成果を保全する。

外側MCPは既存initialize/server-discover/tools-list/tools-call/catalog/argumentsを維持する。追加private continuation discoveryは別endpointにし、既存broker discovery version1の応答を変更しない。initialize/listからdiscoveryや承認を開始しない。

work/server/folder-mcp.tsにopt-inの短命資格stage→epoch比較付きactivateを追加する。ownerのroot/operations/grant expiryは固定し、承認期間7/31日/明示noneと資格5分を分離する。owner cookieを通常更新へ持ち込まない。default legacy経路の8h/24h契約は維持する。scope grant、role rotation epoch、receipt、client identityは別契約。

companionは最初のprivate claim後に、検証済みbootstrap/capabilityを取得するtrusted factoryを通じて内部clientを作る。通常更新をbackground/操作前ensureで行い、keys/proof/bundleをMCP結果/argv/logへ出さない。公開toolをrefresh toolへ置き換えない。既存cancelはhandle切断として維持し、owner grant解除とは別にする。

runtimeとdiscoveryを繋ぐcompositionは全providerが必要。client identity、再起動proof、issuer、vault、persistent clock/epochはfakeを個別注入し、production provider未接続のdefaultはunavailable。fixture-readyを実client PASSとしない。再起動をproofなしに採用せず、unknown daemon/child交換と実binaryのpublic版対応はUNKNOWN。

最初の統合fixtureは許可root metadataのみ。Folderの実classをコピーして使うが、providerはmemory fake、静的な公開fixture鍵vectorを注入する。既存4資格発行もfixture注入に限定し、実乱数credential生成器は呼ばない。Workspace/SDK依存を避けるため、Folderが使うPermissionFault/strictPermissionObjectだけを同一契約で抽出し、元ファイルをbaselineへ残す。

検証はlegacy非opt-inの回帰、新discovery、MCP両世代、初回一回承認、8h経過と短期rotation、旧token拒否、grant/epoch不変条件、取消、応答喪失、actor/scope/世代違い、role契約、部分失敗と秘密非公開。所有loopbackと必要ならowned Node stdioだけ。追加ソフト/新権限が必要なら停止する。実接続は未承認のまま。
