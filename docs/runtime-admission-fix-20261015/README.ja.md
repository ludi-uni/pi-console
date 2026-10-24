# runtime admission修復 — 隔離fixture・未適用

保存完了前に新keyを受け付ける窓を、実鍵・実store・OS暗号へ触れず修復した。A/Bの本人判断、anchor選定・導入、本番反映は進めていない。

## 変更
認証済みcurrent renewalの確認後、admissionを同期で閉じる。issuer→stage→receipt準備→epoch保存→provider/approval/sender/clock/receipt再確認の間は旧新keyのtools/call/claimを拒否する。切替はFolderMcpの同じserial契約内で行い、最後のguard・key/epoch更新・openの間にawaitを置かない。

closed中のcallは受信時に拒否し、保存が終わるまでqueueで待たせて後から通すことも防いだ。保存失敗/結果不明/最終確認失敗/provider後処理失敗はclosedのままrevokeする。bootstrapも初回保存完了までclosed。新runtimeは旧keyを自動復元しない。

## 検証
- 既存60＋新規境界32＝92試験。既存60のうち、以前の「保存前に新keyが通る」negative control一件を拒否regressionへ更新し、旧版の証拠はseal589のまま保全した。
- 新規32はquiesce、issuer、stage、prepare、advance前後、approval再確認3地点、commit前後、最終sender/clock、provider前後の待機と、保存failure/unknown/expiry/invalidate/dispose/parent/bootstrap/startup/再送を含む。
- scoped strict typecheck18inputs/noEmit。最終結果、ZIP再現、fixture・process終了件数はresult.json。
- UI操作/画像0、HTTP listener0、実key/grant/実store/OS crypto/daemon操作0。pi-warden調査・変更・再試験0。

変更した実装は continuation.ts、folder-integration.ts、work/server/folder-mcp.ts。fake hookはintegration-fixture.ts、更新回帰はruntime-delta.test.ts、新試験はadmission-boundary.test.ts。狭い差分はchanges.patchとchanges.json。

## 適用状態と残課題
実装はTemp/ZIPのfixtureだけ。D source315・tracked dirty15を維持し、source/dist/Startupは未反映。realConnectionReady=false。

旧正常blob復元、approval永続化/binding mapper、実sender/vault/runtime接続、native parent安全性は完成していない。92試験を実rollback耐性・実運用readyと一般化しない。A/Bは本人回答待ちのまま、実runtime本体の修復や独立anchorの実装へ範囲を広げない。

## 再現
ZIPを新所有Tempへ展開し、既存D node_modulesのtsx/TypeScriptを使う。全test/native/SDK/本番buildは実行しない。

    node run-selected.mjs reviewer provider-contract.test.ts provider-integration.test.ts file-provider.test.ts file-integration.test.ts restart-contract.test.ts runtime-delta.test.ts admission-boundary.test.ts
    node check-admission-types.mjs

labelは未使用名を指定。追加境界試験はmemory storeとfake provider、既存60のfile試験は公開dummy所有Tempだけを使う。実credentialを生成・読取・保存していない。
