# Dots final answer read result

## Result

**許可されたexact runの保存済み最終回答text 1件について、隔離されたpin実binaryでtool本文取得まで合格。** startup readyだけではない。通常serverは既定OFF・未登録、実Dots未接続、本番未適用。

## Implementation

- `package/final-answer-evidence.mjs` / `package/sdk-worker.mjs`: SDK 1.0.2の保存前 `message_end` を候補に留め、`agent_settled` 後の保存file/active branch/全文message hashを確認するproducer。Console run・SDK sessionのbindingを維持する。
- `server/runtime/final-answer-journal.ts` / `events.ts` / `manager.ts` / `server/adapters/pi/process.ts`: opt-in private journal、保存確認・受付ACK・foreground terminalの分離、保存再読取とseal。既存コントロールの確認・拒否を維持。
- `shared/results-read.ts` / `server/results-read.ts` / `results-read-tools.ts`: `final_answer` のexact-run＋feature＋expiry、既存permission/revocation/CAS/generation fence、UTF-8 signed cursor paging、既知secret除外。最後のassistant発言だけではfinalとしない。
- `server/final-answer-mcp.ts`: dedicated read-key認証と既存native guardを緩和せず、`/mcp/dots` にfinal-only modern adapterを提供。owner/control/legacy/外部Eventsへの登録・迂回はない。
- 差分: [今回着手時点をbaselineにしたcode/test patch](dots-final-answer-diff.patch)。既存未コミットの差分を混ぜて今回分と称していない。[契約](dots-final-answer-contract.ja.md) / [保全・検証](dots-final-answer-verification.json)。

## Evidence

専用Temp内で実SDK public `SessionManager.create()/appendMessage()` にdummy user/assistantを保存し、共有producerへdummy lifecycleを入力した。同じRuntimeManagerのattach/onRecord/SessionEvents/journal保存経路を使用し、read coreはそのjournalをfileから再読取した。実model/provider、実SDK AgentSessionのprompt、real履歴/session/credential/grantは使用していない。実SDK workerプロセスから本物のmodel応答が届く検証を行ったという意味ではない。

最終実binary証拠: [dots-final-answer-client-proof-final.json](dots-final-answer-client-proof-final.json)。

- 公式binary `0.0.15+a390c168ff1b2d14e73a95991c186c6aba3ff5a0`、SHA256 `1946de55a038313a9b9b2458d05fe1719fa9cf1f20a94dd5f38fc26a98bfdd42` を照合。
- allowlist環境、専用profile/dummy control plane/auth、dynamic loopback、native guard。既存fixtureと同じ限定JSON-RPC command注入形式を使用。
- client側control-plane responseでexact request IDを照合。`tools/list` はfinal-only。`tools/call` **5回**で154 UTF-8 bytesを結合し、保存元dummy回答・公開hash・client受信hashが一致。
- 一致hash: `4a858c534b7a75780d63089d46372263e9cf6f0c786e244e6804b09465ade5ae`。
- 読取でworker/prompt/queue/provider・外部Events起動0。foregroundのみ確認、aggregate completionはfalse。dummy secret検出0、owned child/HTTP fixtures終了、Temp削除済み。
- 初回成功証拠 [dots-final-answer-client-proof.json](dots-final-answer-client-proof.json) も保持。release fence等の追加後に別証拠名で再検証した。繰り返しを独立ケースに水増ししない。

最終 **65 unique PASS** = final read/real HTTP 9 + 既存read 20 + execution/history/receipt/scope 13 + SDK worker 5 + queue 17 + pin実client 1。missing/saving/non-final stop/ACK不明/子継続/切断/変更中foreground/foreign・expired・revoked scope/tampered journal/cursor再送/本文上限/既知secretを含む。`tsc --noEmit` exit0。別出力Vite buildは312 modules、1.61秒、成功。出力は `C:\Users\leade\AppData\Local\Temp\dots-final-build-WjmmQE\dist`。既存distへ書込なし、従来の500 KiB超chunk warningは残る。frontend変更なし。

既存85 file中77はbyte一致。許可した8 fileの追加を除くと、開始時点のSHA256を完全再現する。既存未コミット変更・旧証拠・無関係git statusを保全し、stagedは空。

## Remaining boundary

- 実Dotsサービスの依頼/target binding供給/応答表示、実認証・owner同意UI・feature grant保存・通常serverへのmountは未確認/未結線。fixture control planeの供給したexact targetをclientが受信したことまでで、実Dotsが自動でtargetを選べるという主張ではない。
- 本人操作は今のread checkboxでは足りない。別途承認された結線で、**既存exact run 1件／最終回答textのみ／本人指定Dots connector 1件／本人指定expiry** を確認する必要がある。本文を人が貼り付け直す操作はfixtureでは不要だった。
- child/backgroundの完全census、再起動/旧generationのhydrate、その他history/artifact転送は追加していない。cached結果があっても全体完了・OS idle・実model使用を推定しない。
- owner authentication/public Host gate、同一OSユーザーによるowner resource変更リスクは未解消。native guardに合わない実ingressはblockedであり例外を作らない。OS-wide egress auditも未実施。
- `controlIsolationVerified()` はfalse。本番制御/更新拒否、実permission/plugin/接続/キー/ACL/OS/networkは未変更。commit/push/publication/install/deploy/本番stop/restart、追加subagentを行っていない。

要求した隔離縦断の合格で停止した。artifact・全履歴・新workspace・C1/Phase2へは進まない。
