# 外部世代・失効正本: 設計とoffline仕様確認

本人承認の「再起動時ネット必須、外部世代/失効情報を正本」に沿って設計した。service/account/資格情報/ネット設定/本番sourceは作成・変更していない。

design.ja.mdに全体、authority-contract.ja.mdに正本CAS・短命lease・状態機械、next-work.ja.mdに担当と実装残を保存した。新sourceはonline-authority-spec.tsと21仕様試験だけで、実通信や実keyを扱わない。

正本はDB復元対象と独立したlog/control registerを要求し、通常DBは検証済projectionとする。CASはowner/device/family/binding・expected epoch・approval revision・recovery epochで一度だけcommit。leaseは最大60秒、更新目安20秒、timeout5秒。bootはcached leaseを拒否しfresh online再照合が必須。ネット失敗を検出したらclosed、未検知の遠隔失効はlease期限まで残り得る。

通常の通信復帰は有効なdevice/approvalのまま自動再照合し、人にkey3本を作らせない。DB不整合は発行停止、独立recovery epoch更新・正本再構成を運用担当が確認する。端末資格/承認失効・親/peer不一致は自動復帰させない。全MCP clientの自動再接続能力を約束しない。

既存92＋仕様21＝113試験。既存92の実装は変更していない。20inputsの限定型検査/noEmit。最終件数、ZIP再現、fixture/process終了、source保存の結果は納品docsのresult.jsonを参照。UI操作/画像0、実通信/サービス/資格/OS暗号/本番変更/実key/grant操作0。pi-wardenには触れていない。

実正本の耐久性や認証、実runtimeへのlease guard、OS vault、実clientは未実装・未検証。root自体も同時に巻戻せばmodelの失効は消えるnegative controlを含む。113試験を実rollback耐性の完成とは扱わず、realConnectionReady=falseを維持する。

再現はZIPを新所有Tempへ展開し、既存D node_modulesを使用する。全test/native/SDK/本番buildは実行しない。

    node run-selected.mjs reviewer provider-contract.test.ts provider-integration.test.ts file-provider.test.ts file-integration.test.ts restart-contract.test.ts runtime-delta.test.ts admission-boundary.test.ts online-authority-spec.test.ts
    node check-online-types.mjs

labelは未使用名を指定。通常Node helperは既存92の公開dummy file試験だけ。新21は純粋なmemory metadata modelで、HTTP/OS entry/暗号vaultを起動しない。
