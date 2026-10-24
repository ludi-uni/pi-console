# broker拒否の原因切り分けと、対象1接続だけを扱う最小修正案

対象はpi-consoleのみ。保存済み非秘密資料とsourceを読んだ。拒否helperの再試行、別経路のHTTP呼出、保護stateの手動取得/復号、資格操作、実接続、申請、実作成、source変更は行っていない。

## 結論と実装可否

**managed_resume_unavailableの最有力原因は、再起動後に本人用loopback listenerがまだ開かれておらず、署名付きresumeBrokerが返らなかったこと。** ただし保存済み失敗記録はgeneric reasonだけで、実際に失敗した検証条件までは残っていない。この原因を確定したとは報告しない。

**対象限定を妨げる構造は確定**: 現行サービスは個別resume/renewの認証より先に全familyのrestoreを実行する。対象1件の修正はこの結合を外す必要がある。

親から「妥当な最小修正が確定したら隔離実装・dummy試験まで、原因未確定なら推測修正せず報告」と指示された。brokerの実失敗分岐は未確定で、現在のfcfに必要なclient継続材料の保存も未確認。したがって**今回は設計までとし、推測によるbroker挙動変更や、fcfの救済を約束する実装には進めていない**。実装済み/試験済みとは扱わない。

## 1. 保存証拠から確定したこと

| 事実 | 根拠 |
| --- | --- |
| 2026-10-20T01:21:46Z頃、正規管理statusはrunning/managed。PID43932・startedAt01:16:33.010Z・31717 | docs/fcf-connection-check-20261020/preflight.json |
| 同じ事前確認でbroker helperはmanaged_resume_unavailable。MCP toolは1つも呼んでいない | 同preflight.json、McpCalls=[] |
| 01:16:33の再起動以後、その作業ではowner-loginやresumeサービスのget/view/requestを呼んでいない | docs/initial-claim-apply-20261020/runtime-application.json・result.ja.md、fcf事前確認記録 |
| listenerは初期状態でserver未作成・port=null | server/local-owner-bootstrap.ts:39 |
| 署名付きresumeBrokerは、resume有効かつlistener portがある時だけidentityに付く | server/index.ts:136–138 |
| managedResumeBrokerはbroker欠落を含む複数条件を同じreasonで拒否する | package/managed-resume-broker.mjs:4–9 |
| service getはcreateLocalMcpCompositionの全family restoreをawaitしてから個別処理へ戻る | server/local-mcp-installation.mjs:11–24、server/local-mcp-composition.mjs:30–41、server/local-mcp-http.mjs:14–16 |

本人cookie失効、fcfのscope、5分資格切れは、このhelper内で直接検証していない。今回のbroker拒否をそれらのgrant拒否やCodex MCP RPC拒否へ置き換えてはいけない。

## 2. 有力仮説と、まだ確定できない点

コード上、listenerを開くのはowner-login用issue→open、またはSettingsの認証済みstart→startBrokerである。再起動後はlistener/sessionが失われる。新たに開かなければport=nullなのでidentityにresumeBrokerがなく、helperの!bで拒否される。この因果はコードで追える。保存記録の再起動→owner-login未実施→broker不可と整合するため最有力である。

ただし失敗時の署名付きidentityについて、status値・resumeBrokerの有無・各検証結果を個別保存していない。下表のどれで失敗したかは記録から一意に選べない。

| helperの拒否群 | 今ある証拠で言える範囲 |
| --- | --- |
| state/token不在・不正、challenge不正 | 直前の正規管理status成功とは整合しにくいが、同じ読取結果/同じ瞬間とは保証できない |
| HTTP不成立、status不正、PID/開始時刻/nonce/identity proof不一致 | 正常管理statusは反証材料だが、broker呼出側の各booleanは未保存 |
| resumeBrokerなし | 再起動後listener未開設というsourceと作業記録に最も整合 |
| broker port不正・管理portと同一・broker署名不一致 | 実replyを保存していないため未排除 |

sourceから「broker欠落なら必ずこのreasonになる」と言えても、「今回の実replyでbroker欠落だった」とは別である。禁止されたhelper再試行・別HTTP経路・owner-login実行でこの穴を埋めていない。

今後の診断改善は、認証を緩めず、trusted helper内で失敗条件を固定enumへ分ける案に限定する。例えばidentity_unverified / broker_not_advertised / broker_binding_invalid。raw token、proof、reply、env、cookieは記録せず、公開MCPの拒否はgenericのままにする。これは未実装の案であり、今回の再試行を許す理由にはしない。

## 3. 本人が繰り返しログインしないためのbroker案

選択肢は次の2つ。

| 案 | 影響 |
| --- | --- |
| server起動時にbrokerを常時開く | 差分は小さいが、実際の利用要求前にlistenerを開く挙動変更になる |
| **正規管理証明を使う、明示的なオンデマンドbroker開始** | 小さな管理route/helper追加が必要だが、利用要求時だけ開き、本人UI認証と資格認証を分離できる。推奨 |

推奨案では、companionの実際の接続要求時に、既存管理tokenを保護された内部処理だけで使い、専用HMAC文脈・nonce・requestIdに結び付くPOSTでbrokerの開始だけを求める。serverは既存のliteral127/Host/proxy排除と管理証明を検証し、loopback listenerを一度だけ開いて署名付きdescriptorを返す。GET identityは読み取りのままにする。

この操作でowner bootstrap code、cookie、grant、read/control/final資格は発行しない。MCPがOFFなら開かない。同時要求/応答喪失は同じrequestIdの開始結果を照合し、別listenerを増やさない。brokerが開いたことはgrantの認証ではなく、次のprivate要求でproofを検証する。本人の新規許可・scope変更・解除には、従来の本人確認を残す。

これは現在の拒否を迂回する操作ではなく、今後のコード変更案である。現行helper失敗を自動で別経路へ切り替える処理や、本人cookieを恒久化する処理は提案しない。

## 4. 対象1接続だけを扱う最小の意味的修正

単にboot loopへfcf IDのifを足すだけでは、service読込前の認証、今後の複数client、replay/取消、保存された継続材料の問題を解決しない。fcfをsourceやconfigへハードコードする案は推奨しない。

推奨する境界は **read-only load → private要求の認証 → その1familyだけをbind/renew**。

1. composition生成時はowner/SID/installation・schema・時計を検証し、秘密の重複防止予約だけを行う。全familyのruntime復元・鍵生成・clockFloor書込を自動で行わない。request/viewは資格更新を起こさない。owner一覧に必要な保存許可metadataは読めるが、未bindを接続成功とは表示しない。
2. resume/renewでは、先にconnectionId・clientId・秘密proof、family approved、grant期限、owner、時計を検証する。clientInfoやclientId単独を認証にしない。未知ID/wrong proofで鍵生成やruntime bindを始めない。
3. 対象familyの短期資格がまだ有効なら、同じ親identityをpinしてその1familyだけruntimeにbindする。別familyは触らない。
4. 短期資格が切れていればresumeはcredential_expiredを返し、clientが保護保存済みrenewalと固定requestIdを使う既存renew経路へ進む。unboundの対象を閉じたrotation contextに載せる小さな内部処理を設け、既存stage/activateの親pin・epoch・原子的保存・revoke guardを再利用する。期限切れtokenを一時的にopenにする方法は使わない。
5. renewal receiptを**先に**照合する。起動時に先回りしてepochを進めたりreceiptを消したりしない。応答喪失の同一requestIdは同じ結果、古いrenewalの別ID再利用は従来通り拒否する。新期限はmin(now+5分, 元grant期限)。親・4操作・7日grant期限、clientProof、journalは増やさない。
6. 実際の操作RPCも現在のtoken/epoch/grant/親scopeを検証する。owner revokeは保存grantを先に確実に無効化し、対象runtimeも閉じる。request/view/revokeのために全familyを復元する構造は残さない。

保護storeが1つの暗号化文書なので、読取/再封印は文書全体に及ぶが、更新するfamily内容は認証された対象だけ。他familyの鍵・epoch・receipt・scope・grant期限・runtime状態は不変とする。global clockFloorを進める場合も、対象の成功transaction内でだけ行う。

変更面の中心はlocal-mcp-composition、FolderMcpの閉じた対象rotation準備、installation/HTTPの初期化順序、private companionの順序である。broker開始案は別の管理境界変更であり、原因確定前に同じパッチへ混ぜない。

## 5. fcfについて、broker/対象限定の2点だけでは足りない可能性

初回申請の耐久性にも制約がある。

- clientの保護enrollmentはclientId/requestId/client側proof/旧broker/作成時刻/元期限/stateを持つが、承認済みcontinuation proofやserver発行の初回claim proof/connectionIdはこのschemaに入っていない（package/local-mcp-enrollment.mjs:8,14）。
- serverのrecoverable request対応表enrollmentsとpendingはMapで、再起動で失われる。承認familyのownerProofHashはserver発行r.proofのhashで、client enrollment proofのhash/requestIdとの耐久bindingではない（server/local-mcp-composition.mjs:12,26,47）。
- clientが承認済みcontinuation stateを保存済みなら、それを使う正規resume/renewが可能。しかし未保存の場合、旧enrollmentはbroker generation一致と元期限を要求する。brokerを開くだけでこの認証条件を飛ばせない（package/local-resume-session.mjs:9,25）。
- 保存済みmetadataではclient stateファイルのmtimeは2026-10-19T09:11:19.336Zで、fcf申請の10/20 00:26:54より前。この通常のfile更新意味を前提にすれば、fcf継続材料はまだ保存されていない可能性が高い。本文を読んだ結論ではない。現在の実際のfcf保存有無は未確認。

したがって、**この2修正で今のfcfを必ず再接続できるとは約束できない**。元の初回期限を延ばす、旧generationを無視する、ID/clientInfoだけで継続秘密を再配布する、新grantを勝手に作る案は採らない。

今後の同じ繰返しを防ぐ追加設計は、申請時にclientの秘密proofとrequestId・connectionId・元期限・installation/ownerをserverの保護ledgerへ耐久的にbindingし、本人承認をそのbindingに結び付けること。private handoffとclient側保護保存完了を再送可能なreceiptで照合し、保存が確認できるまで申請状態を閉じない。再起動後は新しいserver identityを検証したうえで、その耐久proofで同じ許可を受け取り直す。期限は元のまま、取消/解除はreceiptより優先、応答喪失でも新grantを作らない。

この追加設計は、既存fcfに存在しないbindingを後から推測で埋めるものではない。既存記録の互換・migrationで欠けた証明を捏造しない。今のfcfに正規継続材料がない場合の扱いは、別の明確な回復手順が必要で、現行の承認/認証をこっそり緩める実装へ含めない。

## 6. 後続の隔離dummy受入条件（未実行）

- A/Bの2familyを保存し、Aの正規resume/renewだけ実行する。Bのepoch/5資格/receipt/scope/期限/runtime未bindが不変。Bは有効/短期失効/grant失効/revokedを含む。
- service load、owner view、新規requestだけでは両familyの資格発行/復元/保護書込が0。wrong proof/client/owner/SID/IDでも0。
- Aの5分直前/正確な境界/直後、7日grant境界、元初回期限、時計巻戻り、親差替え、revoke競合、unbound rotation中の旧token拒否。
- duplicate/lost resume・renew response、client/server restart、receipt期限・replay、部分commit時のfail closed。clientが保護保存したrequestIdが維持される。
- broker開始はfake管理providerで、正しい署名のみ開始1回、重複/応答喪失照合、MCP OFF・proxy/public/不正Host・wrong proof拒否。bootstrap/cookie/grant/資格発行0。
- durable initial handoffを追加する場合だけ、承認前後・応答喪失・client保護保存前後・server再起動の各点で、同じ元期限/同じgrantを照合し、別grant生成0と取消優先を確認する。

今回はsource変更0、隔離実装0、追加試験0、helper再試行0、HTTP呼出0、資格/接続/申請/作成/再起動0。本人への追加質問0。既存106件PASSを今回の新設計の試験結果として流用していない。pi-warden作業なし。
