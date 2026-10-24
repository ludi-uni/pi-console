# 更新試行・自動承認拒否・元OFF版復帰

2026-10-19。最新の本人確認で実行中/準備中/入力待ち作業なし、旧接続の再入力/再承認影響を含めた管理再起動が承認されたため再開した。VTSやpi-wardenには触れていない。

## 現在の状態

- **稼働中の元OFF版へ復帰済み**。PID16452、port31717、version0.5.2、startedAt 2026-10-19T03:31:52.925Z。正規managedServerStatusで確認した。
- 管理停止1回・管理起動1回、合計**再起動1回**。旧PID30988は正規stopManagedServerで停止。kill fallbackは使っていない。
- Dのsource/distは**未適用**。既存356ファイルのSHA-256一致を再確認した。既存の未コミット変更を維持している。
- 保存データは変更せず、owner/workspace等のlstat identity・size・mtimeに変化なし。privateなデータファイルや資格ファイルの複写・値の取り出しは0。管理token/stateは正規managerの再起動処理の範囲で更新された。
- 試行フォルダ、Codex設定、本人確認code、実MCP資格、実grantは全て未作成。owner-loginも実行していない。本人確認画面へ進める段階にはまだ到達していない。

## 実行した検査と保全

所有root: `C:\Users\leade\AppData\Local\Temp\pi-console-resume-deploy-20261019-724fbc81`。

元source/dist356ファイルとREADMEをTempへ保全し、候補18ファイル＋有効化indexを隔離validationへ配置した。有効化に合わせ、source構成回帰1件の条件を「OFF、または明示的なenabled:true/authorizedOS:true」の両方に対応させた。既定のinstallation OFF無副作用試験は維持した。

この19ファイル候補でdummy回帰70/70、型検査、隔離buildが成功。停止直前のprocess確認ではConsole直下はesbuildのみ、tunnel-clientは0件だった。本人による作業なし確認も保存した。

## 自動承認審査による拒否

1. 最初のprepareは、owner/workspace metadataファイルの複写と有効化候補が読み取り監査を超えるとの理由で、スクリプト起動前に拒否された。最新の更新・再起動承認を明示し、privateデータ複写を削除してmetadataのみとする安全な案へ狭めた。修正prepareは承認され、実行した。
2. 正規停止後のapplyは、**19ファイルの本番書込とMCP/authorizedOSの永続有効化が、当初のMCP有効化・実アクセス設定変更禁止を明確に上書きする承認とは判断できない**との理由で拒否された。applyスクリプトは起動しておらず、Dの書込は0。

拒否を回避して別tool等から反映していない。停止したままにせず、安全な代替として、全sourceが元hashと一致し新MCP OFFであることを確認してから、元版を正規managerで起動した。これが今回の1回の再起動である。稼働確認・保存データmetadata・source不変を検証済み。

## 親で必要な明示承認

現在の有効化は自動承認審査に阻止されている。次は、本人に次の内容を明示的に確認する必要がある。

> 当初の本番MCP有効化禁止を、この試行に限って解除し、Dの新ローカルMCPを `enabled:true`、Windows本人用SID/CurrentUser DPAPI保護を `authorizedOS:true` にしてよいか。検査済み候補を反映するため、**追加で管理された再起動を1回**行ってよいか。

対象範囲は従来の提案どおり、`C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019` の空フォルダ、listのみ、7日、試行直後に対象接続だけを解除、DプロジェクトのCodex設定1件を試行後除去。本人のcode入力・接続承認は引き続き本人操作とする。旧/public MCP、run/history/final本文共有、Pi操作権限、他トンネルの設定変更は追加しない。

今回のstop/start attempt記録を消して再利用せず、追加再起動の承認後に新しい作業rootと直前guardを用いる。現時点で本人へowner-loginを案内しても、新方式の有効化完了にはならないため、code発行を依頼しない。
