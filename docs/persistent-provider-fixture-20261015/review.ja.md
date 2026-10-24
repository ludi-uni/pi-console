# 自己review（ludi-code-review）

対象: file-fixture-store.ts、provider-skeleton.tsの隔離差分、file-provider/file-integration契約。実source未適用。

修正済の必須指摘:
- 中: file-fixture-store.ts save のrename後、一時fileの所有記録を二度削除すると成功後にも例外になる。finally一か所で片付ける形へ修正し、再openと全保存fault試験で確認。
- 中: JSON parse の例外に入力断片が出得るため、head/decode両方で固定errorへ変換。破損JSON・body改変試験で確認。
- 型検査の6診断（never制御フロー、union絞り込み）は修正。14inputs/noEmitの診断0を確認。
- 中: file-fixture-store.ts FileFixtureDirectory constructor の再openが、別writer保存中のpendingを所有不明と判定し、競合helperが異常終了した。再openで他writerのlock/pendingを所有物に取り込まない形へ修正。cleanupは未知entryがあれば削除前に拒否。決定的なpending+lockの試験と2 Node同時CASで確認。
- 追加client-B試験の型注釈不足2診断を修正。最終結果はaffected-typecheck.jsonに記録する。

未解決の実運用blocker（fixtureの欠陥修正要求と混同しない）:
- 高: file-fixture-store.ts codec は可逆XOR+checksumという公開dummy用mock。実秘密保護はない。実運用に接続してはならない。fixture receiptで公開固定vector以外を拒否し、default providerは unavailable のまま。
- 高: Head全体の古い正常snapshotへの外部巻戻しを検出する独立した保護anchorはない。clockFloor/fence/usedhashも同じblob内。mockや一般file atomic renameだけで解決したとは主張しない。
- 高: copied Folder runtime切替とfile epoch更新の間に分散transactionはない。ack喪失時はruntime解除+unknownで閉じる。別Node読戻しはkey/epochの復元だけで、実daemon/approval/sessionの再開を実証していない。
- 中: wx lockがprocess crashで残れば拒否を継続し、自動奪取しない。Windows power-loss/rename永続性、native reparse・親差替え競合、ACLは未検証。試験専用所有Tempの短時間並行更新だけを確認。

本dummy契約の未修正必須指摘はなし。実運用readinessは引き続きfalse。追加cleanupや別subsystem修正は行わない。
