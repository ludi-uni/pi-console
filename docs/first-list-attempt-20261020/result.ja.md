# 承認済み1件の初回一覧取得試行 — 資格処理前に停止

対象 **304215fd-0ff6-416f-831c-cd03bd3a35b4**。一覧取得は **未完了**。元requestの再照合応答を実行ガードが拒否したため、claim以降を行わず停止した。

## 実行前に確認した状態

ユーザーが09:25 UTCに本人の正規viewから返した非秘密メタデータは、対象ID、親、4操作、grant期限が一致している:

- 親: `c:\users\leade\appdata\local\temp\pi-console-local-mcp-trial-20261019`
- 操作: `directory / list / repo / workspace`
- grant期限: **2026-10-27T08:55:02.091Z**
- 表示state: **expired**

このexpiredは、parentが承認済みでgrant期限が未来の場合、`FolderMcp.view()`の **短期connectionUntil切れ**から返る表示と整合する。stored familyだけを表示する経路なら未来grantはapprovedになり、未承認pendingの期限切れは親がnullとなる。

ただし未来grantだけを根拠に処理せず、既存claimの条件も確認した。continuationの初回claimは、元のpendingUntil内、内部state connected、admission open、grant未失効、正しい初回proof、CurrentUser保護storeのfamily整合とclock条件を満たす必要がある。protected read後にも初回期限を再確認する。短期資格が切れていても、この条件内のhandoff→通常resume/renewが設計された正規経路であり、旧tokenでRPCする方式ではない。条件を緩めるproduct変更はしていない。

署名付きbrokerは元のPID **41232** / start **2026-10-20T06:33:21.560Z** で一致。source **144件**は反映済み版と一致した。

## 実行結果

実実行は **09:35:39.658〜09:35:41.835 UTC**。

| 処理 | 回数・結果 |
| --- | --- |
| local inspect | 継続record missing、初回record pending、元期限 **09:47:49.759 UTC** |
| 元requestIdの照合POST | **1回、HTTP200**。新しいrequestIdは使っていない |
| claim | **0** |
| get | **0** |
| resume / renew / RPC | **0 / 0 / 0** |
| list | **0** |
| client/enrollment資格store書込 | **0** |
| raw応答のメタデータ不一致 | **1**。MCP helperへ渡す前に拒否 |
| 作業用companion | PID **35512**、exit0、終了済み |
| SID/保護読取helper | **7件すべて終了済み** |
| source / データ属性 | **144件 / 14件すべて実施前後で不変** |

元requestIdは `codex-folder-request-5daa0626-e1fc-482e-bb73-5d99065208db`。HTTP200のprivate応答は初回認証proofを含むため、raw bodyを保存・出力していない。承認済みの役割資格を受け取るclaimには到達していない。資格処理の未開始は確認できたが、応答内のCID/生server期限の不一致内訳はガードで記録しておらず不明。

元holder PID43852 / companion38140はこの試行では操作・終了していない。元の09:47:49.759 UTC終了条件を維持する。

## 実行ガードの問題

product側の `package/local-resume-session.mjs` は初回期限を次で正規化する:

`pending.expiresAt = Math.min(serverReply.expiresAt, protectedEnrollment.expiresAt)`

protected enrollmentはproof保存前に期限を決め、serverはrequest受理時に独自の60分期限を決める。両者には保存・通信時間の差がある。ところが今回のtask用 `scope-check.mjs` は **serverの生expiresAtと公開されたclient側期限09:47:49.759の完全一致**を要求していた。この条件は既存のmin契約と不整合で、正規応答を拒否し得る。productの期限切れだけが失敗原因とは結論しない。

**このガードの不整合はこちらの試行側の問題。** 実際の不一致フィールドは未保存なので、今回のHTTP200がこの差だけで拒否されたとまでは断定できない。期限を延長したり、ガードを外して再送したりせず停止した。

## 準備した修正候補（未適用・未再送）

`normalization-candidate.mjs` は対象CIDを固定したまま、生server期限と元client期限を別に扱い、**effective=min(server,originalClient)** を返す。元client期限を超えない。元の最初の応答時刻+60分を超えるserver期限、違うCID、失効・不正時刻を拒否する。server期限の方が短ければ、短い方を優先する。

この候補は **純粋メタデータ8ケース成功**。試行済みガードやproduct sourceには適用していない。実行済みreceiptは上書き・削除しない。

次の最小手順は、この正規化と**CID・生server期限・effective期限だけを記録する診断**をレビューした上で、元requestの正規再照合を最大1回だけ行うこと。scope/期限が一致した場合の資格受取・保存・必要な短期更新と一覧1回というユーザー許可は既にある。同じ許可を再び求めることと、停止した試行の安全な再開判断を混同しない。

再開する場合も初回期限を超えず、同じbroker世代・元requestId・同じIDを使う。raw metadataが不明/不一致ならclaim前で停止。新規申請・再承認・権限拡大・期限延長・他接続復元・Console再起動を行わない。

**現在の初回受取期限は09:47:49.759 UTC（18:47:49.759 JST）。** この期限後に継続recordがまだない場合、未来grantだけを理由に受取経路を復活させない。

## 自動承認レビューとの区別

最初のprocess起動は、自動レビューが「getの事前接続ID guardがないため他接続を操作し得る」として拒否し、未実行だった。公開sourceの事前guardと、反映済み実moduleに対する **16件の隔離negative test成功**を追加確認した後、**同一コマンドを1回だけ再申請し許可された**。

上記の実実行はその許可後のもの。今回の停止原因は、自動レビューの再拒否ではなく、その後のtask用期限メタデータguardの拒否。両者を区別する。自動レビュー回避用の別経路は使っていない。

## 保全

Temp: `C:\Users\leade\AppData\Local\Temp\pi-console-first-list-20261020-e09c`。preflight.json、receive-receipt.json、stopped-verification.json、試行したguard/controller、未適用のnormalization候補を保全した。

clientへの役割資格handoff保存、更新・復元、grant変更、一覧・作成、再起動、新login、source/dist配布は0。秘密値・Cookie・生DPAPI値・raw protocolは記録しない。OS専用試験・pi-warden・他アプリ・ACL/ネットワーク設定に触れていない。画像/UI操作0。
