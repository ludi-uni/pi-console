# 停止中更新・Dots対象別権限：実装と隔離検証の結果

## Summary

2026-10-07、`D:\Develop\pi-console` / `main` / HEAD `6497049`、`openai-codex/gpt-6.1-sol` で作業しました。子作業も同モデルをruntime表示で確認し、書き込みを直列化しました。

**実装・隔離検証・README/操作手順の更新は実施しましたが、実運用の受入は部分完了です。** 本番更新の実行と、現行ワーカーでのDots操作は保証不足のため拒否を維持します。GUI・scope保存・読み取り・操作コアの隔離合格を、本番適用や実Dots接続の合格には置き換えません。

最終検証は **91件合格、失敗0、skip0**（更新39件＋権限/receipt/readonly31件＋既存SDKの限定4件＋queue17件）。型検査・別出力先buildも成功しました。

本番適用・停止・再起動、実際のDots許可変更、実キー生成/入力、接続変更、Events有効化/購読/外部配信、HOLD fixture/その制御試験、stage/commit/push/npm公開は行っていません。依存追加・インストール・バージョン変更もありません。

## Changes

### 停止中更新

- `scripts/stopped-update.mjs --check`：固定対象の起動元/OS inventoryとcanonical filesystem metadataを、秘密・state/token/設定内容を読まずに診断します。public identityは明示portの指定がある場合のみで、今回は本番portへ接続しませんでした。
- `package/stopped-update.mjs`：既存の停止中更新コアを限定移植。対象identity、停止観測、管理外起動排他、manager互換wx lock、固定候補hash/manifest、backup/install/verify/restoreの順序を保持します。
- `package/stopped-update-prefix.mjs`：依存・空directoryを含むsoftware prefix全体のbackup/hash照合、partial prefix退避とsoftware-only復元。stable data/auth/scope/claims/receipt/queue/report、古いPID/state/token/lockを戻しません。新しいpermission/receiptの保存名もprefixへ混入したらbackup/restore前に拒否します。
- 親レビューで、entryの原子的置換やpartial installによるentry消失が誤って対象入替と扱われる不具合を隔離再現し修正しました。install前はentry identityも照合し、install後/復元前はdataDir/prefix identityとentryの位置を照合します。link/junctionやprefix入替、runtime出現は引き続き拒否します。
- `--apply` は対象/lock/archive/networkへアクセスする前に拒否します。force/mock切替・lock奪取・停止/起動経路・大きな受付停止機構は追加していません。

### Dotsの対象別権限

- `server/workspace-permissions.ts`、`shared/workspace-permissions.ts`：default none、登録ID/canonical path/観測session/generationの明示scope、atomic保存/fsync/revision CAS、request admissionと解除の排他。破損・保存不明・crashはfail-closedです。
- `server/dots-permissions-api.ts`、`web/WorkspacePermissions.tsx`、`web/SettingsPage.tsx`：本人ローカルGUIで個別の複数選択、read/control、対象と解除内容のreview、本人confirm、保存/解除。未登録・未観測・曖昧・scan不完全は拒否します。全体許可/select-all/未登録path追加/自動approval/包括trustは追加していません。
- 新endpointは `/mcp/dots`。最新scope/instance/revision/path/session/generationを毎回再検証します。操作コアはPi指示のstaging→明示start→exact active run stopのみ。既存PromptReceiptsのclaim-before-dispatchを再利用し、古いscope/generation/receiptや不明ACKで再実行しません。
- `server/runtime/control-target.ts`、`server/runtime/manager.ts`、`package/sdk-worker.mjs`：観測済みworkerだけを対象に、queue/approval/kit/background、SDK1.0.2のidle/preflight/deferred callback、期限、exact-run clear_queue/abortを検証します。通常Consoleのqueue/trust/dialogは維持しています。
- readonlyキーを操作用に転用しません。controlには別の専用credentialが必須ですが、**専用キーとscopeだけでも本番操作は許可しません**。

## Safety boundary / acceptance blockers

1. **停止中更新**：manager/Startup/CLIは同じdataDirのlockへ参加しますが、直接起動、別dataDir、外部npm/watchdog/間接wrapperを排他できません。完全な所属process観測と保守排他、実archive/install検証adapter、私有backup配置の受入は未完了です。本人の通常終了やcheckbox、空きportだけでは解除しません。診断は利用できますが、実更新を最小操作で完了する目標はまだ未達です。
2. **Dotsの操作**：通常Piワーカーは本人と同じOSユーザーでtoolsを実行でき、permissionファイルの書き換えや本人APIへのlocal HTTPを指示できる可能性があります。これは「Dotsから自分でscope拡張不可」を保証するsandboxではありません。`RuntimeManager.controlIsolationVerified()` は現行では常にfalse、実native操作は `worker_isolation_unverified` で拒否します。環境flag・キー設定・本人checkboxによる解除はありません。OS/toolアクセスを持たないdummy runtimeでの操作試験は、本番ワーカー隔離の証拠ではありません。
3. **本人GUIとAccess構成**：既存Host/Cloudflare Access gateは維持しています。Access有効構成では既存gateがpublic Hostだけを許可する一方、owner APIはliteral loopback Hostを要求するため、現行では双方を通る保存要求が成立しません。gateを迂回・緩和していません。本人識別とlocal管理経路の認証設計・受入が必要です。標準loopback構成のGUIは隔離検証済みです。
4. **実Dots transport**：新endpointは限定sessionless JSON-RPC/2025-06-18 initialize契約です。現行/最新Dots clientとの接続・protocol metadata/handshake互換性は未検証・未受入で、既存接続を切り替えていません。
5. **旧権限は独立**：GUIの解除は新 `/mcp/dots` のscopeだけです。既存 `/mcp/readonly` の固定scopeを移行・拡張・解除しません。旧endpointの読み取り許可も解除できたと解釈しないでください。

Orchestrator開始・approval/slash/独立したqueue/background制御、SDK1.0.2以外のnative startは非対応です。これらを自動的に別経路へ送るfallbackはありません。

## Verification

すべてのテスト実行childはlive credential/environmentを継承しないallowlistと専用Temp/profileを使用。HTTP/browserはdynamic loopbackとdummy runtime、browser外部requestは拒否しました。既存distは上書きしていません。

| 最終チェック | 結果 | 証拠の範囲 |
| --- | --- | --- |
| `node --test tests/stopped-update.test.mjs tests/stopped-update-safety.test.mjs` | 39/39、exit0、fail/skip0 | 対象入替・不完全観測・競合lock・backup失敗・partial install/復元・runtime出現・stable保全・canonical診断拒否。install/完全process観測はmock契約 |
| 下記permission/SDK/browser/receipt/readonly command | 31/31、exit0、fail/skip0 | 複数scope、解除/切替/restart、旧binding、CAS/in-flight、保存失敗/ACK不明、専用auth、ワーカー未隔離拒否、SDKの実prompt prototype＋dummy dependencies、desktop/mobile実HTTP GUI |
| SDK worker限定回帰（下記patternの4項目） | 4/4、exit0、fail/skip0 | 通常workerのdiscovery/巨大payload/ACK/abort後方互換。real SDK smoke/trust fixtureはpattern対象外、未実行 |
| `node --import tsx --test tests/prompt-queue.test.ts` | 17/17、exit0、fail/skip0 | FIFO、stop/Resume、永続化失敗、restart、既存queue挙動 |
| `node node_modules/typescript/bin/tsc --noEmit` | exit0 | 最終TS/UI source |
| Vite `build({configFile:false,envFile:false,...})` | exit0、312 modules、1.63秒 | 最終Web source。large chunk warningのみ。別Temp出力 |
| `git diff --check` / `git diff --cached --name-only` | whitespaceエラーなし / stagedなし | CRLF変換警告のみ |

SDKの限定回帰は次のcommandで行いました。real SDK smoke/trust fixtureは対象に含めません。

```powershell
node --import tsx --test --test-name-pattern="^(SDK resolver|SDK worker exports|SDK worker transfers|preflight rejects)" tests/sdk-worker.test.ts
```

permission専用commandは、既存の非秘密SDKコードとインストール済みChromiumを明示しました。実model/provider/auth factoryは呼びません。

```powershell
# child環境は別途allowlist＋専用Temp/profileへsanitizeする
$env:DOTS_TEST_BROWSER_EXECUTABLE='C:\Users\leade\AppData\Local\ms-playwright\chromium-1223\chrome-win64\chrome.exe'
$env:DOTS_TEST_SDK_SOURCE='C:\Users\leade\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\dist\core\agent-session.js'
node --import tsx --test tests/workspace-permissions.test.ts tests/workspace-permissions-native.test.ts tests/workspace-permissions-sdk-contract.test.ts tests/workspace-permissions-browser.test.ts tests/prompt-receipts.test.ts tests/readonly-mcp.test.ts tests/readonly-mcp-scope.test.ts
```

最終build出力：`C:\Users\leade\AppData\Local\Temp\dots-parent-final-aOnJKP\dist`。上記テスト→tsc→buildはsanitizeしたchildで実行し、Viteのconfig/env file読み取りと既存distへの書き込みを無効にしました。全体 `npm test` / `test:real` / 本番stop/install/restoreは実行していません。

GUIはdesktop1280/mobile390の選択、review、未confirm保存拒否、cancel、section/mobile戻り、保存、応答喪失後のrefresh、restart後stale grant、全解除を検証。親が最終選択画像をreadし、ID/path・read/control・隔離必要表示・折返し・checkbox/selectの分離を確認しました。Chromium以外の実ブラウザーは未検証です。

最終画像をリポジトリへ保存しました：

- [desktop選択](verification/workspace-permissions/final/permissions-selected-1280.png)
- [mobile選択](verification/workspace-permissions/final/permissions-selected-390.png)
- [desktop解除](verification/workspace-permissions/final/permissions-revoked-1280.png)
- [mobile解除](verification/workspace-permissions/final/permissions-revoked-390.png)

MDN公式pageのinput/button/select/fieldset、Window.fetch、CSS flex/grid/gap/overflow-wrapはBaseline Widely availableとChrome/Firefox/Safari supported表示を確認。追加Web APIはありません。出典は[設定手順](dots-workspace-permissions.ja.md#browser-compatibility)に記録し、Baselineを実機合格の代用にはしていません。

## Read-only machine evidence

canonical診断を実装へ接続した後の最終 `node scripts/stopped-update.mjs --check` は期待どおりexit2、`ok:false` / `complete:false`でした。

- 固定dataDir/prefix/entryのrealpath/lstat照合成功。metadataのみで、directory内容やentry bytes、state/token/auth/scope/claims/receiptは読んでいません。
- process518、未観測metadata143、未分類node24、Console/関連候補15。Task197/service299で直接pi-console文字列一致は0、Startup4中reviewed marker/target一致1・未分類3。
- public管理identity未要求、固定本番portへの接続なし。PID候補は所有権/停止対象の証明ではありません。
- future直接起動排他、runtimeの実dataDir/所属worker証明は不成立。本番apply拒否のままです。

## Preservation / source provenance

準備checkoutはGit管理外。開始時に共通147ファイル一致、17ファイル相違を確認し、現行D:を正として必要部分だけ移植しました。旧index/manager/checkout全体で現行を置換していません。

既存未コミット21ファイルの開始hashは [保全manifest](workspace-permissions-update-preservation.json) に保存。最終18件は完全一致、必要追記した`package.json`/`server/index.ts`/`server/runtime/manager.ts`の3件だけが異なります。追加test prefixを取り除いたpackage.jsonのhashは開始hashと一致し、元の未コミット変更を保持しています。readonlyの既存imports/init/routes/observationを削除せず、独立scopeを維持しました。既存execution-state/readonly関連のhashは一致。`.codesearch.db`等の他作業をreset/stage/deleteしていません。

候補139ファイルtgzのSHA256は `e77ea1b3a17ec134d9b4666b19705e87e3ddef33a9801f79317ae6d31cde66d6` と照合済み、不変です。これは今回追加したソースの配布物ではありません。過去19/19・21/21を今回合格に加算せず、古い候補を新ソースのreleaseとして扱いません。

最終source/画像hash・チェック結果は [verification JSON](workspace-permissions-update-verification.json) に記録します。

## Stop / resume history

既存 `tests/readonly-mcp.test.ts:17–61` が、専用Tempの固定dummyキーに `icacls /grant` を実行することを実行後に確認しました。事前確認不足を報告して停止し、本人の「承認します」を隔離dummy ACLと残り安全作業の続行承認として受けて再開しました。実scope・実キー・本番ACLを変更した試験ではありません。最終31件では、この承認済みTemp fixtureも実行しています。

権限設定の最初のchildは30分timeoutで失敗し、follow-up steeringも未消費で失敗しました。部分報告を成功扱いせず、同じ保存model/cwd契約でresumeしたchildと親の最終検証で結果を取得しました。初期型/fixture/browser起動/quoteの失敗も最終合格に含めません。別CLI・別modelへの迂回はありません。

Asana connectorは利用できず、外部プロジェクト同期は行っていません。

## Owner minimum steps / separate approval

**現在できる1操作は診断だけ**です。

```powershell
node .\scripts\stopped-update.mjs --check
```

exit2とblockers/ownerActionsを確認し、applyやlock削除で先へ進まないでください。更新に進むには、本人が別承認の既存操作で通常終了し、管理者と全起動元/所属process/保守排他を特定して実adapterを受入する必要があります。ブラウザー/Pi終了だけではdetached serverは止まりません。今回はその運用操作を行っていません。

GUIは別途承認された適用と本人管理経路の受入後、「設定 → Dotsワークスペース権限 → 個別workspace/session選択 → read/control review → 本人confirm → 保存」。解除は対象選択を外して同じ確認をします。保存送信後の画面移動は保存の取り消しではなく、戻ったら再読込で結果を確認します。

本番適用・停止/起動、操作用認証設定、実scope保存、実Dots接続変更には別確認が必要です。さらに、本番更新とcontrolの保証不足は**承認だけでは解消しません**。実起動排他/所属観測、workerが管理資源へアクセスできない隔離、Accessと両立する本人管理経路、実transport互換性を実装・受入するまで拒否を維持します。
