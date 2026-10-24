# provider 骨格の固定計画

対象はこの独立 Temp。現在の D v0.5.2 / HEAD 23815ba260320e3fc720ad3288ca89728f99b4f7 の public source 315件を現在値でコピーし、全315件が前回と一致。dirty status と前回 seal229件も保存・照合した。現repository source・dist・config は変更しない。実serviceの稼働状態や現在のjob数は確認しておらず、停止済みとは断定しない。試験はサービス状態に依存しない。

今回の成果は「実 provider がないと拒否する骨格」「固定公開ベクトルだけを受け付ける memory fixture」「既存 copied Folder/ContinuationBridge との契約試験」。OS protected vault と durable store を実装・操作しない。実 credential の発行・読取・保存・配布、grant有効化、daemon操作、実接続、本番適用は0。pi-warden は一切対象にしない。

vault と epoch を独立ファイルへ順番に保存する案では、片方だけ確定する窓ができる。このため fixture 内では一つの state revision の CAS で **epoch / current renewal hash / used hashes / committed receipt** を同時に変更する。receipt の prepare は未確定 intent、epoch.advance が唯一の commit点、vault.commit は既に確定した receipt の確認だけとする。clock floor も同じ fixture store に保持する。現在の Folder runtime key swap とこのstoreの間が OS を越えた原子 transaction になったとは主張しない。

同一 request の再照合、revision/epoch CAS、使用済み renewal、期限、明示解除、clock rollback、競合、read/CAS失敗を拒否・停止する契約を置く。CAS応答喪失は結果不明として provider object を停止し、新しいobjectと正しいreceiptで照合する。未確定 prepare を新しいobjectが見た場合は familyをblockedにして復旧推測をしない。blocked familyをseedで再有効化しない。fixtureのobject交換は、同じmemory storeを読む模擬再起動に過ぎず、OS durability・rollback防止・restart attestationの証明ではない。

既存の owner確認、client identity、approval revision/binding、issuer、runtime、vault、epoch は責務を分ける。今回は sender/issuer は既存の明示fakeのみ。default skeletonはunavailableで、clientInfo/opaque process ID/親許可から本人や全run/history/final本文公開を導かない。期限とowner revokeは既存Bridgeのcheckを通し、tokenだけの更新でscopeを広げない。

現公式 source 10995608eeefac930f7199bccbb146378f883de8 は child exit/EOF/write failure→daemon shutdown。無停止child交換・二重daemonは計画に含めない。固定binary↔sourceはUNKNOWNのまま。将来の実更新は対応を確定した後、必要な初回一度の旧daemon終了確認→新daemon一つ起動を本人が具体差分に承認する。今回起動/停止/接続はしない。

受入は focused RED→GREEN、pure contract と copied Folder の metadata-only dummy。通常npm testはnative/SDK/OSケースを含むので実行しない。Web UI変更がないため画像0・UI操作0、HTTP listener0・filesystem repo作成0。TypeScriptのimport/type surfaceが増えるため9〜数件のfocused noEmit検査を行う。fixture storeの作成/破棄と試験child終了をrun単位に記録する。成果物ZIPを展開して同じ受入を確認し、source/dirtyと前回成果物の不変を再照合する。

今回の限定条件で実装選択は確定済み。Brainstormingの追加承認ゲートはNOT_APPLICABLE。Ludi TDDとHigh-Risk Code Reviewを適用する。
