# Phase1/C1：startup probeで停止した結果

## Summary

2026-10-07 12:09:06 UTCの承認を受け、`D:\Develop\pi-console` / `openai-codex/gpt-6.1-sol`を確認。active subagent 0、先行resume runはcomplete/Process terminal observed。新規subagent/orchestratorは起動していません。

**C1「隔離実binary transport＋dummy scope合格」は未達です。** 最初の隔離startup probeがfixture境界検証で失敗し、実要求protocolを確定できませんでした。「protocol版を確定できない場合はその境界で停止」の指示に従い、再試行・adapter実装・Phase2移行は行っていません。

## Observed evidence

既存のofficial binaryを限定したdirectory探索で確認しました。広いCodex directoryの初回探索は40秒timeoutのため、既知の2026-10-05/task配下へ狭めました。実profile/キー/設定内容は読んでいません。

- binary：`C:\Users\leade\Documents\Codex\2026-10-05\task\secure-mcp-echo-test\client\tunnel-client.exe`
- SHA256：`1946de55a038313a9b9b2458d05fe1719fa9cf1f20a94dd5f38fc26a98bfdd42`。既存 `tests/readonly-tunnel.test.ts` のpinと一致。
- `--version`：`0.0.15+a390c168ff1b2d14e73a95991c186c6aba3ff5a0`、exit0。専用Temp cwd/profileとallowlist環境で実行。
- startup probe：`tests/dots-phase1-startup-probe.mjs` を1回実行。専用Temp/profile、固定dummy認証、dynamic loopback MCP/control-plane、固定main、新 `/mcp/dots` fixture。旧endpointや本番portへ接続していません。
- 結果：exit1、`AssertionError: MCP_FIXTURE_BOUNDARY_FAILURE`。fixtureのcatchは失敗条件を固定分類へ集約し、trace保存より前のassertで中断しています。**どのheader/method条件が失敗したか、legacy/modernのどちらを要求したかは記録から確定できません。** binaryの非対応/legacy必須と断定しません。
- `finally`でこの試験のchild/HTTP fixtureを終了し、作成したTemp/profileを削除。稼働中の既存processには停止操作をしていません。

[保全manifest](dots-phase1-preservation.json) / [失敗記録](dots-phase1-startup-probe.json) / [保全・source hash確認](dots-phase1-verification.json)。raw header/bodyやclient logは保存していません。

## Limits / preserved boundaries

新read adapter、専用guard、旧MCPから独立したread認証は未実装。fixture GUIによるA/sessionの許可、discovery/catalog/status/progress、B/解除/stale/metadata/header/redirect/ownerAPI/controlの拒否受入も未実施です。typecheck/build/既存91件の再実行はしていません。

dummy keyのlog非露出assertは、先行するfixture failureにより未完了。合格/流出0とは記録しません。clientの宛先設定はloopback fixture限定ですが、OS-level egress監査やnetwork設定変更は行っていません。

実キー生成/取得/入力、既存data読取、実grant/接続変更、本番stop/restart/install/deploy、ACL/account/network/sandbox導入、provider/Events/Orchestrator、commit/push/npm公開は行っていません。既存 `/mcp/readonly` のsource/scope/接続設定を変更せず、`controlIsolationVerified()` false・本番update拒否もそのままです。

変更は新規probe scriptと新規証拠/報告のみ。開始時に保全対象60ファイルを記録し、終了時に一致を確認しました。probeはアプリ本体のadapterではなく、明示指定したpin済みbinary専用の診断脚本で、自動test suiteには追加していません。

## Next owner decision

次に必要なのは、**fixture側の観測失敗を非秘密の構造情報（method/path分類、headerの有無・個数、protocol値）で特定できるようprobeを修正し、同じ隔離startup試験を再実行してよいか**の確認です。app側の認証/gateを緩めてprobeを通す案ではありません。

protocolが確認できた後だけ、承認済みmodern読み取り範囲へ進めます。legacyが必要と判明すれば、その版とstartup/lifecycleの必要差分を報告して別承認を待ちます。未知版fallback、実binary更新/download、旧接続への回避は行いません。
