# 対象差分レビュー

自己レビュー。独立した第三者レビューは未実施。

- required / `package/local-resume-session.mjs` のcancelとget/begin: 取消を記録した直後、client stateを消す前の中断で再接続に戻る余地があった。取消意図を閉じるのをclient forget後へ移し、begin/getで取消を優先。承認済みclientと期限切れ記録を使う専用回帰で解消を確認。
- required / `server/local-mcp-composition.mjs` のrequest: 初回要求の再送をclientIdだけで認証しない。requestIdとprivate proof hash、nameを一致させ、同じpendingを再利用。取消・失効を新規要求にしない。受信proofもissuerの予約値へ加えて新規内部資格との重複を防ぐ。
- required / `package/local-mcp-enrollment.mjs`: 送信前の保護commitが不明なら送信しない。再起動しても新規登録へ置き換えずfail closed。既存server/client schemaを流用・移行せず別purposeとし、管理brokerの世代変更を拒否。dummyのcommit-after失敗回帰で確認。
- required / UI: 一回用codeや内部proof/tokenを設定例に含めず、通常Accessから本人cookieへ権限移譲しない。設定例はreadonly。OFFと手動owner-login、stdio対応hostという条件を表示。表示だけの操作でAPI書込0をbrowserで確認。
- scope: 本番source/dist書込0、実資格/実grant/アクセス設定0。既存のexact final/read/control、親provider契約、grant期間、既存トンネルは変更していない。追加試験はfake専用scriptへ分離。

最終時点で未解消のrequired findingはない。限界は実DPAPI/実provider/実Codex接続を実行していないこと、headless Edge以外の画面検証をしていないこと、実運用適用が未承認であること。本人確認は既存CLIの一回手動実行を経由する。
