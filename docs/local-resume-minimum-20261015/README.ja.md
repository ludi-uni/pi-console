# ローカル端末保存・通常再起動復元 — 隔離実装

外部正本/60秒leaseを必須から外し、CurrentUser DPAPIを想定した端末保存＋ローカル失効＋通常再起動の自動復元を実装・dummy検証した。**実Windows providerは未接続、本番未適用。** Fake codecを暗号と呼ばない。

design.ja.mdに最小仕様、apply-boundary.ja.mdに実装場所と未実行操作、review.ja.mdに確認内容を保存。承認期限は7日/31日/本人明示の無期限のまま。内部credential更新や再起動で勝手に延長短縮せず、通常更新で再承認を要求しない。browser管理cookieは復元しない。

通常再起動で同じ承認/keyまたは期限切れ内部keyの更新を復元。破損・期限切れ・Windows本人/owner/client/親identity不一致・未完了保存はclosed。既存owner revoke/result入口から永続解除と応答喪失の照合を行う。操作intent/receiptも保存し、再起動後の作成要求の二重実行を防ぐ。

新44試験＋既存admission等92＝136試験。25inputsの限定型検査/noEmit。実資格ではない公開dummy vector・fake provider・所有Tempだけを使用。通常update/restart、期限維持、複数client、revoke、corruption、保存失敗/unknown、closed境界、操作receipt、whole-store rollbackのnegative controlを含む。最終ZIP再現とfile/process終了件数は納品docsのresult.json。

全storeの古い正常backupを戻せば解除が巻戻り得る。同権限悪意processやOS/admin侵害への隔離も保証しない。この残リスクを受け入れる個人ローカル仕様であり、独立正本を必須に戻さない。

実DPAPI/資格情報/既存profile/本番source/dist/Startup/daemon/provider/実clientは操作していない。pi-wardenに触れず、UI操作/画像0、実repo/git/workspace作成0。fakeのmemory action counterと実操作は区別する。

再現は新所有TempへZIP展開し、既存D node_modulesを使用。全test/native/SDK/本番buildは実行しない。

    node run-selected.mjs reviewer provider-contract.test.ts provider-integration.test.ts file-provider.test.ts file-integration.test.ts restart-contract.test.ts runtime-delta.test.ts admission-boundary.test.ts local-resume.test.ts dpapi-current-user.test.ts
    node check-local-types.mjs

labelは未使用名を指定。production adapterと実資格を使う境界へ進む前に、具体差分・保存先・OS dummy受入をreviewする。現在realConnectionReady=false。
