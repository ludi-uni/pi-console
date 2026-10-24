# 限定review

新restart-contract.ts（mock判定）、runtime-delta.test.ts、source text auditを自己review。実装範囲は継続/rollbackの不足確認まで。

必須の実運用blocker:
- 高: file-fixture-store.ts takeOver/CAS は旧headそのものの巻戻しを検出しない。公開dummy negative controlでrevokeが消えた。独立anchorまたは再起動後再承認fallbackが必要。
- 高: folder-integration.ts runtime.activate（単一行のactivate定義）でapp.activateContinuationがepoch.advanceより先。途中で新keyが通ることを実証。catch/revokeはprocess crashを防がない。
- 高: integration-fixture.ts approvals Mapとsender fake、file-fixture-store.ts publicFixtureBinding定数。実binding/approval/continuityの実装とは扱えない。
- 中: D server/folder-mcp.tsに4つの再開メソッドがなく、fixtureを実runtimeへ繋ぐAPI自体が未適用。source-contract-audit.jsonのsha/lineを参照。

今回修正/追加した範囲:
- restart-contract.ts: anchor missing/unknown、digest/sequence/binding不一致、revoked/prepared、expiry/clock、承認/peer/runtime不明を拒否。実運用readyは常にfalse。
- runtime-delta.test.ts の初回restart試験はfixture時計の初期値が旧floorより過去でclock_rollbackに先に止まった。同じ進行時刻へ合わせ、approval未復元を独立して検証した。失敗logは保全する。

mock factsはreal providerからの証明ではない。headとanchor両方の復元を許すnegative controlもあり、mock合格を実rollback耐性と一般化しない。この限定契約内の追加必須修正はなし。blocker本体は次の限定実装・OS/anchor受入・本人承認の担当表に分離した。
