# broker診断情報のみの候補 — 隔離実装・dummy受入完了、未適用

対象はpi-consoleの `package/managed-resume-broker.mjs` と新規回帰 `tests/local-resume/broker-diagnostic.test.mjs`。実装は `C:\Users\leade\AppData\Local\Temp\pi-console-broker-diagnostics-20261020-b4a9\work` 内のみ。本番D source/dist/config、起動条件、資格処理は変更していない。

## 変更したこと

既存の拒否message `managed_resume_unavailable` / `managed_resume_io_required` と成功descriptorを維持したまま、trusted helperの例外へ固定enumのreasonとHTTP statusだけを付けた。HTTP statusは整数100–599だけを保持し、なければnull。検証順序とHMAC/port/PID/nonce等の条件は同じで、fallback/retry/start/login/資格操作を追加していない。

診断例は `{reason:'broker_not_advertised',httpStatus:200}`。identity証明が正しいと確認した後でだけ、このreasonになる。不正identityなら `identity_proof_invalid` 等で先に拒否するため、未検証replyのbroker情報から原因を断定しない。

主なenumは state_unavailable、token_invalid、challenge_invalid、identity_response_unavailable、identity_http_rejected、service_mismatch、pid_mismatch、started_at_mismatch、generation_invalid、identity_proof_invalid、broker_not_advertised、broker_port_invalid、broker_port_conflict、broker_signature_invalid。IO例外はstate_read_failed / token_read_failed / challenge_failed / identity_request_failedへ固定化し、raw exceptionのmessage/cause/code/payloadを持ち込まない。想定外reply例外も固定enumへ封じる。

新export `managedResumeDiagnostic(error)` は、このmodule自身が生成した例外をWeakMapで識別し、安全な2項目のコピーだけを返す。任意errorのmessage/property/getterを読まず、偽装diagnosticはunclassified_failure/nullになる。loggerや自動出力は追加していない。公開MCP応答は既存の **-32602 / local_resume_or_scope_unavailable** のままで、reason/statusを含めない。

ここで保存する数値は **HTTP status**。過去のapp-server JSON-RPC code（別レイヤー）を復元したものではない。body内のRPC codeや任意の数値をHTTP statusへ転記しない。

## 検証

- missing broker回帰を修正前に実行: **0/1 PASS**（既存errorにdiagnosticがなく想定通りRED）。
- 候補修正後、同じ回帰: **1/1 PASS**。
- 最終: 新規診断36件 + 既存stdio3件 = **39/39 PASS、失敗0**。
- 成功戻り値、全検証分岐、検証順序、IO call順/回数、HTTP数値の範囲、エラーcause/payload/code、未知error/getter、診断偽装/改変、ログ出力0、秘密形状の値がserialization/inspect/診断へ混入しないこと、公開MCPのgeneric numeric拒否維持を確認。
- fake IOと既存memory/dummy codec/fake providerのみ。HTTP呼出0、listener0、real helper再試行0、OS暗号/native試験0、資格生成0。公開固定dummy値だけを使用した。
- 変更mjsのNode構文検査を実施。一般npm test/full build/native/OS試験は選定していない。型宣言や既存import/signatureは変えず、JSの診断抽出exportを追加した。影響するstdio経路はtsxを使う既存dummy回帰で確認した。

自己レビューでは既存の許可/拒否条件と順序を比較し、診断情報以外の認証挙動を変える差分がないことを確認した。残る必須指摘なし。IO例外のraw messageを固定messageへ置き換えるのは診断出力の変更であり、成功/拒否の結果は変わらない。

## 実原因を特定する最小の観測手順（今回は未実施）

1. **後続で明示承認された場合だけ**、候補hashとDの元helper hashを照合し、診断moduleだけを適用する。server/broker開始方式やサービス復元は変更しない。管理helperを読む新しいNode processで利用するため、Consoleの再起動は不要。今回の候補は未適用。
2. 既存の正規server-manager `managedResumeBroker({directory:既存Console dataDirectory})` を **1回だけ** 呼ぶ観測を用意する。独自HTTPや手動token読取へ切り替えない。catchでは `managedResumeDiagnostic(error)` の2項目と固定outcomeだけを保存する。errorそのもの、stack、message、payload、descriptor、cookie、proof、stateをlogしない。
3. reasonで止める。broker_not_advertised/200なら、その観測時に正しく検証されたidentityにbroker広告がなかったことが確定する。identity_response_unavailableなら応答不成立、identity_proof_invalidならidentity検証失敗、broker_signature_invalidならbroker bindingの失敗であり、それぞれlistener未開始と混同しない。
4. brokerが取得できても、結果はverifiedという固定outcomeだけにし、そこで終了する。MCP get/claim/resume/renew/view/requestや資格復元、本人login、作成へ自動的に進めない。拒否時の再送・別経路fallbackも行わない。

この1回の観測で確定できるのは**helperの失敗分岐**。broker_not_advertisedの場合でも、serverのOFF/未listener/終了途中のどれかは現行identityに個別flagがなく完全には分からない。稼働sourceのenabled設定と記録済みの再起動/owner-login有無を合わせて判断する。それでも区別が必要なら、別途承認された診断として非秘密の状態enumをserver側に加える検討が必要で、今回そこを推測して起動動作を変更していない。

## 適用状態と残る範囲

既存の実失敗のreasonはgenericしか残っていないので、**今回のdummy成功で実原因が確定したとは言わない**。対象1件復元、broker開始、耐久handoffの設計/挙動は実装していない。新規申請・実client接続・実作成も0回。

候補の2ファイル、candidate.patch、candidate-manifest.json、source-preservation.json、RED/GREEN/TAPとverification.jsonを同梱する。Dのpublic baseline139ファイルが開始時と一致することを照合し、既存未コミット変更を保持した。実環境のhelper再試行・資格操作・本番適用・再起動は全て0。画像0、UI操作0、本人への追加質問0。pi-warden作業なし、commit/push/publishなし。
