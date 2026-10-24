# 最小完成条件の設計根拠・未決事項

## Status / provenance

これは計画調査だけです。`D:\Develop\pi-console`、`main`、HEAD `6497049b8c6eed12b9ad653db97054492cf86415`、`openai-codex/gpt-6.1-sol`を確認。追加のorchestrator/subagentは起動していません。

先行runはstatusで確認しました：更新child `1d01ac6e-d4bb-45c7-a585-b89091fe54bd` complete、元の権限child `de1198e6-6d1d-4712-8563-e02f86295361` failed/timeout、resume `d4d884d7-8828-4c13-923a-6863f3b78a47` complete。いずれもProcess terminal observed。親workflow `286f0b48-b93f-467c-a483-a9b97a05fe63` はfailed、子resume完了を確認。fleetのactive asyncは0でした。これは先行子作業の終了確認であり、全OS実行や本番停止を証明したものではありません。

[先行報告](workspace-permissions-update-result.ja.md)の91PASSは39更新＋31権限/receipt/readonly＋4SDK限定＋17queue。今回テスト/診断/buildを再実行していません。開始時、先行verificationのsource/evidence hashにdriftなし。保全対象58ファイルのpath/hash集合SHA256は `4e00c192f349c33002c83620c85d436cf0a66e17c9f412595a815a133148897d`。新規計画2文書以外は変更しません。実キー/既存data・認証・grant・本番port・接続状態は取得せず、OS/ACL/network設定も変更していません。

## Threat model

### 信頼する主体と、委任された主体

- **本人**：管理対象・scope・保守期間を理解して明示操作するローカル所有者。任意コードを実行できるOS権限は事実ですが、その権限をすべてのPi実行へ委任したとは扱いません。
- **管理側**：レビュー済み・私有配置のserver/owner broker/updater。workspace内のcodeを管理権限で自動import、hot reload、npm lifecycle実行しない。brokerはモデル要求の任意URL/ファイル操作を代行しない。
- **非信頼側**：Dots入力、repoのREADME/AGENTS/設定/拡張/plugin、モデル出力、workerとその子process・shell・background job。prompt injectionを含みます。clientInfoや「本人です」という本文は本人確認になりません。
- **信頼する基盤**：Windows kernel、管理者/SYSTEM、選定した署名済みruntime/隔離機構。管理者侵害・kernel escape・本人が意図的に隔離/管理コードを書き換える攻撃は個人用の最小契約外。これらを防げるとは主張しません。

同一OSユーザーの任意codeは、GUI header/Originを偽装し、ローカルHTTPへ接続でき、owner-readable file/環境/同一権限processへアクセスし得ます。ユーザー専用ACLや同一ユーザーのDPAPIだけでは、委任workerから秘密を隠せません。sourceのアプリ内scopeとOS権限を混同しないことが必須です。

本人が別の通常Piやterminalで悪意あるrepo codeを無隔離実行すれば、そのprocessも本人権限を持ちます。「本人が起動したから内容も信頼済み」とはしません。今回の実装が保護できる範囲をDots専用workerに限定する場合も、他の無隔離agentが管理資源へ触れる限界を明示し、保守中はその実行を止める/隔離する前提を別確認します。

### 具体的に防ぐ攻撃

1. Dots指示/悪意あるrepoがworkerに `workspace-permissions.json`、registry、receiptを書き換えさせ、scopeや再実行状態を拡張する。
2. workerが管理APIへsame-origin風のHTTPを作り、短寿命grantを取得して保存する。header/grantはCSRF/順序の保護であり、OS上の本人識別ではない。
3. owner/管理/readonly/control/tunnel/provider credentialを環境、profile、ログ、process memory/handle、持ち出し先から盗む。worker向けprovider接続も管理資格とは分離する。
4. 対象workspaceのjunction/symlink/hardlink、別path、child process、shell、workspace plugin、Privileged brokerの代理実行から境界を越える。
5. owner code/実行prefix/updater/Startup sourceを変更し、次の起動で権限を奪う。許可workspaceが管理資源の親子pathやhostのhot-reload sourceと重なる場合はcontrol対象外。
6. 古いscope/instance/generation/receiptで再実行、解除中のadmission race、ACK不明の自動再送。既存CAS/admission/receipt/exact-run fenceを維持する。

悪意ある指示で対象内ファイルを壊すことや許可された情報をmodelへ送ることは、scopeだけでは防げません。対象write権限・送信先・model利用/costも本人の明示選択とする必要があります。

## Required now / later

| 個人専用でも必須 | 配布・複数利用者で追加が必要 |
| --- | --- |
| default none、明示対象、最新scope再検証、解除、unknown拒否、秘密非露出 | tenantごとのstore/credential/session分離、複数ownerの主体/role管理 |
| owner管理認証と委任workerの分離、管理APIへのworker認証拒否 | identity enrolment、離任/recovery/rotation、多端末管理 |
| 実controlにはOS/resource境界、子processとprovider経路の制約 | sandbox provisioning/更新/監査、中央policy・quota、運用監視 |
| bounded protocol検証、固定guard、redirect/任意upstream拒否 | supported platform/SDK版行列、互換releaseと配布署名/供給網管理 |
| 停止中更新の対象所属、保守排他、verified backup/復元、競合拒否 | unattended maintenance、fleet coordination、長期監査/復旧SLA |

大量の機能は将来まで不要ですが、権限境界を省略することはできません。control不要ならread-onlyとして完成させ、controlを拒否したままにできます。これは操作要件を達成したという意味ではありません。

## Dependency / completion levels

図ではなく、必要条件を列挙します。

1. **新読取り接続**：固定native認証＋新path guard＋protocol対応＋最新scope store。readonlyの範囲は現行 `get_status/get_progress` の構造化進捗で、任意workspace fileの読取りではありません。workerを開始しないのでOS worker隔離は依存条件にしません。
2. **owner管理経路**：owner認証方式の決定＋既存Access gateとの整合＋private管理資源。本人確認済み経路で既存GUI/storeを利用する。
3. **workspace scope**：2による保存/解除＋登録/canonical/観測session/generation＋admission/CAS。新endpointの実scopeを設定するために必要。fixture値は実grantの代替ではありません。
4. **worker隔離**：管理ファイル/資格/ownerAPI/privileged processからの分離＋対象だけのresource権限＋child containment＋限定broker。通常owner workerをそのまま利用できません。
5. **実transport**：1のprotocolとpin済みbinary適合→別承認の実Dots pilot。製品/版/要求方式の実証なしに最新一次仕様を「実clientが使っている版」と断定しません。
6. **停止中更新**：review済み新artifact＋対象identity＋通常終了の所属証拠＋保守排他＋backup/install/verify/restore。1〜4のsourceを本番へ反映する際の依存。隔離pilotの動的port起動には本番更新を必要としません。

完成のラベルを分けます：

- **C1：隔離実binary読取り合格**：dummy control plane/fixture scope、新endpoint、実binary。次の最短成果。
- **C2：隔離owner管理合格**：選定した本人認証とAccess構成、GUI保存/解除まで。test JWT/Temp資源は実本人資格ではない。
- **C3：実Dots pilot合格**：別承認の本物client接続で新endpointのdiscovery/read。dummy workspaceだけでも実transportの証拠にはなるが、実scope/本番の合格ではない。
- **C4：実運用read-only完成**：本人管理経路・実scope・新artifact適用・実Dots読取り/解除が本対象で合格。実キー/接続/適用の個別承認が必要。
- **C5：限定control完成**：C4＋実Windows隔離のdeny/allow証明＋明示start/stop/receipt。最初は1つの専用対象で縦断し、他の対象を未証明のまま許可しない。複数workspace選択GUIは残す。

順序の推奨はC1→C2、更新adapterを別trackで受入→C3/C4→隔離候補の実証→C5。read-firstに切り分けることへの本人確認は必要ですが、既存の操作コアを捨てたり弱めたりしません。

## Phase 1 acceptance

対象は[1ページ指示案](dots-minimum-next-phase-plan.ja.md)。実装着手前に非秘密のclient製品/版、pin済みbinaryのstartup probe/legacy要求を確認する。版を推測して任意fallbackを追加しません。

| 項目 | 必要な証拠 |
| --- | --- |
| 結線 | 実binary、dummy control plane、新guard、新endpoint。固定main、dynamic loopback、allowlist環境、専用Temp/profile。外部通信はfixture以外禁止 |
| scope縦断 | fixture owner GUIでA/sessionのみread保存→新discovery/catalog→status/progress成功。B/未観測/曖昧targetは拒否 |
| 失効 | 解除成功後、旧revision/generation/instance要求拒否。再起動後の実scope自動拡張0 |
| auth/protocol | 未認証/間違い/重複header、metadata不足、header/body不一致、unsupported version、Origin/他Host/任意path/redirectを拒否。clientInfo偽装で権限変化0 |
| 無作用 | ownerAPI/controlはnative clientから拒否。通常worker/queue/kit/provider/Events起動0、実秘密/既存data読取0。ログ/responseにdummy key露出0 |
| 回帰 | 旧scope/接続変更0、旧MCP保護・既存permission/receipt拒否が維持。影響箇所のunit、real HTTP、必要ならGUI/typecheck/隔離build |

既存manual ACL/provider/実接続fixtureを含む一括commandは自動実行せず、必要なtest名を選別し、追加のOS/秘密/費用操作は別承認にします。

実binaryでもcontrol planeがdummyなら実Dots合格ではありません。過去91件のテスト数を増やすこと自体を完成条件にせず、段階名・source/binary hash・trace分類・実証した境界を記録します。機密body/headerをraw logへ保存しません。

## Protocol evidence / known gaps

### 一次資料と実clientを分ける

このrepoの旧接続資料はofficial `openai/tunnel-client` v0.0.15を参照しています。一次資料上のOpenAI connectorはtunnel-service→client→mainのStreamable HTTP/stdio経路です。しかし利用者が「Dots」と呼ぶ製品の版、実稼働binary/profile、送信protocolは今回取得していません。旧接続が動いているという事実も今回再確認していません。[P1][P2]

現行MCP一次仕様latestは調査時に `2026-07-28` を示し、legacyは `2025-11-25` 以前と区分しています。modernはinitialize不要、各requestの `params._meta` にprotocolVersion/clientCapabilities、HTTPで版・method/name照合、`server/discover`が必須です。clientInfoはself-reportedで権限根拠にはできません。[P3][P4][P5]

### ソース照合

根拠：[`dots-permissions-api.ts`](../server/dots-permissions-api.ts)、[`readonly-mcp.ts`](../server/readonly-mcp.ts)、[`readonly-mcp-guard.ts`](../server/readonly-mcp-guard.ts)、[`index.ts`](../server/index.ts)。

| 契約 | 新 `/mcp/dots` の現状 | 次に必要な限定作業 |
| --- | --- | --- |
| modern discovery/metadata | `server/discover`非対応。tools/list paramsは空、tools/call paramsはname/argumentsだけ。`_meta`はstrict validationで拒否 | 認証後にbounded metadata検証、validated RPCを既存readコアへ渡す。supported版だけadvertise |
| HTTP header/version整合 | `MCP-Protocol-Version`/Mcp-Method/Mcp-Nameを検証せず、汎用409/-32602へ集約 | 規定の400/HeaderMismatch、UnsupportedProtocolVersion、未知method等。認証/境界エラーをprotocol fallbackに変換しない |
| legacy lifecycle | initialize paramsの版/capabilities/clientInfoを検証せず2025-06-18固定。id必須なので`notifications/initialized`を拒否 | legacyを採用する場合のみ初期化/notification 202等の契約を限定追加。initializedはMCP lifecycleでありEvents購読ではない |
| HTTP方式 | Content-Typeは厳密文字列一致。Accept検証なし。GETは405を返すがAllow headerなし | 選定版のmedia/header/method処理に合わせる。SSE/Eventsを不要にするJSON-only read経路を選ぶ |
| guard結線 | 旧guardは `/mcp/readonly` と旧metadata pathだけ、旧tool allowlist。新pathを通さない | 別の固定read-only binding。旧guardを丸ごと開放せず新path/toolだけ限定許可 |
| proxy認証 | 新APIはnativeDenialReasonsが1つでもあると認証前403。旧APIは専用auth成功時だけproxy headerの存在を許す | 新guardで不要headerを再生成/破棄。guard→新endpointはOrigin/proxy/CFなし。入口でのproxy存在許可は認証済み固定契約に限る |
| 認証独立 | indexの`mcpAuthentication` loadは旧MCP enabledに依存。新APIへ同じ値を渡す | 新read認証の明示条件を独立させる設計が必要。新機能のため旧scope/endpointを勝手にenableしない |
| tools catalog | 操作不能でもcontrol系toolを列挙 | read-only adapterは2つだけadvertise。annotationは認可ではない。コア側拒否も残す |
| OAuth discovery | 新pathのmetadata専用契約なし。旧metadataは旧MCP用 | 採用clientが必要とするexact absence/error処理のみ。OAuth/Harpoon/一般proxyを追加しない |

JSON-only・sessionless自体は欠陥ではありません。`2025-06-18`でもGET SSEは提供せず405にでき、session IDは任意です。一方initialize/notification等の必要契約は省略できません。[P6] modernのcoreには旧session/SSE機構が不要なので、最新版への限定対応が大きなsession機能より短い候補です。ただしbinaryのstartup要求や実Dotsの対応版が確認できなければ、その推奨を実装決定にしません。

## Owner management / Access

観測した矛盾：`allowedHost(config)`はpublic Hostのみ、global verifierは署名/issuer/audience/type/sub等を検証してbooleanを返します。owner APIはloopback Host＋proxy/CF headerなしを要求し、global gateの後に実行されます。Access有効時は両方を満たせません。また「有効なAccess利用者」と「このscopeを変更できる本人」は現行booleanだけでは区別できません。

| 設計案 | 必要な保護 | 判断/コスト |
| --- | --- | --- |
| **A：local専用owner broker**（local要件を保持する候補） | 既存public Host/Access gateはそのまま。別の私有管理境界に本人OS identity/owner-private capability認証を設計し、browser短寿命session＋Origin/Fetch/CSRF/CASを追加。workerはcredential/file/IPCに到達不可。proxy/tunnelから管理routeへ0到達 | 新port/IPC/credential/launcher等は追加surfaceとして別承認。shared serverのgate前へ無認証routeを移す案ではない。既存WorkspacePermissions UI/storeを再利用し、汎用管理機能は作らない |
| **B：Access認証済み本人管理** | public gateを必ず通り、検証済みissuer＋固定owner subject、interactive token、Origin/CSRF、短寿命grant/明示confirmを検証。service token/非owner/自己申告header拒否 | local-only管理要件をremote管理へ変える選択。本人の要件変更承認が必須。JWT単なるdecode・全Access利用者をowner扱い・readonly key転用は禁止 |
| **C：同一listenerでloopbackをHost/Access例外化** | headerだけでは本人識別不可 | 現行gate迂回になるため不採用。認証済み新管理境界として再設計・承認なしに採用しない |

Aの具体認証はWindows identity対応brokerまたは私有capabilityによるowner bootstrapの小規模実証で選定します。cookieを使うならHttpOnly/SameSite/短寿命、許可Origin・TLS必要条件を設計し、capabilityをURL/argv/logへ置かない。cookie属性だけを本人確認にしません。Bも本人subject登録/recoveryと接続設定の別確認が必要。[P7]

管理brokerの本人証明に既存management shutdown tokenを転用しません。worker専用pipe/brokerはgrant保存やcredential取得を代理できないoperation allowlistとします。APIへのネットワーク到達が残っても、workerは認証不可かつ状態変更0であることを実証します。

## Worker isolation options

**最小機能**：専用workerが、(a)管理資源をread/write/replace/rename不能、(b)owner credential/ブラウザーprofile/管理processへアクセス不能、(c)ownerAPIへ認証/保存不能、(d)その許可対象だけのtool権限、(e)子processにも同じ制約、(f)provider接続だけの限定資格/代理機構を持つこと。環境allowlist・scope/run fenceは追加防護であってOS境界の代わりではありません。

現行[`PiProcess.start`](../server/adapters/pi/process.ts)はowner SIDでspawnし、基本的にprocess.envを継承します。SDK/profile/extension discoveryもowner環境に結合します。これを元のworkerへflagを付けるだけで「隔離済み」としてはいけません。

| 手段 | 管理ファイル/credential/ownerAPIの境界 | Windowsの必要作業・制限 |
| --- | --- | --- |
| **AppContainer/LPAC＋限定broker＋Job** | OS token/capabilityでfile/process/credential/networkを制限。対象別Package SID/ACLと固定IPC。modelは外側brokerか別の最小資格。networkなしを起点としowner listenerのloopback exemptionを与えない | profile/SID作成、Node/SDK/必要DLLをread-execute許可、workspace限定ACL、scratch/session、native launcherの属性/token/handle制御、broker設計。Node/SDK/拡張の実互換は未検証。既存のloopback exemption・ALL APPLICATION PACKAGES権限等も確認。最初の実証候補 [P8][P9] |
| **専用standard OS account＋ACL＋broker/network制御＋Job** | ownerとは別SID。管理root・コード・秘密にアクセスを与えず、専用対象とscratchだけ。ownerAPIの本人credentialは持たせない | account/profile/login方式、私有root ACL、明示SID、必要なnetwork/IPC rule、provider代理。別accountだけではHTTP接続を止めない。複数workspaceを同一accountへ全部grantすると対象間隔離にならないため対象別境界が必要 |
| **Windows Sandbox/VM** | private管理rootは一切mountせず、選択対象だけ共有/出力受渡し。network/clipboard等を閉じ、providerだけ安全に仲介 | OS edition/virtualization/feature確認、導入・restart可能性、image/runtime配置、共有folderとnetwork設定。Windows Sandboxは既定でnetwork/clipboard有効、mapped folderは既定write可なので既定起動を安全扱いしない。永続session/IPCコストが大きい [P10] |
| **同一SIDのrestricted token/low integrity** | resource DACL/process権限等を正しく制約できれば候補。ただの低integrityは主にwrite-up保護で、owner秘密read/network本人認証の証明ではない | token SID/privilege/restricted SID、resource/handle/child/network設計が必要。SSPI/DPAPI等のowner資格が使えないことも実証。AppContainerより簡単とは限らず未受入 |
| **tool allowlist/extension hook/env除去だけ** | SDK拡張やNode自体の任意code、子process、HTTP、process/fileアクセスを完全に遮断できない | 縮小機能の補助策。悪意あるrepoを含む現要件のcontrol完成には不十分。不採用のまま拒否 |

Job Objectは所属/寿命/child cleanupの部品で、file/credential sandboxではありません。子processのbreakaway、WMI等の別起動方式を考慮し、Jobだけを全子孫証明にしません。unsafe spawn手段は隔離資源/IPC/権限で禁止する必要があります。[P11]

### 実証テストと本人操作

最初は**管理資源も全部dummyの専用Windows試験**でdenyを測定します。実data/秘密に触れて証明しません。

- workspace/scratchへの許可動作は成功。管理scope/registry/receipt、code/prefix/updater、fake credential、別workspaceへのread/write/delete/rename/link/ACL変更は失敗。
- child/shell/pluginから同じ試行、環境/handle継承・privileged process読み取り/注入・clipboard/profile参照を拒否。brokerへ任意URL/管理API/新scope要求は拒否。
- literal loopback、IPv6、公開Access経路へHTTPを作ってもowner session/grant/save不可。Origin/CF/clientInfo偽装で認証不可。
- model connectionの許可範囲だけ成功、管理/tunnel/provider owner keyの共有0。未知token/capability/ACL/Job stateやbroker停止はdispatch前拒否。
- approved launchに結び付く実token/SID/capability、resource ACL、対象path、code hash、child containmentを毎回検証。probe成功履歴や設定booleanだけで`controlIsolationVerified`をtrueにしない。

本人の必要操作は、候補方式の選択、対象/私有root/scratch・SDK配置の確認、OS feature/account/profile/SID作成・ACL/network/broker導入の個別承認、provider方式/費用の確認、negative test結果と通常workerを流用しない運用の受入です。今回これらは実施していません。専用workerのsessionRootもownerの全既存session directoryを共有しません。

## Stopped update / maintenance contract

### 全OS不存在ではなく、対象と権限に関係する範囲

[`stopped-update.mjs`](../package/stopped-update.mjs)の現契約はcomplete/externalStartExclusionとrunning/uncontrolled空を要求し、実CLIはadapterを持たず拒否しています。[`diagnostics`](../package/stopped-update-diagnostics.mjs)の全OS snapshotは候補探索であり、停止/将来の排他の証明ではありません。過去の「metadata未観測143」は全143processが対象を起動する証明でもありません。

次の設計で観測領域を明確にすることは可能ですが、**既存のboolをそのままtrueにする修正ではありません**。

- domain：固定dataDir/prefix/entryを使うserver、所属worker/background、guard/tunnel、manager/Startup/Pi hook、既知task/service/wrapper、同prefixのnpm/updater。名前一致だけでなくOS PID＋create time＋SID/image/canonical target・信頼するlaunch provenanceを結び付ける。
- 観測：通常終了前の対象/所属一覧（非秘密lifecycle attestation）、終了後のprocess handle/Job/registry、listener、lock、起動元policyと対象のfilesystem identity。PID/parent PIDだけでは再利用/orphanを解決しない。
- 信頼：OS基盤、本人の明示保守操作、レビュー済みlaunchersと私有対象へのACL。対象を変更できる非信頼worker/更新元は停止/隔離する。別の本人操作や承認されていない直接start/updateを保守中に行わない。
- 除外：無関係なOS processは、SID/resource権限/launch domain等で除外根拠を示す。SYSTEM/adminは信頼基盤として明示。関連可能性を分類できないowner process、target可変権限を持つ別主体、観測不能な所属workerは拒否のまま。全nodeを無関係扱い、空きportだけの判断は禁止。

### 信頼契約の選択肢

**U1：個人用の明示保守契約**：管理側lockは全既知launcher/updaterが参加。本人がauto-start源を承認済み操作で保守停止し、他の非信頼owner code/直接起動/外部更新を行わない期間を定義。adapterはそのpolicy/provenance/所属終了を検証し、反復観測と異常検出を行う。ただし未知の同権限programの将来動作をsnapshotで機械的に排他したとは言わない。どの本人行動を信頼するかを明示する**保証範囲の確認/変更**なので、本人承認前に採用しません。自己申告checkbox1個からapply可にはしません。

**U2：保守排他をより機械的にする契約**：private実行/更新root、専用launch/update broker、固定権限、launch gate/Job provenance等で非信頼主体のdirect start/updateを抑止。本人/adminの意図的な回避は信頼基盤外。追加OS配置や導入費用が必要。Jobや普通のlockだけでは、参加しないstart/npm更新を排他しません。

U1を承認しない/条件を確認できないならU2の実証まで本番拒否を維持します。guard/tunnelの通常終了も新規リクエスト・credential保持を閉じるため確認する。保守中の起動検知は**事後防護**で、既にpartial softwareをruntimeが読んだ危険を取り消せません。予防的起動元管理の代替ではありません。

### 最小adapterと順序

1. **準備**：現在source用のreview済み配布artifact/正確なmanifest/hashを新しく固定する。現coreの139files/hashは旧Events候補で、今回sourceを含む新releaseではない。unversioned現checkoutをそのまま既存pinへ合わせない。
2. **owner通常終了**：既存所有確認済みの操作で本人が実施。ブラウザー/Pi終了だけでは不十分。adapterは勝手にstop/restartしない。終了前attestation/provenance取得の設計を先に受入し、既に終わったprocessを後から推測しない。
3. **維持する排他**：固定dataDirのwx manager互換lock、approved domainのexternal-start契約とpolicy確認。既存/stale/unreadable/foreign lockは拒否。別prefix/npm更新や残留worker、直接startが不明ならbackup/install前に中止。
4. **実IO adapter**：canonical inspect、private backup配置/manifest、信頼済みarchive reader、offline install（ignore-scripts/omit-dev）、依存も含むinstalled manifest/hash検証を既存engineへ結線。networkや未知npm cache fallbackを許さない。
5. **各境界**：lock前後、backup後install直前、install後、restore前にidentity/所属/排他再検証。bounded observerはcoverage喪失/新起動/対象入替を固定分類として失敗にする。
6. **復元**：失敗prefixを退避、verified full software/dependenciesだけを復元。stable data/auth/scope/claims/receipt/queue/report/古いPID/token/lockは復元しない。runtime出現や対象入替なら復元せず証拠とlockを保持。成功後も停止したまま、再起動は別承認。

最初のupdate受入は隔離clone/prefix・dummy data・実local process/競合launcher・実archive/dependenciesで行う。通常終了成功→offline update→停止維持、未知/残留/再起動/競合/観測拒否→書込み前拒否、partial install/verify failure→softwareのみ復元、復元中再起動→復元拒否を測定する。これは本番archive/prefix/保守契約の受入ではなく、最後に対象本番で別確認が要る。

## Decisions / no silent relaxation

| 本人が決めること | 推奨と、未承認なら止まる点 |
| --- | --- |
| 最初の成果 | 新read-only transport C1。操作も同時完成が必要なら隔離選定から先に進めるため、最短ではなくなる |
| Dotsの実製品/版 | 非秘密の名称/版/metadata方式だけ提示。URL/キー/会話/既存dataを貼らない。互換性が不明なら実接続せずisolated probeの案まで |
| local-only本人管理を維持するか | Aの小さなowner broker実証を優先。Bを選ぶならremote管理への要件変更と固定owner識別の承認が必要 |
| worker方式 | AppContainer候補のdummy Windows実証→互換不可なら専用SID/VMを再選定。勝手に同一SID無隔離へfallbackしない |
| 保守期間の信頼 | U1の本人行動/起動元を信頼する限定契約を受け入れるか、U2の予防制御が必要か。どちらもunknownを安全と見なさない |
| 実操作の承認 | account/ACL/credential/network/sandbox設定、接続/grant、本番stop/install/start、provider費用は別々に対象/影響を示す。計画承認は運用承認ではない |

読取りだけ先に完成させても、C5未達は明示します。「危険を受容」とだけ書いて現scope不変要件を削除したり、本人確認checkboxでcontrolを開けたりしません。将来の配布/複数利用者は今回実装しません。

## Primary sources

外部読取りは一次資料だけ。以下は公開仕様/製品能力の根拠であり、対象PCで設定済み・実Dotsで合格した証拠ではありません。仕様latestの移動URLとversion固定URLを区別しました。

- **[P1]** OpenAI official tunnel-client v0.0.15 configuration（pin済み前提、header/env参照・forwarded override・Streamable HTTP）：https://github.com/openai/tunnel-client/blob/v0.0.15/docs/configuration.md
- **[P2]** 同版connector経路/notification/readyの説明：https://github.com/openai/tunnel-client/blob/v0.0.15/docs/connectors.md
- **[P3]** MCP latest versioning（調査時modern=2026-07-28、legacy区分）：https://modelcontextprotocol.io/specification/latest/basic/lifecycle
- **[P4]** MCP 2026-07-28 HTTP/header検証/error契約：https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- **[P5]** 同版per-request metadataと必須discovery：https://modelcontextprotocol.io/specification/2026-07-28/basic/index / https://modelcontextprotocol.io/specification/2026-07-28/server/discover
- **[P6]** MCP 2025-06-18 transport/lifecycle：https://modelcontextprotocol.io/specification/2025-06-18/basic/transports / https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle
- **[P7]** Cloudflare公式JWT署名/issuer/audience検証：https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- **[P8]** Microsoft AppContainer resource/credential/process隔離：https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation
- **[P9]** Microsoft launch/token/capability/profile/DACL：https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer
- **[P10]** Microsoft Windows Sandbox設定（network/clipboard/共有folderの既定と危険）：https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file
- **[P11]** Microsoft Job Objects（子process・breakaway・WMI・寿命、別途security）：https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects

source参照：[Access gate](../server/access.ts)、[index/route順序](../server/index.ts)、[permissions/native/owner gate](../server/dots-permissions-api.ts)、[scope保存](../server/workspace-permissions.ts)、[worker入場](../server/runtime/manager.ts)、[owner env継承](../server/adapters/pi/process.ts)、[manager lock/identity](../package/server-manager.mjs)、[stopped-update engine](../package/stopped-update.mjs)、[実read-only診断](../package/stopped-update-diagnostics.mjs)。
