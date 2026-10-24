# Dots ワークスペース権限（新しい範囲設定）

## 本人の最小操作

1. このサーバーの `http://127.0.0.1:<port>` の GUI で「設定 → Dots ワークスペース権限」を開き、現在の権限を再読込します。既存 Host/Access gate を通過する本人ローカル GUI のみ保存できます。公開/tunnel GUI・Dots native client から管理できません。
2. 登録 ID と canonical path を確認し、必要な workspace を個別に選びます。各 workspace の観測済み session ID/generation も個別選択します。全選択・未登録 path の追加・将来の session の自動追加はありません。
3. 初期選択は `read`。操作が必要な対象だけ別途 `control` を明示選択します。`control` は読み取りも含みます。
4. 「変更内容を確認」で ID/path/read/control/session/generation と解除される範囲をレビューし、本人確認 checkbox を入れて保存します。cancel・別 section・mobile の設定へ戻る操作は未保存の review/確認を破棄します。
5. 解除は対象 workspace の選択を外して同じ review/本人確認で保存します。何も選択しなければ**新しい**権限を全解除できます。

保存を送信した後に別画面へ移動しても、受付済み保存の取り消しにはなりません。戻ったら再読込で現在値を確認してください。保存結果が不明な場合も自動再送・成功表示をせず、まず再読込します。

none が default です。既存 `/mcp/readonly` の immutable legacy scope は独立しており、黙って移行・拡張しません。この画面で解除しても legacy readonly 権限は解除されません。接続/identity・キー・tunnel・Events・approval/trust 設定は変更しません。

## 操作の範囲と認証

**現行の本番ワーカーでは操作を拒否します。** 同じOSユーザーで任意のPi toolを実行できるワーカーは、permissionファイルへの書き込みや本人APIへのローカルHTTPを行えます。本人GUIのheader/grantだけでは、その指示元がDotsであることをOS側で隔離できません。`RuntimeManager.controlIsolationVerified()` は現行実装では常にfalseとし、専用キーやscopeの選択でも解除できない `worker_isolation_unverified` を返します。強制解除・自己申告flagはありません。workerによる権限設定の書き換え・管理API呼び出しを禁止できる実契約の設計・受入が未完了です。これはツールのファイルアクセスをworkspace内にsandbox化した機能ではありません。

以下の操作契約は、OS/toolアクセスを持たない隔離dummy runtimeで検証したコアです。本番操作可能という合格ではありません。

新 native endpoint `/mcp/dots` の Pi 操作は `submit_instruction → start_execution → stop_execution` の段階契約です。submit は指示を staging するだけで worker を開始しません。start は同一 instance/revision/workspace/path/session/generation に bound した指示のみ既存 `RuntimeManager.prompt` に渡します。stop は明示した active Pi run のみ停止し、既存 stop contract と同じく Console queue を pause、Pi queue を clear します（独立した queue 編集権限ではありません）。Orchestrator 開始、kit-owned session の操作、approval 自動応答、slash commands、steer/follow-up/queue/background 操作は対象外です。worker を勝手に open/resume しません。

- read は既存 readonly credential matcher/native loopback 境界を再利用します。既存 readonly が native/no-key モードなら loopback native 境界です。
- control は別途明示設定済みの `PI_CONSOLE_CONTROL_MCP_KEY` と `x-pi-console-control-key` が必須。readonly credential と同値の control 設定は拒否します。readonly key で操作への昇格はできません。
- control credential未設定、またはワーカー隔離未証明ならGUIは「現在操作不可・専用操作認証とワーカー隔離の検証が必要」と表示します。scope保存や認証設定だけで操作可能になりません。今回は実キーの読取/生成/入力/設定変更は行っていません。後の認証設定・実機適用は本人への別確認事項です。
- native start の idle/preflight contract は installed SDK 1.0.2 の source と実 prototype を dummy dependency で確認しました。1.0.2 以外は native start を拒否します（通常 GUI は従来の対応を保持）。worker は入口と started callback の両方で busy/compaction/Pi queue を再検証し、streamingBehavior を許さず、閉じた callback/15 秒 admission deadline の後の遅延開始も拒否します。input-handler/before-start await 中の別 run 開始・agent_settled deferred 経路を no-provider test で確認しました。実モデル/実 auth は呼んでいません。
- native peer/strict literal Host/Origin 不在/Fetch/proxy/Cloudflare header 禁止を保持します。管理 API は逆に same-origin Origin/`Sec-Fetch-Site`・本人 GUI header・短寿命 grant・revision・明示確認がすべて必要です。local owner 境界は同一 OS ユーザーの悪意あるプロセスを暗号学的に識別するものではありません。

## 保存・解除・再起動

stable owner データは `dataDir/workspace-permissions.json`。更新用 source snapshot の復元対象ではありません。receipt は `dataDir/dots-permission-receipts/` に hash と outcome のみ保存し、指示本文は staging メモリ以外に保存しません。

atomic temp write/fsync/rename と revision CAS、exclusive disk admission lock を使用します。同時保存は拒否します。登録/canonical path の重複、未登録、未観測、session 重複、scan 不完全、generation 変更は fail-closed です。native request は最新 scope を毎回検証します。scope にない workspace/session を自動追加しません。

解除は admission と同じ lock で線形化します。すでに admission 済みの要求が完了するまで保存は `permission_busy` を返します（解除が過去の実行を取り消すわけではありません）。再読込後、in-flight が終了してから本人が改めて解除を確認してください。成功した解除/範囲切替後は旧 revision/receipt binding の要求を拒否します。

保存失敗・lock cleanup 失敗・process crash では `.lock` が残り、別 process/再起動でも old scope が復活しない fail-closed 状態になります。自動 lock 回収はしません。残存 lock の手動復旧は、他の実行がないことと保存結果を本人が確認した後の**別承認作業**です。この実装作業では復旧操作をしていません。

再起動で server instance/grant/staging が失効し、再オープンで session generation が変わります。保存済み対象 ID/path/scope は保持しますが、新 generation へ黙って許可を引き継ぎません。GUI を再読込し、対象を改めてレビューしてください。

receipt は dispatch **前**に exclusive claim します。ACK/receipt 保存が不明なら uncertain とし、同じ request ID を再送しません。その process の対象 session は以後の操作を止めます。再起動後にも既存 receipt と新 instance/revision の hash 不一致は拒否します。GUI/native の失われた応答は成功表示せず、現在値/`get_request` を確認してください。staging と `get_request` のメモリ投影は再起動後には利用できません。

## Browser compatibility

親が MDN 公式 page の Baseline 表示を取得し、今回の basic input checkbox/button/select/fieldset、Window.fetch、CSS flex/grid/gap/overflow-wrap は **Widely available** と確認しました。追加 Web API はありません。

- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/button
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/select
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/fieldset
- https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/flex
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/grid
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/gap
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow-wrap

Baseline は実ブラウザー合格の代替ではありません。隔離 Playwright Chromium desktop/mobile の操作検証と実画像確認を別に行いました。全 browser/device 実機確認は未実施です。

## 狭い source reuse

現行 D: / HEAD `6497049` を基準に限定追記しました。準備 checkout の `integrations.ts` から localIntegrationRequest/integrationAdminRequest の peer/Host/Origin/Fetch/header 境界を比較して再利用し、channel/connection/Events は取り込みませんでした。`runtime/control-target.ts` の rejection/expectation と `manager.ts` の observed-only admission/report-recovery/busy/approval/queue/kit/run 再検証を狭く forward-port。`package/sdk-worker.mjs` は active/pending Console run binding、`checkRunFence` と native 専用 `requireIdle`/preflight 再検証・closed callback/deadline の必要最小部分を exact edit しました。通常 GUI の prompt/queue 契約と既存 trust/dialog 境界は維持しています。

prepared `control-mcp-config.ts` の別 credential/header・readonly 同値拒否を参考にしました。prepared `control-mcp.ts` / `control-ledger.ts` は contract/claim-before-dispatch を比較しましたが、Events/channel/private-storage helper の bulk import はせず、現行 `PromptReceipts` を再利用して instance/revision/path/generation を payload hash に含めました。古い index/manager 全体を置換していません。

## 検証範囲と必要な本人作業

専用 temp/dataDir、dynamic loopback port、固定 dummy keys、fake SDK を用いた unit/native/real-HTTP browser fixture で確認します。browser/SDK child の環境は allowlist に sanitize、browser の外部 request は拒否します。desktop/mobile GUI の選択/review/cancel/section戻り/確認保存/全解除、失われた保存応答の再読込、restart/stale grant を隔離検証します。native は旧 revision/generation/receipt、解除と in-flight admission、CAS、破損/保存失敗、partial ACK、exact run の clear_queue/abort fence を確認します。

最終 source の型検査 exit 0、隔離回帰 31/31 pass・fail 0・skip 0（新 component 9 件＋既存 receipt/readonly 22 件）。停止中更新の別39件とは別集計です。コマンド・保全・阻害要因のまとめは [成果物レポート](workspace-permissions-update-result.ja.md) を参照してください。SDK 1.0.2 の実 prototype と dummy dependency の契約 test を含みます。既存 readonly の manual fixture は専用 Temp の固定 dummy key/ACL のみで、実行後に禁止境界との解釈確認で停止し、本人の追加承認後に完了処理を再開しました。実キー/実 ACL に対する操作ではありません。

CSS 後の最終 isolated Vite build は exit 0、312 modules（large chunk warning のみ）。出力は `C:\Users\leade\AppData\Local\Temp\dots-parent-final-aOnJKP\dist`。configFile/envFile を false、child 環境を OS allowlist＋専用 temp/profile に sanitize し、既存 dist は上書きしていません。

最終成功画像は `docs/verification/workspace-permissions/final/permissions-selected-1280.png` と同 directory の `permissions-selected-390.png`（解除後は `permissions-revoked-1280.png` / `permissions-revoked-390.png`）です。初回画像も上位directoryに保全しています。desktop/mobile の selected 画像を read し、checkbox と Scope label の分離・read/control の識別・canonical path の表示を確認しました。mobile の長い path は折り返され、画像内に横方向のはみ出しは見られません。縦に長い画面は通常の scroll です。実 browser は Chromium のみです。

本番未適用・未停止・未再起動、実 scope/認証/receipt/秘密・実 session は未読取です。実 Dots/実 transport との接続・互換性は未検証です。新 endpoint は sessionless JSON-RPC の限定契約（2025-06-18 initialize）で、Events/subscription/接続手順を提供しません。隔離 mock/browser 合格は実機・実 Dots 合格ではありません。Access有効構成では既存gateがpublic Hostだけを許可し、owner APIはliteral loopback Hostを要求するため、現行ではGUI保存の双方gateを通過できません。既存gateを緩めず、本人管理経路の認証設計・受入が別途必要です。実機認証設定・実Dots接続確認・scope保存・本番更新の許可は本人の別確認が必要です。認証設定の承認だけでは本番操作の隔離拒否は解除されず、実ワーカー隔離契約の実装・受入が別途必要です。
