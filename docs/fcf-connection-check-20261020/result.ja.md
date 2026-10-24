# fcf限定の接続確認 — 事前条件で停止、更新・接続・作成なし

2026-10-20。本人承認 Sentinel_1358d2e801588191b621e07877e86634 は **fcf3c891-84b6-4b2a-a074-8dd4637aeaa5の有効な既存grantだけ** の通常短期更新と接続/scope確認。別接続・取消済み/期限切れgrantの復活/更新、scope/7日期限拡張は禁止。3操作試験は接続・scope一致・path競合なしが確認できた場合だけという条件を維持した。

## 成立した事前確認

- 適用済み候補4ファイルのhash一致。source変更なし。
- インストール済みCodex CLIの `mcp get pi_console_local --json` はexit0。既存設定のcommand/args/cwd/clientIdが所有記録と一致。raw設定/env/stderrは保存・出力せず、MCPサーバー起動はしていない。
- 正規管理helperの認証済みstatusはrunning/managed、PID43932、startedAt=2026-10-20T01:16:33.010Z、127.0.0.1:31717、version0.5.2。
- 既存試験親 `C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019` は所有file identity（dev/ino/birthtime）と一致。内容列挙なし。予定子 `mcp-create-check-20261019` は不存在でpath競合なし。

## 具体的な停止理由

1. **正規broker取得の拒否**: `managedResumeBroker({directory:既存dataDirectory})` が **managed_resume_unavailable** を返した。管理status自体は成功しているが、検証済みのresume brokerは取得できない。これはCodex MCP tool自体のRPCエラーではなく、その前の正規管理helperによる拒否である。数字のRPC error codeへ置き換えていない。新しいowner-login/code/cookieをagentが取得して回避する操作もしていない。
2. **fcfだけに更新を制限する既存entryがない**: `server/local-mcp-composition.mjs` のrestoreは全保存familiesをloopする。`server/local-mcp-installation.mjs` の最初のgetがそのrestoreをawaitし、`server/local-mcp-http.mjs` はrequest/claim/resume/renew等の個別処理前にservice=getを呼ぶ。fcfを指定してrenewしても、それより前の初回復元はfcfだけへ制限されない。現在の完全なeligible family一覧は非秘密資料だけでは確定できず、別接続の更新を除外できない。**別grantが実際に更新されると確認したわけではないが、許可範囲内だけの操作と保証できないため、初回service読込を呼ばず停止した。**

公開資料上の主な対象候補はfcfで、本人観測のgrant期限は10/27 09:29:05 JST。画面expiredは短期資格切れを示していた。645接続は本人解除報告と利用拒否の記録があり、a885/86b3は公開資料上pending/期限切れ履歴だが、現在の全protected state内訳を独立取得したものではない。保存資料と状態別挙動の詳細は `docs/initial-claim-restore-analysis-20261020/result.ja.md`。

grant期限切れ/revokedが正常に記録されているものはコード上復元対象外である。ただし、今回の承認は別の有効grantの更新も許可していないため、「revokedを復活しない」ことだけでは対象限定の条件を満たさない。

## 実行しなかった処理

MCP get/claim/resume/renew/request/list/create/get_operation/cancelは**全て0回**。Codex app-server/実MCP client起動0、新規申請0、資格生成/更新/復元0、grant変更0、owner-login0、実データdirectory/repo/workspace作成0、外部remote/Pi実行/削除0。本番stop/restart0、source/dist/config変更0、native試験0。既存データ本文・秘密・DPAPI stateは手動取得/復号していない。runtimeは既存PID43932のまま。

接続成功・実際の保存scope・正確なgrant期限の新しい照合は未達。新ID/期限は発行していない。作成前path確認だけを、作成条件全体の成立と扱っていない。

本人への追加質問・操作依頼は送らず、親へ報告する。通常の本人owner-loginでbrokerが使えるようになっても、fcfだけに限定できない初回復元の問題は別に残る。旧grantを広く更新したり、stateを手動で編集/移動したり、別store・新規申請・generation変更で回避していない。

証拠root: `C:\Users\leade\AppData\Local\Temp\pi-console-fcf-connect-20261020-4b31`。`preflight.json` に正規helperの固定reason・限定metadata・各操作0を記録。実行スクリプトは `C:\Users\leade\AppData\Local\Temp\pi-console-fcf-connect-preflight-20261020.mjs`。pi-warden作業なし。
