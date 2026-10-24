# 同じ親フォルダ・4操作での新規申請準備

**申請内容と本人手順の準備は完了。新規 pending 申請は作成していない。** 申請作成そのものが初回認証 proof の生成・取得・保存を伴うため、今回の限定許可の境界で停止した。tool の承認拒否や応答喪失ではなく、source で確認した副作用による未実行・保留。

## 元の記録との照合

根拠は `../create-trial-retry-20261020/public-request.json` の fcf 接続と `scopeToSelectByOwner`。parent の文字列、4操作の順序、7日という設定を元記録と照合した。これは元の申請希望範囲であり、現在の server grant の scope を再取得したという意味ではない。

| 項目 | 用意した申請案 |
| --- | --- |
| 参照する旧接続 | `fcf3c891-84b6-4b2a-a074-8dd4637aeaa5` |
| 親フォルダ | `C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019` |
| 4操作 | **list / directory / repo / workspace** |
| 対象 client | `codex-local-v1`。clientInfo や識別子を認証に使わない |
| 期限案 | **7日**。本人の review 作成時点から7日後。絶対期限はその時点に確定し、今は null |
| 新規 connectionId / requestId | **未発行**。draft には null を明記 |
| 状態 | **未送信・未承認・アクセス未有効化** |

list は許可対象のメタデータ列挙、directory は新規ディレクトリ、repo は新規空 local repo と必要な git init、workspace は新規作成・登録。既存データ削除/上書き、任意 clone URL、push/公開、任意コマンド、run/history/final 本文や Pi 制御は含めない。親フォルダは Console 管理API の境界であり Pi 全体の OS sandbox ではない。

旧初回申請の期限 **2026-10-20T01:26:54.443Z** を延長しない。旧 grant の本人観察期限 **2026-10-27T00:29:05Z** も新規申請へ流用しない。新規7日 grant は新しい期限を持つ操作で、本人が実際の日時を確認する必要がある。今回はその grant を作成しない。

## 実行前に止めた操作・具体的な理由

**操作:** `begin_local_connection` で `codex-local-v1` の新しい pending 申請を作成すること。**対象:** 上記の同じ親・4操作を本人が選ぶための新規接続。

1. `package/local-resume-session.mjs` の begin は最初に `verifyServer` を呼び、installed facade の ensure が broker を起動し得る。その後 `enrollment.begin` を呼ぶ。
2. `package/local-mcp-enrollment.mjs` の begin は新規の client 認証 proof を生成し、`ProtectedJsonStore.transact` で保護保存してから request を送る。`server/local-mcp-state.mjs` の transact は codec.protect と原子的 commit を行う。
3. `server/local-mcp-composition.mjs` の request → `server/folder-mcp.ts` の request は server 発行の初回 claim proof を生成して private companion に返す。通常の新規申請にはこの資格材料の取得・保持が含まれる。
4. 申請のみでは承認済み folder grant は有効化しないが、上記の秘密材料の作成・取得・保存は、今回「別承認まで行わない」と指定された処理に当たる。直接 server request を呼んでも server proof 発行を回避できない。
5. 保存済み 08:27 UTC の preview では local 継続 record が missing、初回 record が expired。期限切れでも未終了 record を begin が勝手に置き換えることはない。旧 enrollment の明示終了が必要になり得る。現在の cancel は保存済み client が現れた場合に忘却も行い得るため、その整理も今回実行しない。初回 record と旧 fcf の対応自体は schema 上 unknown。

本人の最終「この内容で始める」は、役割別資格・継続材料を server に発行/保護保存し grant を有効化する操作。今回の申請準備からは進めず、agent が押すこともない。claim / get による資格受取・保存・復元・接続も未実行。

## 本人が確認できる正規手順の準備

`owner-steps.ja.md` に、元と同じ親・4操作・期限案、本人確認と新しい接続 ID の照合、review の絶対期限、最終承認前で止まる位置、戻る/取消と応答喪失時の結果照合、解除の意味を記載した。正規画面上の既存 control を source で確認した。

新しい pending 接続が未作成なので、本人の実 review 画面に対象を登録・表示させる段階には進めない。既存 client 常駐 companion は未再読込のまま。作業用 companion の一回起動を、既存 client の更新完了と扱わない。将来の申請は初回 proof を受け取れる持続した companion が必要であり、Console 再起動で代用しない。

**共有可能な承認リンクは提示していない。** 正規画面は同 PC の loopback と本人 cookie を必要とし、新しい pending も存在しない。未確認の port や秘密付き URL、コードを返さない。この文書への参照は申請準備資料で、承認リンクではない。

## 次に必要な最小の確認範囲

- **申請作成の追加許可:** 必要な local expired enrollment の明示終了範囲を決めたうえで、新規 client 認証 proof の生成・保護保存、server 初回 proof の発行・private 取得/保持、必要なら broker 起動、companion の再読込/持続を含めて許可すること。新しい owner-login が必要なら、その本人操作も別に確認する。grant 承認や接続まで含めると推定しない。
- **本人最終承認の別許可:** 新規 ID、同じ親、4操作、review で示された具体的期限を本人に返し、資格発行・保護保存・grant 有効化の内容を確認する。その後の受取/get/実接続も必要なら別の範囲として示す。

今回、新規申請を作成できると偽ってリンクや ID を生成せず、未確定の期限・状態を不明または null のまま保存した。

## 成果物・実施数

- `request-scope.json`: 未送信 draft。元記録の hash、親・4操作・7日案、新ID/絶対期限 null、停止理由。
- `owner-steps.ja.md`: 本人が確認する内容と、追加許可後の正規手順。
- `checks.json`: 稼働 source **144/144 不変**、元記録との一致、source 根拠の hash。
- `owned-resources.json` / `seal.json`: 新しい証拠ディレクトリの所有・成果物整合性。

今回の helper / HTTP / MCP 呼出し **0**、実資格の読取・生成・取得・更新・保存・復元 **0**、新規申請 **0**、本人承認 **0**、実接続 **0**、ログイン・再起動 **0**、新規試験 **0**、画像 **0**、UI操作 **0**。source / dist / client 設定は変更していない。実 data の repo/workspace 作成、pi-warden、OS専用試験、ACL・アカウント・ネットワーク設定、他アプリ、commit/push/publish に触れていない。

Temp 所有 root は `C:\Users\leade\AppData\Local\Temp\pi-console-request-preparation-20261020-c4b2`。作成した helper / listener / 常駐 process はない。準備用 node script は exit 0 で終了。以前の封印済み証拠は変更していない。
