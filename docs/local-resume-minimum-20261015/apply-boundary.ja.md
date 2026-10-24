# 実装・未適用・次の境界

今回変更したのは所有Tempのsource/fixtureとDの納品docsだけ。D source315・tracked dirty15、旧seal608を保全する。本番source/dist/Startup/daemon/既存profile/実key/grantへ触れない。

実装済み:
- local-protection.ts: CurrentUser保護portのfacadeとowner/purpose entropy、default未接続、公開dummy fake。plaintext fallbackなし。
- local-protected-store.ts: 承認/credential/epoch/revoke/操作receiptの一体snapshot、排他CAS、同directory temp write/fsync/rename、unknown処理。
- local-resume-fixture.ts: 既存owner revoke/result、bootstrap、private proof、通常再起動・内部rotationを隔離compositionへ結合。期限を維持し、再承認不要の経路を確認。
- work/server/folder-mcp.ts: trusted restoreのclosed→検証→openと、操作receiptの保存hook。HTTP/MCPへ復元APIを追加公開しない。

**実OS DPAPI providerは未接続。** dpapi-current-user.tsにCurrentUser専用sourceを準備した。既定はOS実行拒否で、stdin/private pipe・秘密のargv/エラー非露出・fake transportだけを5試験で確認。実helperの起動・DPAPI API呼出しは0。 facadeの試験はpublic dummy portだけで、fake codecは暗号ではない。以前のProtect1/Unprotect3の成功記録は再利用し、今回OS暗号を再実行していない。この新format/entropy/storeと実DPAPIを統合した受入はまだ行っていない。

このZIPはfixture-onlyのpublic vector/容量上限を持ち、そのまま本番providerとして有効化できない。実profileのformat/移行、実credential issuer、実CurrentUser保護adapter、managed instance/実client handoffのsource接続と受入が必要。fixtureの64 receipt・公開vector上限を本番の承認期間/通常更新制限には転用しない。外部正本導入の判断は不要。

changes.patchは前段階の隔離fixtureとの差分で、D HEADへ直接適用するpatchではない。Dへの適用候補はcurrent sourceを基準に累積機能を統合し、別途reviewする必要がある。今回source applicationは0。

次に実接続を具体化する場合も、まずreview可能なproduction adapter/保存先/入口とdummy受入範囲を用意する。候補の保存先は既存dataDir配下の専用versioned encrypted blobであり、今あるmanual-key profileを読んだり上書き・移行したりしていない。本人が新たに明示する連携開始から保存/有効化する。

実CurrentUser adapterのOS専用dummy、実profile書込/資格生成、実grant、MCP/provider有効化、実client接続、本番反映・再起動は今回未実行。現段階で実運用承認を一括要求せず、この境界で止める。sourceの機能受入と実資格を使う操作は区別する。
