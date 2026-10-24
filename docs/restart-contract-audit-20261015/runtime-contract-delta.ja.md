# 実runtime接続の契約差分

source-contract-audit.jsonはDから保全したpublic source6ファイルをtextとして読んだ証拠。runtime/native moduleはimportしていない。Dのsource全315は前段階と一致。以下は未適用のfixtureと実sourceの差である。

| 項目 | 現在の実source / fixture | readyに必要な変更・証拠 | 担当 |
| --- | --- | --- | --- |
| runtime lifecycle | D server/folder-mcp.tsのconnections/reviews/resultsはmemory。再開用continuationSnapshot/stageContinuation/activateContinuation/invalidateContinuationの4メソッドはDにない | stage・commit・invalidate・startup reconcileを実runtime内部のadmissionと同じ排他境界で実装。既存exact read/control/final契約を維持 | Codexが次の限定実装として作成・dummy検証、本人が実反映を承認 |
| commitの窓 | folder-integration.ts runtime.activateはapp.activateContinuation後にepoch.advance。今回awaitを止めるとruntime epoch2のkeyが通り、保存はepoch1・receipt preparedだった | epoch/anchor commit前と回復中は新規管理admissionを閉じる。起動後不整合時は旧新双方を拒否。単にcatchで後からrevokeするだけではprocess crashを扱えない | Codex。今回は窓のnegative controlと判定契約だけ作成、runtime本体の修正は未実装 |
| 本人approval | integration-fixture.tsのapprovals/bootstrapsはMap。新instanceはapproval_unavailableで拒否する | approval revision/state/expiry/noneConsentとbindingを保護保存。revokeとkey/epochの関係、結果不明の回復を定義する | Codex。本人はgrant/無期限選択を明示 |
| binding対応 | FileFixtureAtomicStoreはpublicFixtureBinding定数。compositionのApproval.bindingとはclient/resource表現も異なり自動照合しない | 唯一の正規化mappingを作り、owner/client/resource/root identity/scope/tunnel/generationとapproval revisionを保存・照合。複数client間を分離 | Codex。本人は許可する親folder・操作を選ぶ |
| sender continuity | fixtureは固定proofと自己申告evidence、isCurrentのfake。attested-restart文字列だけで世代変更が通る | trusted private channelのclient instanceと旧新世代の連続性を検証。対応MCP clientで確認し、未確認client機能を約束しない | Codexがadapterとdummy証拠、本人が実client確認を承認 |
| protected store | codecは可逆mock。vault.protected=trueは旧fixture型との互換markerだけ。D profile保存の実dataは読んでいない | reviewed OS vault adapterとowner binding、秘密非露出、原子的保存、失敗時の拒否を統合する | Codexがsource/mockまで。OS専用dummy受入は本人の範囲承認後 |
| rollback anchor | head/fence/clock/used/revokeは同じblob。正常な旧blob復元で解除が巻戻る | threat-model記載の独立anchorか、bootを跨がない明示fallbackを選択 | 本人が方針選択、Codexが契約と実装。外部serviceなら別の接続・操作承認 |

server/trusted-local-mcp.tsの別既存契約はper-process randomUUID epochであり、この新しい永続familyの代わりではない。server/local-owner-profile.tsのenabled:false保存も、自動復元のOS保護やreadyを意味しない。既存経路を黙って置き換えない。

必要な実runtime APIは概念的に `quiesce(connection) → validate(binding, approval, parent, sender, anchoredState) → stageClosed → durableCommit(head, anchor) → recheck → admit(epoch)`。失敗/不明は `invalidate + remainClosed`、起動時は必ずclosed。プロセス間の古いwriterをfenceし、再送は同じrequest/fingerprint/approvalRevision/epochと2分回復期限内だけで照合する。部分完了時にkeyを再発行して解決したとはしない。

これは実APIの実装ではない。今回追加restart-contract.tsはmock factsの判定のみで、実store、daemon、listener、clientや鍵を操作しない。fixtureOpenAllowed=trueとrealConnectionReady=falseを別項目として返す。
