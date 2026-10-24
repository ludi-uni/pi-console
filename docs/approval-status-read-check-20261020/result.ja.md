# 承認報告後の非秘密メタデータ照合

対象: **304215fd-0ff6-416f-831c-cd03bd3a35b4**。ユーザーは **2026-10-20 08:56 UTC に本人画面で承認したと報告**した。この報告は信頼できる会話証拠として扱う。

**本人の承認報告は確認済み。server の親・操作・絶対期限の独立照合は、認証済み本人ブラウザの読取経路がないため未実施。** 資格受取・更新・復元・実接続は行っていない。

## 確認できたものと不明なもの

| 項目 | 状態 |
| --- | --- |
| 本人の承認報告 | あり。08:56 UTC |
| server の現在の approved / revoked / expired | **未照合**。承認報告から実 API の現在状態まで断定しない |
| 申請の希望親 | `C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019`。元の申請案から確認済み |
| 希望する操作 | `list / directory / repo / workspace` |
| 期間 | review 作成から7日という申請案。現在の server 実 scope は未照合 |
| grant の絶対期限 | **不明**。承認報告の時刻+7日とは算出しない |
| 初回申請・受取期限 | **2026-10-20T09:47:49.759Z = 18:47:49.759 JST**。新規申請受理時の正規 public metadata |
| 短期資格の期限 | 未取得・不明。時間経過により受取後の通常更新が必要になる可能性あり |
| holder / companion | 08:59 UTC の status で保持継続、companionClosed=false |

holder の status は **受理時の cached pending 情報**であり、server を再照会しない。そこにある pending / grantActive=false を、ユーザーの承認が失敗した証拠として扱わない。status 呼出しは資格操作や通信をしない。

## 正規読取の境界

1. `server/local-mcp-http.mjs:2` の view は owner route。`:13` / `:15` の本人検証を通してから `:17` で `app.view()` の非秘密メタデータを返す。**本人の有効 cookie と同一originが必要**。
2. 現在の tools に、その認証済み本人ブラウザで fetch / DOM読取を行う経路がない。cookie / browser profile を取り出して再使用しない。新しい owner-login はコードと本人認証sessionを発行するため、この読取のみの依頼では行わない。
3. `inspect_local_connection` は client 側の local record を返し、`serverGrantState=unknown`。grant の親・操作・絶対期限の代替にはならない。
4. `get_local_connection` は `transport.claim`、state.accept、companion.reconnect を含み、必要なら更新まで行う。今回の読取に使わない。list / get_operation も再接続を通るため代替にしない。
5. `createLocalMcpInstallation` は owner broker の内部 composition 用。生の保護recordを別scriptで復号して後からredactしたり、owner/provider検証を模倣して HTTPの本人境界を迂回したりする方法は採用しない。管理tokenを本人cookieの代わりに使わない。

独立照合は **API送信前で保留**。tool承認拒否や応答喪失は発生していない。失敗した資格操作・変異操作の再試行もない。

## 次の最小操作

**まず本人の既に認証された画面で、この接続 ID の非秘密表示だけを確認する。** 接続ID、親フォルダ、4操作、**「許可の期限」の絶対日時**を照合し、日時と一致結果だけを共有してもらう。コード・cookie・キーは不要。現在の本人sessionが切れていた場合、新しい本人確認を勝手に始めず、その必要性を別途伝える。

この確認には新規 grant、claim、資格保存、restore、接続の許可は必要ない。人の画面確認の代わりに新しいAPIを作ることや、稼働Consoleを再起動することも今回していない。

## その後の資格受取・実接続に必要な具体的許可

server の対象・操作・絶対期限が本人画面で一致し、元の初回期限内であることを前提に、次をまとめた限定許可が必要になる:

> 接続ID **304215fd-0ff6-416f-831c-cd03bd3a35b4** に限り、元requestIdでの期限内再照合と初回proofのprivate再取得、claimによる既発行資格の受取、Windows本人用領域への保護保存、同IDへの復元・必要な短期資格更新、および許可親メタデータ一覧1回を許可する。確認済みの親・4操作・grant絶対期限を維持する。不一致・不明・失効・元初回期限切れ・broker世代変更では停止し、新規申請・新grant・期限延長・repo/workspace作成・Pi実行・本文取得をしない。

**これはまだ承認・実行していない次段階の範囲案。** `get`だけで受取/保存を完了して接続前に必ず止まれるとは約束しない。通常の get が復元と必要な短期更新まで進むため、その内容を明示している。

### 元申請の正規継続条件

- clientId: `codex-local-v1`
- 元 requestId: `codex-folder-request-5daa0626-e1fc-482e-bb73-5d99065208db`
- 元の初回期限: **09:47:49.759 UTC**。経過後に新しい申請へ自動で取り直さない。
- 既存 holder PID 43852 / companion PID 38140、tool session 97968。現在の controller は status / close のみ、guard は claim / resume / renew を禁止している。
- 将来の許可後に別の正規 companion を使う場合、**元 requestId の begin で同じ申請を期限内・同世代で再照合**し、その新しい接続IDを明示した get を行う。新 requestId にしない。新processの getだけでは pendingのprivate材料を回復しない。
- 既存 client 常駐 companion の catalog 再読込は未確認のまま。Console 全体の再起動で代用しない。

## 今回の実施・保全

sourceの読取と holder の cached status 1回のみ。正規grant API 呼出し0、MCP tool呼出し0、HTTP0、新login0、claim/資格取得/更新/保存/復元/実接続0、再起動0、変更実装0、テスト0、画像/UI操作0。本人ブラウザのcookie/profile、秘密値、生の保護recordを読んでいない。pi-warden、OS専用試験、ACL/アカウント/ネットワーク設定、他アプリに触れていない。

新規成果物はこの docs と Temp `pi-console-approval-status-read-20261020-f93a` の報告・hash記録だけ。過去の封印済み証拠、保持中の申請・grant、source/dist/client設定を変更していない。旧 holder は今回作成したprocessではなく、その自動終了期限も変更していない。
