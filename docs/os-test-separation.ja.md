# OS操作試験と通常回帰の分離

## Result

限定修正を完了。製品gate/isolation-adapter契約・pi-warden・本番は変更していない。今回の実OS操作は0、OS専用entry/setupは未実行。削除済みの前回fixtureを復旧していない。

- 新規無副作用検証: **5 PASS / 0 FAIL**。
- 影響回帰: **23 PASS / 0 FAIL / 2 SKIP**（25ケース）。skipを成功として加算しない。
- 型検査: `tsc --noEmit` exit0。
- parent suiteのimport経由、および影響回帰のinstrumentation: OS process起動・OS fixture作成・setup helper読取・実行可能OSケース登録はすべて0。

前回 `docs/external-mcp-gate-checks.json` / `docs/external-mcp-gate-result.ja.md` の **119回帰PASSにはTemp dummy key ACL操作の実試験が含まれる**。attempt-3と最終回帰で計2回実行した事実は取り消さない。旧記録/画像/proofは変更せず、今回の23 PASS / 2 SKIPとは別の時点・範囲として扱う。

## Cause

`package.json` の通常 `test` は明示ファイル一覧で `tests/readonly-mcp.test.ts` を選択していた。同ファイルの `manual Windows setup protects only a dummy key` はWindowsならskipにならず、Temp `.env`/scope/key fixtureを作成してPowerShellを起動した。

呼出し鎖:
`readonly-mcp.test.ts → Temp fixture.ps1 → Import-Module scripts/ReadOnlyMcpSecret.psm1 → Install-ProtectedReadOnlyMcpKey → WindowsIdentity / FileSecurity / Set-Acl → Get-ProtectedReadOnlyMcpKey`
その後 `icacls.exe /grant` でdummy keyのACLを広げ、拒否を検査していた。Tempであっても実OS権限操作であり、通常の非特権回帰には不適切。

`tests/readonly-launch.test.ts` も標準一覧に含まれ、環境変数で指定した外部PowerShell moduleを `readonly-launch.fixture.ps1` からimportできた。fixtureはkey readerをstub化するが、外部moduleの**import時**の副作用までは保証できないため、これもOS/external受入へ分離した。tests内のsource検索では、実ACL変更の直接呼出しは上記manualケースに集中していた。全repository/全外部moduleのOS無副作用証明ではない。

## Change

- `tests/readonly-mcp.test.ts`: 実OSケースbody/helper呼出しを除去。元の名前は**無条件skip**の保留表示として残す。Windows/環境flag/test-name指定で有効化されない。残るplaceholder bodyもthrowだけでOS処理を持たない。
- `tests/readonly-launch.test.ts`: 同様に無条件skip。標準経路から外部module・PowerShellへの呼出しを除去。
- `tests/os-acceptance/readonly-key.entry.ts` / `readonly-launch.entry.ts`: 元の実ケースを保持。bodyの行頭空白を除いたsource一致を新規testで検証済み。`*.test.ts` ではないため標準discovery対象ではない。
- `tests/helpers/os-acceptance-entry.ts`: own main path、exact explicit CLI選択、非test-worker、非`--test`の全条件を要求するpure guard。環境flagからenableしない。entry importではtest登録・fixture作成・setup呼出しなし。
- `tests/helpers/os-side-effect-probe.mjs`: TEST ONLY stub。OS process spawn、OS fixture prefixのmkdtemp、setup/helper読取、実行可能OSケース登録を**実処理前**に拒否して計数。JS instrumentationはOS sandboxではない。
- `tests/os-test-separation.test.ts`: guard境界、標準選択、元body保持、stubのpositive control、親suiteの通常module＋両entry importを検証。fake legacy環境値とCLI flagが存在しても実操作なし。
- `package.json`: 通常 `test` の既存一覧へ分離検証を1ファイル追加するだけ。名前のnegative filterで場当たり的に避けない。

`ReadOnlyMcpSecret.psm1`、`setup-readonly-mcp-auth.ps1`、`readonly-launch.fixture.ps1` はsource確認のみで不変更・未実行。

## OS acceptance

**この依頼では以下のentryを実行していない。OS受入は別の明示ユーザー承認が得られるまで保留。**

将来の承認時に選択するentryは、通常`npm test`や`node --test`ではなく直接実行形式:
- `node --import tsx tests/os-acceptance/readonly-key.entry.ts --execute-os-acceptance`
- `node --import tsx tests/os-acceptance/readonly-launch.entry.ts --execute-os-acceptance`

これらのコマンド/flagは**試験の選択にすぎず、実行時に必要なユーザー承認の代わりではない**。entryの警告もその旨を明示する。guardは偶発実行防止であり、本人承認の自動認証やOS境界ではない。承認は対象、実操作、Temp範囲、cleanup、外部module/binaryのsourceを含めて事前に確認する必要がある。launcherの環境変数は承認済みの入力pathを指定する用途だけで、許可ではない。

他の任意script/CLIや悪意あるNode codeのOS操作を封じる実装ではない。ここでの保証は今回分離した標準試験経路とそのimport/登録境界。

## Evidence

`docs/os-test-separation-checks.json` に最終arguments/stdout/stderr/exit、`docs/os-test-separation-attempt-1.json` に最初の失敗を保管。初回child preloadのWindows絶対pathがESM URLとして不正だったため、`file://` URLに修正して解消。OS専用entryや実helperを起動しての再試験はしていない。

positive controlはPowerShell spawn / OS fixture mkdtemp / helper readをそれぞれstubで1回拒否し、stubが有効なことを確認した。これは実OS操作の回数ではない。通常parent/影響回帰の各counterは0で、2ケースは明示skip。親suiteの子process内回帰は無副作用検証の内訳であり、独立したPASS数に加算しない。

通常npm test全体、実モデル、実MCP接続、browser/build、OS受入は今回実行していない。影響回帰のHTTPはTemp/dummy/動的loopback fixtureのみ。試験process環境はallowlistと独立Temp HOME/agent/sessionへ限定、実credentialや実設定は参照しない。owned test profilesは削除済み。

保全・変更一覧・source hashは `docs/os-test-separation-verification.json`。baselineと変更3ファイルの原本base64は `docs/os-test-separation-preservation.json`。新subagent、install/deploy、production stop/restart、commit/push/公開なし。モデルは `openai-codex/gpt-6.1-sol` を維持し、結果記録で停止。
