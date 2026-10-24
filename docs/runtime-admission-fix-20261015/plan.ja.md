# runtime admissionの窓だけの隔離修復

旧seal589とD source315/dirty15を保全・照合し、新Tempコピーだけを編集。A/B、anchor、実source、store、OS crypto、実key/grant、daemonへ進まない。

認証済みcurrent renewalの確認後、runtime admissionを同期的に閉じて既存処理の排他境界へ入る。issuer/stage/receipt保存/epoch保存/整合確認中は旧新keyを受理しない。最後の確認後に同じFolderMcp排他内でroles/epochとadmissionを同期切替。例外・結果不明・disposeは閉じたまま失効させる。初回bootstrapも保存完了まではclosed。新instanceへ旧keyは復元しない。

RED: issuer await中に旧keyが通る試験。修復後に各await、保存前後failure/unknown、queued call、bootstrap、新instanceの境界試験を追加。既存60試験の旧negative control一件を拒否regressionへ更新し、他のrollback/approval/binding/continuity不足は維持して確認する。選択testと型検査、所有file/process終了、未適用ZIP、狭い差分を納品。
