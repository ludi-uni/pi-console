# 対象状態 preview / 復元前 ID 照合の隔離実装

2026-10-20。**実装・dummy 検証完了、本番未適用**。実 helper、実資格内容、実接続には触れていない。

## 実装場所と差分

所有 root: `C:\Users\leade\AppData\Local\Temp\pi-console-target-preview-candidate-20261020-a63d`。公開 source 144 件を `base/` と `work/` に保全コピーし、`work/` だけを変更した。D のこの docs フォルダは配布用証拠であり、起動対象ではない。

本番向け候補は次の **package 4 ファイル**。既存試験 8 ファイルを契約変更に合わせて更新し、新規試験 1 ファイルを追加した。全差分は `candidate.patch`、package だけは `source.patch`、変更 13 ファイルは `candidate.zip`、適用前後 hash は `candidate-manifest.json`。

| ファイル | 変更 |
| --- | --- |
| `package/local-mcp-client-state.mjs` | 正規 store の read-only inspect。復元前・身元確認 await 後・応答待ち後の対象再照合。private 応答 ID/client/grant 期限照合。保護 transaction 内の対象照合 |
| `package/local-mcp-enrollment.mjs` | 期限・状態だけの read-only inspect。enrollment proof を server 発行の初回 claim proof や継続材料と扱わない |
| `package/local-resume-session.mjs` | offline inspect tool。get の期待 ID 指定と安全な既定動作。未知の初回 request の再送・取消を get で行わない |
| `package/local-resume-mcp.mjs` | installed facade に inspect の配線を追加。main / native entry は試験で実行していない |

## 実際の使い方（将来の適用後。今回は未実行）

`inspect_local_connection {"expectedConnectionId":"fcf3c891-84b6-4b2a-a074-8dd4637aeaa5"}` を 1 回呼ぶ。本人がキーを作る・入力する必要はない。本人ログインや新規申請を先に要求しない。

返す値は local の `target=match/mismatch/missing/unknown`、保存された接続 ID、短期期限、grant 期限、継続材料の有無、初回 record の期限・状態だけ。秘密値・hash・SID/owner・broker URL/世代・例外は返さない。**`serverGrantState=unknown`、`connected=false`** とし、現在も server 側で有効という意味を持たせない。

enrollment record は connection ID や server 発行初回 claim proof を保存していない。そのため `initial.target=unknown`、record がある場合の `initialClaimMaterial=unknown` を返す。別の初回 record を fcf と同一視しない。読み取れない状態は unknown、確認できた不存在だけ absent/missing と区別する。

`get_local_connection {expectedConnectionId: ...}` は復元・短期更新・保存を伴い得る別操作。preview から自動呼出ししない。再起動後は明示 ID 必須。同一 session が既に持つ pending / connected の ID に限り省略可能。既存 `get {}` が再起動後に自動で任意保存接続を復元する動作を止めた。tools は 6→7、stdio serverInfo version は 1→2。

初回応答喪失後の再照合は、**元の requestId を使う明示 begin** が元の期限・broker 世代の範囲内で行う。get は未知 ID の初回 request を再送しない。取消の照合は明示 cancel を使う。期限を過ぎた初回 proof を復活させる仕組みは追加していない。

## 検証

| 確認 | 結果 |
| --- | --- |
| focused RED | 45 件中 33 失敗。未実装 inspect、helper 前の ID 照合、応答不一致保存防止等で期待どおり失敗 |
| focused 最終 | **58/58 成功** |
| 影響範囲の純粋 suite | 新規 58 + 既存 162 = **220/220 成功** |
| JS 構文 | package 4 件成功。entry は `node --check` のみ、実行なし |
| patch 適用可否 | 保全 base の別 copy で `git apply --check` 成功。実適用はしていない |
| 稼働 source 保全 | **144/144 件、作業前 hash と一致** |

preview の fake backend では `protect / begin / commit / secret / OSCalls = 0`、MCP 層で `verifyServer / transport = 0` を assertion。繰返し・同時 preview、複数 client、期限切れ、読取不能・owner 不一致・不正 record、時計不明、保護読取待機中の期限経過も確認した。

guard の拒否では helper 前の停止、初回材料不足、cancelling、対象差し替え、grant 失効、応答 ID/client 不一致、別 ID の credential_expired 応答、grant 期限の延長、protected CAS で別対象への保存拒否を確認。正常対象の guard 通過は **fake resume sentinel** までで確認し、その試験は資格を作成・保存しない。既存の正常復元/更新・応答喪失・scope/revoke 検証は public dummy codec と memory fake provider のみ。

通常 `npm test` は native 等を含むため実行していない。local suite も HTTP transport / managed-open / OS entry を除外し、列挙した pure 11 ファイルだけを実行した。`acceptance-final.tap` と `run-tests.mjs` が対象と結果の根拠。UI 変更・画像 **0**、UI 操作 **0**。

## 実適用に必要な最小範囲

1. 現在の 4 package ファイルが manifest の base hash に一致することを確認し、この **4 ファイルのみ**を適用する許可。既存変更を巻き戻さない。test 9 ファイルの適用は再現可能な受入を残す場合の追加範囲。
2. 利用 client の companion を新しい source で読み直し、**fcf を指定する inspect 1 回だけ**を実状態で行う許可。これは既存の正規保護状態モジュールで実 record / SID を読み、秘密を返さない経路。今回禁止された実資格の参照・実 client 起動を伴うため、今回は実施していない。
3. この段階に Console server の再起動、dist 配布、broker 起動、owner-login、申請、資格更新・復元、get/list、repo 作成は必要ない。4 package の変更は次に起動した companion に反映される。既存 companion は読み込み済み module を保持するため更新前提にしない。
4. preview が target mismatch / missing / unknown、grant expired、初回材料不足なら停止。grant が local に期限内でも server 状態は未確認であり、実復元・短期更新・許可親一覧の実行は別の許可範囲とする。

fcf の元の初回受取期限は **2026-10-20T01:26:54.443Z**、保存された本人観察の grant 期限は **2026-10-27T00:29:05Z**。この候補はどちらも変更しない。現在の fcf の内容・状態は今回読んでおらず依然不明。親・操作・期限を取り直すことや、実材料がない場合の自動新規登録を含めない。

## 適用状態と限界

**本番 source 適用 0、実 helper 0、実資格の読取/作成/更新/復元 0、実 MCP 接続 0、実 HTTP/listener 0、再起動 0、本人ログイン 0、新規申請 0、grant 変更 0、実作成 0**。Pi/warden、OS 専用試験、ACL・アカウント・ネットワーク設定、他アプリ、commit/push/publish に触れていない。

実 DPAPI / file backend / installed client の統合動作は未確認。client の保存 schema に durable clock floor がないため、過去の時計巻戻りや server 側解除を local metadata だけでは証明できない。既存 server の proof、grant、clock floor、親検証を維持し、preview を接続許可として扱わない。

レビューは `review.ja.md`。修正後の未解決の必須 finding はない。fixture は memory-only、テスト runner は exit 0 で終了、作成した常駐 helper / listener はない。Temp 保全 copy と候補は証拠として残す。所有ディレクトリの識別と終了根拠は `owned-resources.json`、成果物 hash は `seal.json`。
