# 限定した再開契約・巻戻し確認

現在の46試験を実rollback耐性の完成とみなさない。旧成果565ファイルのsealとD source315/dirty15を照合し、新所有Tempへcopyする。旧封印成果や本番sourceを編集しない。

1. 公開dummyの正常な旧blobを復元し、現file fixtureでrevokeが巻戻ることをnegative controlとして記録する。
2. 独立anchorがあると仮定したmock再開判定を実装。anchor欠落/不一致/不確実な更新、expiry/owner・scope/parent不一致、runtime未整合を拒否する。fixture許可とreal readyを区別する。
3. copied runtimeのactivate→epoch保存の間をpromiseで停止し、見える権限とpersisted stateの差を実証。approval/runtimeを丸ごと再開する実APIがDにないことをsource読取で確認する。
4. 選択mock試験、関連型検査、自己review。脅威モデル、fail closed表、実runtime契約差分、担当と不足条件、具体的な本人承認操作を保存して止める。

OS暗号/外部anchor/本番daemon/実key・grant・clientを呼ばない。新native入口も読込み実行しない。fileは所有Tempの公開dummyだけ。UI/画像0。段階の実装はruntime本体へ広げない。
