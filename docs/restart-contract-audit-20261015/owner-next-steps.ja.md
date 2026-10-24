# 本人の操作が必要になる地点

今回の作業はここで止める。OS暗号・実store・anchor・実key/grant・本番source/daemonの変更は未承認・未実行。以下は次の承認を具体化する資料であり、今このまま実行する依頼ではない。

1. **本人: 再起動時の扱いを選ぶ。** 独立anchorなしで「本人browser再確認→新family」のfallbackにするか、再起動後の自動復元を求めて独立anchorを導入するか。どちらでもランダムキー3本を人に用意させない。anchor未選択のまま無操作復元は約束できない。
2. **Codex: 次の限定sourceを作る。** 選んだ方針のanchor port/OS vault adapter、approval保存とbinding mapping、実runtime admission barrier・startup reconcile、sender continuityを小さい差分に分け、mock受入と入口・変更file・回数上限・cleanupを先に提示する。これは実反映の承認とは別。今回それらを無制限に実装しない。
3. **本人: 必要なら統合OS dummy受入だけを明示承認する。** 将来の候補targetは `PiConsole.RestartAcceptance.PublicDummy.v1`、新所有Temp内の `head.blob` / `pending.blob` の2pathのみ、公開dummy snapshotを2回保存する単独adapter試験。上限はProtect2/Unprotect4、helper2、30秒、network0/実store0/実credential0。新しいreview可能な入口を作るまではこの候補を実行しない。通常終了・例外時ともhandle close、2path削除・空directory確認、正確なPID終了を出力する。以前の成功DPAPI受入は再利用し、この候補を今回再実行しない。これだけでは独立rollback耐性は合格にならない。
4. **本人: 自動復元を選んだ場合だけ、独立anchorの実体・境界と操作を承認する。** 現時点では対象service/account/OS anchorが未選択なので、接続・設定・credential・費用・実checkを一括承認できる状態ではない。選択後に、専用dummy namespace、一度のcheckpoint/revoke/CASと旧snapshot拒否、実data非接触、削除/保全、回数上限を具体化して別承認を取る。隣接fileやDPAPIだけをanchorとして代用しない。
5. **本人: 実運用反映は最後。** 実反映差分と受入結果が揃ってから、停止中確認、source/dist/Startup反映・必要な再起動を承認。その後本人browserで許可folder/操作/期限を選び、実key保存・grant・MCP有効化・対応client接続を明示する。今回のZIPやmockを実providerとして適用しない。

本人に求めるものを「すべて完成したので起動ボタンだけ」と誤表示しない。runtime admissionとapproval/continuity等にはCodex側の実装残がある。今回の到達点はその不足を具体化したmock契約・negative control・実source差分である。readyをtrueにするには各行の実装・検証と本人承認が全て必要。
