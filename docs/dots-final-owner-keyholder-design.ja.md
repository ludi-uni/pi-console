# Dots final owner keyholder design

## Status

2026-10-07 16:35:37 UTCのユーザー承認による**限定的な設計変更**。今回は文書のみ。実装、grant、mount、producer有効化、キー取得/生成/入力、接続、実公開、配布・本番反映は承認しない。モデルは `openai-codex/gpt-6.1-sol` を維持。

この文書を今後のfinal-only owner設計の宛先/local構成の基準とする。先行 `dots-final-answer-contract.ja.md` のOwner operationにあるconnector 1件保証、および `dots-final-owner-boundary-result.ja.md` のconnector binding要求は**過去の契約・判断**として保全し、新契約には適用しない。先行保存/ACK/foreground/target fenceの技術条件は継承する。以下のepoch・保存・UIは次回実装の設計であり、現コードに実装済みではない。

## Principal

認証principalは、明示的に構成された**final-only専用read credentialの所持者**。宛先は「この専用readキーを持つ接続」。connector ID、clientInfo、接続名、tunnel名、端末、人、Dotsアカウントを認証・限定したとは表示しない。同じキーを別接続へ渡せば、その接続も同じprincipalとして許可範囲を読める。共有/漏洩したキーでアクセスした主体の区別、配布後のコピー防止、受信済み本文の回収は保証しない。

一度に有効な追加公開はexact run 1件、feature `final_answer`、保存/受付ACK/foreground terminal確認済み最終回答textのみ、本人指定の絶対expiry。status-only read/control許可からの暗黙公開はない。全履歴、他会話、prompt/tool raw、artifact、別workspace、control権限は追加しない。foregroundの確認は全体完了/子census/OS idleの確認ではない。

専用credentialは既存status/readonlyキーやcontrolキーのslotへfallbackしない。将来の承認済み構成時には専用slotを明示し、既に構成コードが扱うcredentialとの同値が確認された場合は拒否する。専用性・有効な認証構成を確認できない場合もblocked。確認のために今回実キーを読まない。既定OFFの構成ではcredentialを自動発見・読取しない。UIにキー/任意URL/callback入力を追加しない。

## Credential lifetime

最小構成は認証設定をactivation中に固定し、hot rotationや一般credential registryを作らない。承認された構成コードがactivationごとに非秘密・キー非派生のopaque `credentialEpoch` を割り当て、final grantをそのepochへ結び付ける。キーそのもの、その一部、fingerprint/hashをID/UI/ログ/保存grantに出さない。opaque epochも配布先・OS本人の証明ではなく、server内部の失効fenceである。

キー変更/削除/旧キー失効では旧adapterをdisposeし、旧epochのgrantとreview capabilityを無効にする。新credentialへのgrant移植はしない。同一キーの再設定でも新activation/restartは新epoch・新instanceとなり、保存recordから許可を復活させない。旧recordは無効な履歴/保存結果照合にだけ使用し、再公開には新しいowner reviewが必要。変更・失効結果不明なら公開を停止する。解除だけでは盗まれたキー自体は無効化されないので、credential失効とgrant解除を区別する。

失効・期限・generation・instance・revision・epochを毎readの入場時と全I/O後のrelease fenceで検証する。解除は既存admission直列化に従う。解除完了後の新readは拒否し、既に許可されて送信済みのbytesは回収できない。保存失敗で以前の許可へrollbackして公開を続けない。

## Local scope

owner管理は**Access未有効の既存local構成**で、既存Host/Origin/Fetch Metadata/native socket/no proxyの管理経路だけを用いる。MCP readは既存dedicated-key認証とnative guardを維持する。local-onlyはこのserver側の入口制約であり、キー所持者がすべて同一PCにいるという保証ではない。転送経路が既存native guardを満たさなければ拒否する。

loopbackやlocal GUI通過はOS本人認証ではない。workerとownerが同一SIDで管理資源を変更できるリスク、ローカルコードによるowner境界の問題は未解消。今回の承認から、それらの本番リスク受容を推測しない。`controlIsolationVerified()` はfalse、制御・更新拒否は維持する。

Access有効時はfinal-only owner機能をblockedにする。Access設定をOFFへ変更せず、既存gateの順序・header・例外を変更せず、manage APIや別listenerへ迂回しない。Access owner対応は別判断・別承認。実構成を読むことなく、渡された構成状態が不明/不整合でも有効化しない。

## UI

将来の画面は既存WorkspacePermissions UIの独立した「最終回答textの追加公開」。既存read checkboxとは別の選択・review・確認・解除とする。権限内の登録済みexact targetと保存状態だけを表示し、未観測/曖昧/古いgeneration/ACK不明/保存不確定/期限切れは選択不可。公開前にpromptやtool raw、無関係な会話をpreviewしない。

review文言:

> このrunの保存確認済み最終回答textを、専用readキーを持つ接続へ、指定期限まで公開します。同じキーを別接続へ渡すとそこからも読めます。connector・端末・本人を限定する許可ではありません。

確認項目はexact target、公開データ、宛先=keyholders、絶対expiry、既存許可からの変更/解除だけ。キーやキー派生IDを表示せず、専用read認証の利用可/不可・許可状態だけを示す。今はこの画面/操作手順は存在しない。

## Next implementation

connector binding blockerは新要件によって解消し、一般connector registryは不要。**次回の別承認があれば**、既存local構成・専用Temp/dummy認証で owner review → final grant → 同じ通常server構成のproducer/journal/adapter → pin binary read → revoke の隔離実装へ進める設計候補とする。現時点の動作合格ではない。

追加grantは既存WorkspacePermissionsのCAS/lock/atomic保存を拡張する小さなfinal-only recordとし、base permission revisionとの別file二重commitは避ける。旧schemaはfinal grantなしとして読むだけで、自動migration書込をしない。recordはexact target、feature、expiry、epoch、保存要求ID/結果を保持し、本文/秘密は保持しない。base許可は別途必要で、追加公開確認だけでbase scopeを増やさない。許可置換は前のexact runの解除をreviewへ含め、複数runへの積み増しをしない。

reviewは短期・一回限り、instance/revision/target/generation/epoch/expiryへ固定。保存のCAS・対象再確認・expiry確認を同じ直列化境界で行う。request競合は拒否、同じ保存要求の再読取は結果照合だけ、応答喪失は未確認として自動再送しない。保存中の画面離脱/キャンセルがcommitを取り消したとは表示しない。キャンセルは未送信変更を破棄し、結果不明は再読取、解除は別の明示commit。restart/epoch変更では保存済みでも無効とする。

通常serverへ既定OFFの同一構成を配線し、Access有効/認証未構成/不確定時は拒否する。古いendpoint、status/control認証、keyless native許可へのfallbackを作らない。actorを起動しないpassive readと、承認されたsourceでのproducer opt-inを分離する。

独立して残るものは、未実装の保存/epoch/admission/route結線とその検証、実構成の専用credential供給の別承認、OS本人・同一SIDリスク、およびAccess非対応。本番で「認証済み本人による安全なgrant」と主張するには既存local管理境界で何を受容するかの判断が別途必要。それを新broker/OS sandboxで解消する実装は今回/次回候補へ含めない。専用認証の供給やlocal gateが成立しなければ、その点で停止する。

## Acceptance

次回は実SDK public SessionManagerのdummy保存＋既存dummy lifecycleの限界を維持し、実provider応答ではないと明記する。

- desktop/mobileでexact target/データ/keyholders/expiry review、取消、保存中離脱、保存失敗、応答喪失・再読取、CAS/request競合、失効/解除/restartを確認する。
- 同じ通常server構成のrouteで、pin実binaryによる本文結合・UTF-8/hash一致、その後の解除/expiry/epoch変更/foreign target/旧scope/旧endpoint拒否を確認する。
- 同じdummy keyの別clientInfoは同principalとして扱う意図した性質。異なる/旧key、未構成認証では本文拒否。これをconnector認証合格と呼ばない。
- 読取からworker/prompt/queue/provider/外部Events起動0、secretのUI/ログ/ID混入なし、既存source/証拠保全、型/影響回帰/別出力build、default OFFを確認する。
- Access有効時は既存gateのままblocked、設定不変更。制御/更新拒否不変更。fixture終了・Temp cleanup。実キー/履歴/grant/接続/配布は使わない。

## Before operation

別承認で確認するのは **exactrun / 保存確認済み最終回答text / 宛先=専用read-key holders / 絶対expiryと解除 / 配布反映**。専用credentialの実設定・配布、実公開、同一SID等の運用リスク判断もこの設計承認とは別。報告本文の貼付を要求しない。先行65 PASS・実binary5 call/154 bytes hash一致、characterization2 PASSは歴史的証拠のまま保持し、新設計の実装合格に数え直さない。
