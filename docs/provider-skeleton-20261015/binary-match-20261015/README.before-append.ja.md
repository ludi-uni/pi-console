# provider 骨格と契約試験の隔離成果物

default拒否の骨格と、既存 copied Folder / ContinuationBridge に結線する **公開固定ベクトル専用 memory fixture** を実装した。本番source未適用。実protected vault・永続backend・sender attestation・issuer bootstrapは依然未接続で、実連携の完成ではない。

実装は `provider-skeleton.ts`。`providerSkeleton()` は ready=false / realConnectionReady=false のまま connectを拒否する。`fixtureEpochVault()` は MemoryFixtureAtomicStore 専用で、epoch.advanceの一回のCAS内でepoch/current hash/used hash/確定receiptを変更する。vault.commitは既確定結果の確認だけ。copyの `integration-fixture.ts` にports注入点だけを追加し、既存のcopied Folder / Bridgeに結線した。外部MCPのprotocol・tool名・引数は変更していない。

contract-red-fixed は14件中1通過/13失敗（default拒否だけ通過）、最小実装後14/14。その後追加した模擬takeoverの旧writer拒否はfencing-redで18件中17通過/1失敗し、memory fencing修正後の最終受入は **26/26**（contract18 + Folder dummy8）。focused noEmitは9 inputs / diagnostics0。最初のtypecheckの失敗と初期REDのcleanup hook不備も記録を保全している。

確認内容はatomic head/receipt、模擬object再生成、失われた保存応答の照合、未確定prepareの停止、clock rollback、競合と二重送信、unknown/malformed入力、fixture key以外の拒否、複数client familyの独立と解除、8hへのdummy clock進行後のrotation、scope/actor不一致、owner revoke、有限expiry、31日/明示noneのgrant不変、親差し替え、copied Folderの拒否と不確実なinvalidation。

最終受入でmemory store28/28を破棄し、app11/11をdispose。HTTP listener0、OS/native/SDK fixture0、実repo作成0、実key/grant操作0。試験child6runは全完了。保持したrunner/worker PID13個は観測時点ですべて不在。これはlive Console/jobの停止確認ではなく、source/fixtureの確認である。画像0、UI操作0。

現在DのHEADは23815ba260320e3fc720ad3288ca89728f99b4f7、v0.5.2。現在値でsource315件とtracked dirty15件を保存。source315件は前回と一致し、現在のdirty statusも維持。前回独立copy seal229件とprovider audit5件も一致。source、dist、config、credentials、grants、OS vault、daemon、security設定を操作していない。pi-wardenには触れていない。

再現はこの独立copy/ZIP展開先から以下のみ。通常npm testはnative/OS/SDKケースを含むため実行しない。run labelは上書き不可なので再実行時は未使用labelを指定する。

```powershell
& 'C:\Program Files\nodejs\node.exe' .\run-selected.mjs reviewer-run provider-contract.test.ts provider-integration.test.ts
& 'C:\Program Files\nodejs\node.exe' .\typecheck.mjs
```

Node/tsx/TypeScriptは既存Dのdependencyを使い、追加installなし。test runnerは専用の最小環境を渡し、実profile/.envの読取やenv/argv dumpをしない。

制限と修正済みfindingはreview.ja.md、本人の具体的な将来承認はrequired-approvals.ja.md。公式sourceで child終了→daemon shutdown の制約を維持し、無停止交換を前提にしない。固定binary/sourceの対応はUNKNOWN。実provider・実接続・OS crash耐性のPASSにこのdummy結果を流用しない。
