# 外部MCP共通gate・UI・adapter契約 実装結果

## Result

- Console側gate/UI/契約と隔離fixture受入は完了。通常bootstrapは実adapter未接続で `adapter_unavailable`、旧opt-in/env/header/bodyでreadyにならず外部MCPは503拒否。
- readonly/status/final/control、OAuth metadata、旧/未知MCP pathを共通mountで覆う。有効化・restricted connection開始・要求受付・応答公開直前を検査し、失効後の新規admission/本文を拒否する。既存key/scope/expiry/native/owner/Access/release fenceを維持。
- 初回本人管理者setupの保護receiptと現在のOS検証を別パッケージから受ける契約。installation/instance/policy一致と全保護面を必須化。checkboxや保存readyでは代替しない。OS隔離本体と実接続/付け替えは未実装。
- 最終製品差分: 新規11 unique PASS、回帰119 unique PASS、typecheck exit0、別Temp出力Vite build exit0（314 modules / 1.48s）。desktop/mobile 8画像を確認。OS受入・実setup・実credential・実MCP接続・本番適用は未実行。
- baseline322ファイル中317がbyte一致、許可変更5は変更前のexact bytesをSHA256一致で復元・archive保全。先行調査/Startup identity/preflight/final-owner acceptance-5/AgentSession proof-3は不変更。staged=[]。

**権限変更禁止の条件に対し、既存回帰の `manual Windows setup protects only a dummy key` 1ケースを含めてしまい、Temp dummy keyの作成・ACL変更を2回実行した。これは実隔離setupではなく本番/実secretには影響しないが、禁止条件への逸脱として記録する。各fixtureはfinallyで削除済み。OS操作0とは報告しない。今後同条件ではこの回帰ケースを除外する必要がある。**

## Implementation

- `shared/external-mcp.ts`: 非秘密status、reason、binding、保護チェック・setup/verification evidence型。
- `server/isolation-adapter.ts`: inspect/watch/restricted launch/explicit stop契約。trusted code-bound dependencyのみ。実module名や検査を捏造しない。
- `server/external-mcp-gate.ts`: 起動OFF、CAS同意、2秒検査deadline、最大60秒lease、世代/receipt/freshness検証、失効callback、admission/release fence、plain fallbackなしのconnection bridge。失効で自動killしない。
- `server/external-mcp-boundary.ts`: `/mcp`・`/mcp/*`・protected-resource aliasの一元終端、2MiB bounded応答buffer、公開直前失効時の本文/header破棄。診断/enable/recheck/disableは通常Access後の既存local owner guardとstrict POST body。
- `server/index.ts`: adapterなしの通常mount、legacy逃げ道なし。final literal `enabled:false` 維持。`RuntimeManager` のexternal control admission/dispatchにもticket fenceを追加し、通常local promptは変更しない。`controlIsolationVerified()` はfalse。
- `web/ExternalMcp.tsx` / `web/WorkspacePermissions.tsx`: 未導入・setup必要・検査不明/失敗・再確認・明示有効化・期限切れを表示。実setup buttonは実行不可。ローカルConsoleを隔離済みと表示せず、キー入力や自動再送なし。
- test-only driverは `tests/helpers/isolation-adapter.fixture.ts`。本番importなし。既存test変更は通常serverの新503期待値/fake-ready否定とalert selector分離のみ。

面別条件・将来別パッケージの責任・未解決管理API/同SID問題は `docs/external-mcp-gate-contract.ja.md` を参照。

## Evidence

`docs/external-mcp-gate-checks.json` に最終4ステップのexact arguments/stdout/stderr/exitを記録。詳細一覧・保全は `docs/external-mcp-gate-verification.json`。新規11と回帰119は別集計であり、先行PASS数を加算しない。

fixtureではmissing/denied/failed/unknown/stale、全必須保護面欠落、各binding不一致、fake-ready入力、CAS/enable失効競合、遅延launch時のadmission拒否、自動killなし、直接HTTP/旧endpoint/metadata否定、実readonly/final/status adapterの既存auth/native/scope条件を確認。final adapterで本文生成後 `end()` 直前に失効させ、本文不公開を確認。fixtureの全agent操作はdummyでOS隔離証明ではない。

通常 `server/index.ts` もTemp dummy設定・dynamic loopbackだけで起動し、old readonly opt-in/native/shared-secretの各modeにfake-ready env/headerを与えても全MCP拒否、通常Console Access/auth保護が残ることを確認。既存SDK回帰はTemp/固定fake SDK/モデル呼出しなしの初期化・extension command・storageに限り、新たな実モデル要求は実行しない。実listener/P6/P4を変更しない。

authoritative UI proofは `docs/verification/external-mcp/acceptance-4/proof.json`。1280×900 / 390×844、未導入/setup/explicit enabled/revoked各8画像の可読性・重なり・横方向切れを確認。遅延ready statusのtest-only応答が届いてもserverのenable CASが拒否し、browser時計による期限切れでUI操作も無効化。workerLaunches=0。Chromiumのみ、Firefox/WebKitは未実行。MDN Baseline確認は契約の参照先に記録。

初期typecheckでBufferEncoding/fixture check-map型を修正、legacy status用paramsのmodern `_meta` を除いてstrict旧契約に合わせた。browser初回は隔離TempにChromiumがなく、既存1223 executableの公開pathを指定して解消（installなし）。その後遅延UI fixture/alert selector/旧404期待値を修正。build用PowerShell inline argument分割のSyntaxErrorはowned Temp scriptに変更して解消。失敗したacceptance-1/3、先行acceptance-2、`docs/external-mcp-gate-attempt-3-checks.json` を残し、最終成功へ上書きしない。保全scriptはindex.tsのCRLFを明示処理して初期reverse不一致を解消し、5原本のSHA256一致を確認した。

## Preservation

`docs/external-mcp-gate-preservation.json` がbaseline、`docs/external-mcp-gate-originals.json` が5変更ファイルのgzip-base64原本。コード/設定/鍵/OS/インストール領域の本番変更、install/download、stop/restart/deploy、commit/push/publish、新subagentなし。modelは `openai-codex/gpt-6.1-sol` を維持。

owned browser/server/worker fixturesは閉鎖、Temp test profileは削除。別buildは以下に保管し、既存distは変更しない:
`C:/Users/leade/AppData/Local/Temp/external-mcp-final-c043960a70344b3c9b4bc670196c9f5a/dist`

今回の完成はConsole準備とfixture受入まで。実パッケージ配線、実OS/本人setup検証、管理保護、restricted worker/別runner routing、実接続の受入は別承認が必要。
