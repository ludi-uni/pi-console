# High-Risk Code Review（自己レビュー）

対象は provider-skeleton.ts とこのcopyの integration-fixture.ts の差分、契約・dummy結線試験。外部 MCP tool/catalog/protocol、live server composition、Pi/SDK/extensionsは変更していない。

必須 finding（修正済み）: takeover後の旧provider objectを拒否するfencingがなく、模擬再起動後も旧担当がfamilyの読取・変更を続けられた。位置は `provider-skeleton.ts:36` / `:63` / `:78`。`fencing-red` は18件中17通過・この1件失敗。memory coordinator generationを初回操作で取得し、inspectとCASの双方で一致を検査するよう修正。修正後の全受入26/26で旧担当の拒否を確認した。これはfixtureでのfencingであり、実process間のdurable fencingではない。

入力はexact schema、既知の固定公開hex vector、独立role、epoch整合、current/used hashを検査する。receiptやsnapshotはcloneを返す。default providerは`ready=false` / `realConnectionReady=false`でconnectを拒否する。fixture factoryはMemoryFixtureAtomicStore以外を受け付けない。外部設定、HTTP、env、profileによるactivationはない。

legacy VaultPort の `protected:true` は旧fixture compositionとの型互換のためだけに存在する（provider-skeleton.ts:83）。OS保護を実装・確認したという意味ではない。fixture readinessをreal readinessに変換しない。実providerとしての配布・登録・本番importは行わない。

epoch.advance が同一state CAS内でepoch/current hash/used hash/receipt確定を更新する。vault.commitは確定結果の照合。応答喪失はobjectを結果不明として止め、次のobjectはexact receiptから照合する。prepareだけが残ればfamilyをblockedにする。clock floorは同じmemory storeに保存される。revoke/rollbackはblockedを残し、seedでは復活させない。

copied Folder runtimeのkey swapとstoreは別の境界であり、その全体のOS crash atomicityは未証明。store更新の応答喪失後、Bridgeが実際のcopied Folderをrevokedにし、provider invalidationの不確実さを`credential_invalidation_unknown`と報告することを確認。新しいkeyでmetadataを取得できるという成功にはしない。

検証制限: writer generationは同じNode process内のfixture counter、storeはmemoryだけ。OS再起動・disk rollback・multi-process lease・OS protected vault・handle security・実sender attestationを証明していない。identity/approval/issuerは以前の明示fakeのまま。grant bindingはBridgeの本人/actor/scope/revision検査に委ねる。実backendではこれらとcommit/revokeの競合も受入が必要。

fixture上限はfamily16、receipt64/family、used hash16384/family。上限超過は拒否し、古いrequestを忘れて自動再承認しない。長期・明示noneの本番連続運用能力やgc方針は今回の骨格の証明対象ではない。

試験記録: 最初のREDにはconstruction試験のcleanup hook登録順の不備があり、13個中12個のmemory modelだけがdisposeを記録した。登録順を直した`contract-red-fixed`以降は全modelを破棄。最初のREDもNode childはexit=1で完了し、HTTP/OS resourceは一度も作成していない。初期REDログ・所有記録を消さず保持する。

修正後、今回の限定範囲に残るactionable findingはない。上記制限が残るため実providerや実接続のPASSとはしない。
