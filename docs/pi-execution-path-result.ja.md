# Pi execution path investigation

## Result

**Bashだけを制限しても、PowerShell、Nodeのfs/network/child_process、拡張、認証command、server側orchestratorは残る。** 最小候補は、既存プログラムを再インストールせず読取実行で使い、**Pi/SDKをロードするNodeから子孫までを別の低権限実行域へ置く**こと。Consoleのprivileged管理面は外に残すが、その代理アクセスとserver発の別Pi起動も同時に扱う必要がある。現物は通常spawnで、これらのOS強制境界が成立している証拠はない。

本調査はsource/metadataのみ。稼働entry・SID/token・実効Access・有効extension/MCP登録・現在の背景jobは未確定。既存SDK proofを再利用し、攻撃・新model・sandbox試験はしない。

## Evidence scope

先に `dots-startup-identity-addendum.ja.md`、`dots-live-final-preflight.ja.md`、`dots-agent-session-result.ja.md` を読み直した。acceptance-5とAgentSession proof-3は隔離fixtureの証拠としてだけ継承する。実Dots/実稼働/OS隔離のPASSへ拡張しない。

以下の略記は**disk上のsource root**であり、PIDのロード元ではない。

- `R`: `D:\Develop\pi-console` (manifest 0.5.1、working tree)
- `P6`: `C:\Users\leade\.pi\agent\pi-console\reviewed-releases\0.6.0\node_modules\@ludi-uni\pi-console` (0.6.0、Startup WD候補)
- `P4`: `C:\Users\leade\.pi\agent\npm\node_modules\@ludi-uni\pi-console` (0.4.3、package extension宣言候補)
- `SDK`: `C:\Users\leade\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent` (1.0.2)。`SDK/dist/…` と表記する。内包pi-ai/pi-mcp/pi-codemodeもmanifest 1.0.2。
- `SUB`: `C:\Users\leade\.pi\agent\npm\node_modules\pi-subagents` (0.76.1)
- `MCP`: 同npm領域の `pi-mcp-adapter` (5.1.0)
- `KIT`: 同npm領域の `@ludi-uni\ludi-agent-kit` (0.1.3)
- `WEB`: 同npm領域の `pi-web-access` (0.37.0)

**観測:** これらpackageのmanifest/sourceが存在。Mainの `PI_PROVIDER=openai-codex`, `PI_MODEL=gpt-6.1-sol` は維持。tool宣言にはMCP/subagents/orchestrator/web gatewayが提示されている。ただし宣言やpackage存在はConsole workerへの有効登録、接続成功、背景run存在を証明しない。設定ファイルは読んでいない。

前回実測のStartup WD=P6、npm候補=P4、listener PID 68540との結び付き無し、Access不明をそのまま継承。今回listenerやshortcutを再取得しない。

## Diagram

```text
人のUI / MCP client
  ├─ UI POST /api/prompt ── Console server S
  │                         ├─ receipt / follow-up queue (server fs)
  │                         └─ RuntimeManager.open/prompt/drain
  │                             └─ PiProcess spawn + stdin/stdout
  │                                 ├─ R/P6: Node sdk-worker W
  │                                 │   └─ services/resource loader → AgentSession
  │                                 └─ P4: Node Pi CLI --mode rpc W
  │                                     └─ CLI/SDK対応は選択installation依存・未試験
  │
  ├─ MCP read/status/final → server projection/store → JSON (原則worker起動なし)
  ├─ MCP control → admission/receipt → runtime.prompt/stop [Rは隔離未確認で拒否]
  └─ UI /api/orchestrator/start → S内KIT API → 別Pi CLI X [Wの兄弟側]

AgentSession [W、又はforeground childなら同じNode内]
  ├─ provider request/credential refresh → 外部service → text/toolCall
  ├─ tool_call hook → builtin/custom execute
  │    ├─ read/write/edit/ls → Node fs
  │    ├─ grep/find → Node fs + rg/fd child
  │    ├─ bash/PowerShell → shell child → Node/Python/任意の子孫
  │    ├─ codemode QuickJS → ctx.executeTool → 同hook → 上記
  │    │                    └─ models API → provider [個別tool hookとは別]
  │    ├─ MCP → local subprocess M / 既存socket・remote service
  │    └─ subagents → foreground同process / background runner A / external CLI
  └─ extension load/command/hook/provider callback/auth command/session保存
       → 直接 fs/network/child_process [通常tool_callの外側]

tool結果 / SDK events / text
  → SDK toolResult・session JSONL保存
  → W stdout record → PiProcess → SessionEvents → UI state/SSE/HTTP戻り値
finalだけ: SDK settled保存証明 → server journal → ACK+completed+grant fences
         → final read MCP（Rの通常bootstrapはOFF）
background: runnerの結果/artifact/通知 → parentへ戻る（foreground完了とは別）
```

UIの送信入口は `R/web/main.tsx:345,378,384-413`、server受付は `R/server/index.ts:155-165`。`/api/session/options` は `RuntimeManager.options():266` からopenを呼ぶため「GETだからworkerは起動しない」とは限らない。一方snapshot/eventsは既存entryを要求 (`manager.ts:704-718`)。MCPの受動read契約と一般UI APIを混同しない。

## Routes

`O`=今回又は先行の観測、`C`=読んだsource上の経路、`U`=実稼働未確認。process略記: `S` server、`W` SDK/CLI worker又はstandalone Pi、`A` background runner、`M` local MCP server、`X`別CLI、`Remote`外部service。

**OS主体:** 下記S/W/A/M/Xの実SID・integrity・privilegesは全てU。sourceの通常spawnはcallerの権限を継承する形で、別token指定は見つからない。thread/in-process Sessionは親と同じOS主体。Remoteの主体は別でU。`F/N/Cp`=fs/network/child_process能力（対象内容・OS権限次第）。「全worker」はWのNode、thread、local子孫、背景runnerまでOS強制下に置いた**候補**を意味し、今の実装にその保証があるという意味ではない。

| 経路 / 根拠（版は上記root） | 区分・実行主体 / 能力・戻り値 | 既存承認/制限とOS強制の区別 | Bashだけの外側 / 全workerで収容 |
|---|---|---|---|
| UI prompt/queue: R `server/index.ts:155-165`, `runtime/manager.ts:590-670`, `queue-store.ts` | C; Sがqueue fsへ保存、Wへdispatch。ACK/run ID→HTTP、events→UI | Host/Origin/Access、receipt、FIFO/held/CAS。OS sandboxではない | 外側。Sのstore/APIは全worker外 |
| MCP instruction/control: R `dots-permissions-api.ts:31-37,90-129,164`, `manager.ts:42,55` | C; S→W。request state/run ID | key/scope/expiry/admission。`controlIsolationVerified()`はfalse、実制御を許可しない。OS制限未確認 | 外側。受付はS、起動後のWだけ収容可能 |
| MCP readonly/final: R `readonly-mcp.ts:278`, `final-answer-mcp.ts:48`, `final-owner-composition.ts:22-33` | C+先行fixture O; Sの受動projection/journal→JSON。F、応答network | native/auth/exact target/expiry/epoch、通常final OFF。OS主体分離ではない | 外側。Sが返せる範囲の管理gateは別途必要 |
| R/P6 worker起動: `server/adapters/pi/process.ts:65-76`, R `sdk-worker.mjs:189-212` / P6 `:156-180` | C、R経路は先行SDK fixture O; S→Node W。SDK import・AgentSession・IPC | generation/size/ready/SDK exports、final用1.0.2確認。通常env継承、別token/Jobなし | 外側。**Node起動前から**制限すればW内処理を対象にできる |
| P4 legacy: `server/adapters/pi/process.ts:73-75` | C; `node PiCLI --mode rpc --extension …`。sdk-workerなし | CLI/RPC互換と選択SDKはU。CLI path override/探索。env指定なし＝通常継承 | 外側。同じOS境界でCLI全体を対象。R/P6のSDK proofを転用しない |
| SDK普通tool: `core/agent-session.js:305-400`, `extensions/wrapper.js:9-20` | C; W、custom execute callback→toolResult/events | tool_call handlerがあればblock/errorで止まる、無ければ通る。毎callの標準本人承認はない。hook≠OS制限 | Bash限定では他toolが残る。W全体ならlocal能力を制限できる |
| read/write/edit: SDK `tools/read.js:19-69`, `write.js:16-47`, `edit.js:38-41,94-126`, `path-utils.js:37-44` | C; W内Node F。text/images/result | access/schema/差分/出力量・mutation queue。絶対path/~を解決、cwdはアクセス境界でない | 残る。全WのACL等でFを制限。operations差替えは任意JS全体の境界にならない |
| search/ls: SDK `tools/grep.js:25-27,52,101`, `find.js:65-68,161`, `ls.js:17-20,56` | C; WのF、rg/fd child Cp→matches/listing | tool hook、引数/出力制限。shellを通らずspawnもある | 残る。W+local子孫で収容。search backend/downloadも含める |
| Bash: SDK `tools/bash.js:47-119,133-180` | C; W→shell→任意子孫 F/N/Cp、stdout/stderr/code | tool hook、任意spawnHook/operations、timeout/abort。command文字列の許可はOS境界でない | 対象になり得るがBash自身の全子孫まで必要。全Wで収容可能条件付き |
| PowerShell: SDK `tools/powershell.js:9-28`, `utils/shell.js:103-126` | C; W→pwsh/powershell→子孫 F/N/Cp | 同じshell operationsを別shellで使用。NoProfile/ExecutionPolicy Bypassはsandboxではない | **Bashだけでは残る。** 全W+子孫で収容 |
| Node/Python: 上記shell、SDK `core/exec.js:10-16`、extension imports | C; shell子孫又はW内Node、F/N/Cp。stdout/structured result | Python/Node用の独立標準承認ではなく入口tool次第。Node内fsはshell不要 | 残る。Node W自身と実行されたPython子孫をまとめて収容。別サービスへ依頼なら対象外 |
| user `!` / executeBash / pi.exec: SDK `agent-session.js:3058-3066`, `extensions/loader.js:326`, `core/exec.js:10-41` | C; W→shell/直接spawn、F/N/Cp→bash result/stdout | user_bash側hookとmodel tool_callは別。pi.execは通常toolとしての承認を必ず経るAPIではない。R worker command switchにbash RPCは公開していない | 残る。standalone Piも同じ実行域に置く必要 |
| extension load/command/hooks/custom tools: SDK `resource-loader.js:350-561`, `extensions/loader.js:215-248,468-481` | C; W内jiti/import/factory/handler。F/N/Cp、任意return/emit | project trust/filtersでload選択、tool executeだけは通常hook。load時・slash command・event handlerの直接APIはhook外 | 残る。loadより前のW全体境界が必要。host Pi内のextensionは別に残る |
| skill/prompt/context: SDK `resource-loader.js`, `docs/security.md` | O=skill宣言、C=内容がpromptへ。読むのはW F、実行は誘導された上記経路 | project trustは一部discoveryにだけ適用、contextはtrust外にもload。指示遵守≠OS強制 | 残る。読取skillsは再利用可、参照script/外部toolの実行先は個別判定 |
| codemode JS: SDK `extensions/codemode/execute.js:18-23,288-324`, `core/agent-session.js:372-400` | C; QuickJS sandbox+threadはWと同じOS主体。tools bridge→nested結果 | VM内にNode/fs/networkなし、256MiB等の制限。`ctx.executeTool()`のnested callは同hookを通る（bypass扱いしない） | Bash以外のtoolsが残る。JS sandboxはW/provider/bridgeのOS境界ではない。全W側でlocal処理を収容 |
| codemode models/provider callback: SDK `extensions/codemode/execute.js:463-529`, `core/model-runtime.js:489-513,626` | C; Wのnative provider callback→network又は独自F/Cp→model結果 | outer codemodeはtool、classify/imagesの個別呼出しはtool_callでない。custom providerの任意JSも通常tool承認外 | 残る。local callbackは全W対象、remote側実行権限は対象外 |
| openai-codex: SDK内pi-ai `providers/openai-codex.js:1-19`, `api/openai-codex-responses.js:178-198` | O=Main model名、C=HTTP/WS provider stream。選択された実moduleはU | SDK providerとCodex CLIは別。API toolCallをlocal pipelineへ返す。model名からCodex OS sandboxを推測しない | 残るnetwork。全Wのegress対象、provider側actionsは別主体・未確認 |
| SDK保存/認証/discovery: SDK `core/agent-session-services.js:53-69`, `session-manager.js:760-812`, `auth-storage.js:19-66`, `resolve-config-value.js:64-66,130-185` | C+保存のみ先行fixture O; W F/N/Cp。JSONL、auth refresh、`!`設定command→解決値 | session/lock/設定処理。通常tool_call前後と関係なく行う。今回auth/config実体は読まない | 残る。全W内に専用writable stateと限定認証が必要 |
| helper取得/欠落package: SDK `utils/tools-manager.js:67-90,228,300-322`, `core/package-manager.js:1014-1046` | C; W F/N/Cp、rg/fd取得やpackage解決 | offline/trust/configで抑制する機能。OS強制でない。今回はinstall/ensure関数を呼ばない | 残る。全W対象、immutable code reuseとwritable cacheの区別が必要 |
| SDK native MCP local: SDK `extensions/mcp/runtime.js:51-70`, pi-mcp `transports/stdio.js:73-91` | C; W→M F/N/Cp、JSON-RPC result。config env＋通常parent env継承 | MCP tool hookが適用。**接続/起動/認証処理はtool承認だけの境界ではない**。transport closeにtree cleanup試行 | 残る。W起動のlocal Mを同じOS域へ入れれば条件付き収容。共有daemonは別 |
| SDK MCP remote: 同 `runtime.js:54-60,188-189,384-390` | C; W N→Remote、JSON-RPC result | 接続/auth/timeout/tool hook。request abort/closeはremote副作用の取消保証でない | 残る。Wの接続権限は制限可、remoteのfs/processは収容不可 |
| pi-mcp-adapter local/remote/socket/embedding: MCP `server-manager.ts:1145-1212`, `host-managed.ts:85-102` | O=package/宣言、C=Node host→M/Remote/外部embedding app。F/N/Cp | approval/consentを持つが実設定U。inheritEnv既定ON、host-managedは接続所有者が外側になる場合あり。native SDK MCPと同一実装ではない | 残る。local childのみ条件付き収容、既存socket/server/embedding ownerは全W外 |
| MCP auth helpers: MCP `bearer-command-resolver.ts:23-34`, `request-headers-command.ts:178-198` | C; host Node→command、F/N/Cp→header/bearer値 | auth/configの処理、通常Pi tool_callと別。実設定・実行有無U | 残る。W内起動なら収容、host-side gatewayならそのhostも対象にする必要 |
| foreground subagent: SUB `runs/shared/child-session.js:10-17,45-75,131-138`, `foreground/execution.js:267-281` | O=package、C=**親Node内AgentSession**。F/N/Cp→子events/result | child tools/能力ceiling/provider継承等。tools allowlistはin-process OS権限を分離しない | 残る。親Wを制限すれば同域。ただしchild相互/親の秘密分離には別process/主体が必要 |
| background/schedule/provider job: SUB `background/async-execution.js:462-490,617`, `shared/background-process-options.js:1-5`, `extension/index.js:44,1087-1097` | C; A別process＋A内AgentSession、又は登録providerの外部job。F/N/Cp、state/artifact/通知 | envは一部削除後に親を広く継承。Windowsはdetached=falseだがunref/別runner。auto-drain/stop/resumeは運用制御でOS lifetime保証でない | 残る。AをJob等に含める必要。Remote/provider job、別machineは全W外 |
| subagent workflow/host command/external CLI: SUB `workflows/scripted-workflow.js:984-1000`, `host-command.js:133-165`, `shared/external-cli-runner.js:43-61,101-115` | C; Node thread/VM→runner host shell/X。F/N/Cp→output/receipt | raw workflowにはhost権限なし等のgrant制限。node:vm/JS機能制限はOS境界でない。許可されたruns.hostは通常bash toolを経ずshell spawn | 残る。同OS域のrunner/thread/Xなら収容。remote runnerは別 |
| Console orchestrator: R `adapters/orchestrator/start.ts:23-26,39-44,62-77`, KIT `adapters/pi/lib/invoke.mjs:30-45`, `subagent.mjs:53-76,123-129` | C; **S内KIT import→X（Wの子ではない）**。F/N/Cp、report→Piへ再送 | decision/budget/tool allowlist、no-tools/no-approve/apply:false等はOS隔離でない。tool-capable子はextension discovery ON | 残る。**sdk-workerだけの全制限では不可**。S発のagent runnerも同実行域へroutingするadapter変更が必要 |
| server管理・filesystem・Explorer・Startup: R `server/index.ts:124-145`, `runtime/explorer.ts:6-12`, `package/server-manager.mjs:181-190`, `startup-manager.mjs:35-47` | C; S又はhost Pi→F/Cp/N。Explorerはdetached/unref。HTTP結果/起動metadata | scope/path/Host/Origin/HMAC等は用途別。一般local APIをworkerが代理利用できる不足は前preflight通り | 全て外側。S/host Piは全W外。OS隔離とowner管理gate/公開面の最小化が両方必要 |

## Lifetime

- **prompt stop ≠ worker終了:** R `manager.ts:687-701` はqueueをpause→clear_queue→abort。SDK `agent-session.js:1873-1884` はagent/compaction/retryをabortしてidle待ち。既実行fs変更/外部副作用は戻さず、任意extensionの独立jobを全て停止するコードではない。
- **queue resume:** `manager.ts:682-685` の明示resume。復元された不確実queueはheld、成功済み再送を避ける。queueが空/foreground settledはOS子孫ゼロの証明ではない。
- **close/server shutdown:** R `PiProcess.close():185-201` はstdin EOF→3.5秒後direct child kill。worker `sdk-worker.mjs:60-69` はabort/runtime.dispose、3秒deadline。`manager.ts:776-782` はactive worker closeとpoller/drainer停止。server側KIT jobや任意の兄弟/remote jobを列挙し全終了する仕組みではない。
- **shell/MCP child:** SDK shellはabort/timeoutでWindows System32 taskkill /Tを試みる (`utils/shell.js:157-174`)。native MCPもtransport closeにtree kill試行。実Windowsで残存ゼロを測っていない。SDK pi.execはdirect proc killで、同じtree制御ではない (`core/exec.js:21-32`)。
- **subagent:** session_shutdownは `disposeChildSessions()` に加え、workflow continuationのabort、scheduler停止、watcher/tracker等のcleanupを行う (`SUB/src/extension/index.js:925-963,1087-1097`)。背景runnerは別所有・永続state/再開ルートを持ち、このcleanupを全背景OS process/remote jobの終了証明とは扱わない。Windows owned-process-treeはPOSIX group確認を使えず `unknown/unsupported-platform` (`…/owned-process-tree.js:83-92`)。外部CLI側はtaskkill試行もあるが、その後の全子孫終了をOS境界として受入済みではない。
- **restart/reload:** reloadはmodule cacheやOS権限を新しくする操作ではない。SUB `index.js:8-12` 自体がloaded/installed version差でrestartを要求する。新serverが旧managed PIDを再利用する問題も継承。新起動の境界を作っても旧worker/背景job/standalone Piは自動収容されない。

## Credentials

値・実file内容を調べず、**sourceの受渡し**だけを追った。

| 境界 | source上の流れ / 注意 |
|---|---|
| host Pi/Startup→server | R `environment.mjs:8-16` のstable .env＋明示env優先、manager `:181-190` が管理tokenをenvで渡す。今回loader/statusを実行しない |
| server→R/P6 worker | `PiProcess:75-76` はprocess.env全体＋SDK package-root hint。P4もenv指定なしで通常継承。session dir/cwd/source pathをargvで渡すコードだが実argvは取得しない |
| worker→shell | SDK `getShellEnv():116-126` はprocess.envをcopy。`bash.js:133-158` のsession/model変数整理は他秘密の削除ではない |
| worker→SDK auth/resources | agentDirのauth/models/settings/resource discovery (`agent-session-services.js:53-69`)。auth command、OAuth refresh、custom provider codeは通常tool hookの前/外でも処理可能 |
| worker→MCP | native transportはparent env＋config env。pluginもinheritEnv!==false。header/auth commandの結果はclient側秘密になる。接続数・認証方式・実serverはU |
| worker→foreground child / background runner | foregroundは同processでprovider objectと一時process envも継承。背景runnerは除外項目以外の親envをcopy。モデル/extension filteringとsecret隔離は別 |
| server→KIT child | invoker/subagentともprocess env継承、Pi自身のauthを利用。no-tools/no-sessionはauth/extension/独立Node処理のOS禁止ではない |
| worker→server管理領域 | local HTTPをnative Node/shellから呼ぶ経路、same-SID fs accessの可能性。header再現問題は前preflight参照。ACL/token未調査なので成功を断定しない。MCP read-keyとowner管理認証を混同しない |

provider認証をW内へ渡せば、同じNodeの任意extension/toolはその値・auth resolver結果へ触れる能力を持つ。全WのOS制限はhost保護になるが、W内の秘密をWから隠す仕組みではない。既存auth.jsonを丸ごと読取共有して安全性が上がる、としない。provider別の短期/scope限定認証や外側の認証仲介が必要かは別判断で、今回は新brokerを設計/実装しない。

## Reuse and options

### Candidate A

**推奨候補: Windows上の低権限実行主体＋全agent process familyのOS強制域。** owner Console/browser/管理storeは外、Pi/SDKのNodeと任意拡張・local tool・MCP subprocess・背景runner・server発agent runnerは内。standalone Piでmodel/任意toolを動かす入口も同域へ置く。現在のMainをowner権限のまま使えば別の無制限agent入口が残る。

- 再利用見込み: 既存Node、SDK/JS依存、公開extension/skill source、選択したNode/Python runtimeをimmutable読取実行にし、専用workspace/session/agent state/cacheだけwritableにする。元の人用環境を削除・再インストールする必然性はsource上ない。
- 必要な別作業: 別token/非管理者SID、owner管理資源への拒否、network（localhost含む）制限、子孫lifetimeのWindows Job等。Jobだけではfs/networkを制限しない。既存stdio protocolを保持した `PiProcess` launcher、KITの別spawn、背景runnerの境界への配置が必要。KITの実行callbackをS内へ残したままspawnだけ包んで完了とはしない。trusted管理/store部分とagent runnerの切分けも必要。単なるexec名allowlistやJS monkey patchでは代替できない。
- serverの一般API/管理HTTPはhost側の代理能力。前回提案のworkerが取得できない管理認証/対象面の保護を依存条件として残す。これなしにworker SIDだけ分けても十分とはしない。
- 既存code rootにstateを同居させる拡張は、writable state locationを分けられるか確認が必要。KITの `.orchestration`/activityのsource-relative stateも例 (`R/adapters/orchestrator/source.ts:25-29,62`)。home全体を共有せず、選択source/resourceだけを再利用する。
- 現時点ではtoken起動/Job/network制限adapterは未実装・未検証。現processへhot適用可能、GUI/認証がそのまま動く、という結論にはしない。

### Candidate B

**代替一案: Pi/SDK/agent execution plane全体をWindows互換のVM等へ移す。** Node/Python/SDK/拡張を可能な限り既存artifactから再利用し、hostは限定した入力/結果・管理だけを担当する。全extensionsも内へ置き、read-write host mount/共有認証/無制限networkは与えない。既存の外部MCP/GUI/GPUサービスを接続すれば、それはVM外の能力として別制限が必要。

これは境界をまとめやすいが、VM基盤・Windows runtime/Store alias・DLL・license・GUI session/GPU・provider OAuthの移行可否は未確認で、無再インストールを保証できない。導入/購入/設定は今回は行わない。SDK `docs/security.md` / `containerization.md` も全Pi隔離とtool-only隔離を区別する。Docker/OpenShell/GondolinがこのWindows環境で利用可能とは調べておらず、Bashだけ/組込みtoolだけの委譲を同等代替としない。

### Codex distinction

SUBには `codex-exec` adapter sourceが存在 (`src/runs/shared/codex-exec-adapter.js:88-121`)。read-only/workspace-write、env allowlist、版/help preflightを指定する。これは**対応sourceがあるだけ**で、Codex CLIの導入・認証・Windows sandbox成立は確認していない。Piのopenai-codex SDK providerはHTTP/WS経路であり、Codex CLI sandboxがPi全体に適用されることはない。「filesystem write範囲/network/approval/子孫を分ける」という設計観点だけ参考にできる。

## Unknown

追加判断に必要なのは次の限定項目。秘密・全設定・コマンドラインの取得では埋めない。

1. 起動済みS/Wとsource prefix/build、Pi CLI/SDK選択、実OS tokenの非秘密identity。有効pi-console source一項目は前回から未確認。P4は旧CLI RPC、P6/RはSDKなので制限launcher対象が異なる。
2. 読取実行として再利用する具体runtime。今回Get-Command metadataでNode/PowerShell/pwsh/bash候補は見つかったが、bashにはWSL/WindowsApps entry、PythonはWindowsApps aliasだった。Python実runtime・venv/SDK DLL・WSL distributionの存在/権限/稼働は証明していない。元runtime version/起動試験は未実施。
3. 有効extension/providerの**source名・root・実行placementだけ**、MCPのlocal/remote/共有server区分、背景/外部machine jobの所有者。package一覧やtool宣言だけでは設定/接続成功を判断できない。個人config全文やtoken/profileを取得しない。
4. WindowsGUIは別SID/desktop/sessionの入力・画面・clipboard・COM・Explorer/MCP依頼、GPUはdriver/device/model backend access。providerごとの認証はAPI key/OAuth/Windows credential store/外部helper・更新先network。どれも継承・動作可能とは未確認。
5. OSのfile/process/network拒否と子孫/背景jobの生存を実証する最小受入は別承認。現在のsource/read/隔離fixture PASSから、このOS受入を済ませたとしない。

## Preservation

新しい調査文書と保全記録だけ。着手前319ファイル・staged stateを保全。製品default OFF、controlIsolationVerified=false、先行証拠・未commit workを変更しない。secret file/.env/profile/history/log、環境一括dump、process command line、CLI statusを取得しない。実credential/履歴/接続/キー/grant、OS/ACL/firewall/account/VM/sandbox、install/build/model試験、停止再起動、commit/push/公開なし。新subagent/job/fixture Tempを作らず、実稼働processを操作しない。調査中の存在しない旧path検索は実在sourceへ訂正しただけで、試験やsource修正ではない。
