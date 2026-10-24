# 対象 preview 候補の適用と 1 回の実状態確認

2026-10-20。**package 4 ファイル適用済み。fcf 指定の秘密非表示 preview 1 回は完了。復元・更新・broker 接続はしていない。**

## 適用と保全

適用元は `../target-preview-candidate-20261020/candidate-manifest.json` の production 4 件。封印済み成果物と source hash を再照合し、現行 source 144 件が候補作成時と一致することを確認してから保全した。

- `package/local-mcp-client-state.mjs`
- `package/local-mcp-enrollment.mjs`
- `package/local-resume-mcp.mjs`
- `package/local-resume-session.mjs`

バックアップ: `C:\Users\leade\AppData\Local\Temp\pi-console-target-preview-apply-20261020-b84e\source-before\package\`。4 件の適用前後 hash は `before.json` / `application.json`。

反映後の source **144/144 件**が期待値に一致し、変更対象外 **140 件**は不変。候補のテスト 9 ファイルは適用していない。受入は同一 hash の隔離候補で **220/220 成功**した証拠を参照し、今回実 repo の aggregate test / OS test / native entry test は行っていない。

## 再読込の範囲

提供された tools に既存 client 常駐 companion の再読込 API がないため、適用済み installed entry を **作業専用 stdio companion として新規読込**して確認した。既存 client 常駐 process の置換・停止はしておらず、その client 内の tool catalog 更新は未確認。

作業用 companion PID **38904** が serverInfo version **2**、tools **7 件**を返したことを確認後、`inspect_local_connection` を **1 回**だけ呼び、stdin EOF で終了。Console 全体の再起動は不要で、実行していない。

## 実 preview 結果

送信 **2026-10-20T08:26:58.989Z**、応答 **08:27:00.141Z**、終了 **08:27:00.150Z**。不確かな応答ではなく、契約に一致するメタデータ応答を受領。再試行 **0**。

| 項目 | 結果 |
| --- | --- |
| 指定対象 | `fcf3c891-84b6-4b2a-a074-8dd4637aeaa5` |
| client | `codex-local-v1` |
| target | **missing**。指定対象との一致は確認できなかった |
| 保存済み継続 record | **missing**。この client に保存済み record がない |
| 継続材料 | **absent**。この client の継続材料がない |
| local 接続 ID / 短期期限 / grant 期限 | null。取得できない値を推定しない |
| server grant 状態 | **unknown**。server の grant は照会していない |
| 初回 record | **expired** |
| 初回 record の期限 | **2026-10-20T01:26:54.443Z = 10:26:54.443 JST** |
| 初回 record と fcf の対応 | **unknown**。enrollment schema が connection ID を保存していない |
| server 発行の初回受取材料 | **unknown**。enrollment proof から存在を推定しない |
| connected | **false** |

`target=missing` は server の fcf grant が存在しない、解除済み、または失効済みという意味ではない。以前の本人観察にある grant 期限 **2026-10-27T00:29:05Z** は、今回の local record から再確認できていない。7 日の grant が残っている可能性から、経過済みの初回期限を回避しない。

## 読取経路と終了確認

実施前に inspect が verifyServer 分岐より前に return し、正規 store の read のみであることを source で再確認した。実行時の guard は Node の通信・書込・entropy 生成を禁止し、既存保護モジュールの固定 SID / DPAPI script だけを子 process として許可した。guard と source はこの作業専用実行に使用し、production source へ追加していない。

| 観測 | 数 |
| --- | --- |
| Node 通信試行 | **0** |
| Node ファイル書込試行 | **0** |
| Node entropy 生成試行 | **0** |
| 許可外子 process 試行 | **0** |
| SID 読取 helper | **1**、PID 36812、正常終了 |
| DPAPI unprotect による正規保護状態読取 helper | **2**、PID 37380 / 37412、正常終了 |
| 作業用 companion | PID 38904、exit **0**、終了確認済み |
| 状態・registry・管理ファイル属性 | **14/14 件**が実施前後で不変 |

保護状態は正規モジュール内で読み、出力は whitelist のメタデータだけを記録した。SID、秘密値、DPAPI blob、helper stdin/stdout、raw protocol、raw stderr、profile/.env、process command line は保存・表示していない。管理 helper / ensureManagedResumeBroker / owner-login は呼んでいない。DPAPI helper の静的コードは両 operation を持つが、この経路では ProtectedJsonStore.read → unprotect のみであり protect は呼ばない。

実資格の作成・更新・復元 **0**、grant / scope / 期限変更 **0**、broker / 管理 HTTP **0**、実 grant 接続 **0**、Console 再起動 **0**、ログイン・申請 **0**、repo/workspace 作成 **0**、画像 **0**、UI 操作 **0**。pi-warden、OS 専用試験、ACL・アカウント・ネットワーク設定、他アプリ、commit/push/publish に触れていない。

## 次の最小操作

**現行 client の材料で fcf の復元を試す段階には進めない。** 保存済み継続 record がなく、初回受取期限も過ぎている。get / begin / 再申請 / 再発行 / 期限延長を自動実行しない。

現在の実装で連携を開始するには、**新規接続の申請と本人の browser 承認**を別途許可する必要がある。新規申請では新しい接続 ID・親・操作・期限を決める操作になる。元 fcf の許可を暗黙に流用せず、旧 grant の確認や解除も今回の許可から推定しない。本人確認の新規ログインが必要かは現在の UI セッション次第で、今回は確認していない。

既存 client の常駐 companion にも新 catalog を表示する必要がある場合、その client の正規再読込手段を別途使う。今回の結果は新コードを読んだ作業用 companion の結果であり、既存 client の常駐 catalog 更新完了とは報告しない。

証拠: `preview-attempt.json`、`verification.json`、`safety.ja.md`、`owned-resources.json`。バックアップと controller は上記 Temp root に保全。`seal.json` に成果物 hash を記録する。実行 script の再実行はしない。
