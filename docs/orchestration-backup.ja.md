# Orchestration ストアの完全バックアップと復元検証

[Home](../README.md) · [English](orchestration-backup.en.md)

`package/orchestration-backup.mjs` は Orchestrator(ludi-agent-kit)の SQLite ストア(`<kit>/.orchestration/state.db`)全体を、Console 側のクライアント スナップショット/ジャーナル JSON とともに、**新しいバンドル ディレクトリー**へ退避します。目的は、実モデル テストや kit の置き換えの前に、実行履歴(runs/tasks/decisions/trace)や `decision_memory` などのユーザー テーブルを含む DB 全体を証拠として保存することです。

これは**ある時点(point-in-time)のバックアップ**です。移行・切り替え(migration/cutover)ではありません。ライブ ライターがスナップショット後にコミットする可能性があるため、最終的な移行前には Console/Pi orchestration を停止してください。このツールがソース DB を変更したり、現行ストアを切り替えたりすることはありません。

## 使い方

このチェックアウトから実行します(パスはすべて絶対パス)。

```powershell
# DB 全体 + 任意の補助 JSON を新しいバンドルにバックアップ
node .\package\orchestration-backup.mjs backup `
  --source 'C:\...\ludi-agent-kit\.orchestration\state.db' `
  --output 'C:\...\orchestration-backups\bundle-2025-xx' `
  --kit-root 'C:\...\ludi-agent-kit' `
  --history-dir 'C:\...\pi-console\orchestration-history'

# バンドルを検証し、新しいディレクトリーへオフライン復元(読み取り専用で再検証)
node .\package\orchestration-backup.mjs restore-check `
  --bundle 'C:\...\orchestration-backups\bundle-2025-xx' `
  --output 'C:\...\orchestration-restore-check'
```

- `--source` (必須): 既存の SQLite DB ファイルへの絶対パス。読み取り専用で開き、WAL を含むコミット済みスナップショットを SQLite バックアップ API(`node:sqlite` の `backup()`)で取得します。ソースへの書き込み・チェックポイントは行いません。
- `--output` (必須): **存在しない**新しいバンドル ディレクトリー。既存パス・ソース/kit/history 内部への出力・ソースとの同一は拒否します。一時バンドルを同じ親に作ってから出力先を排他的に確保します。処理中のエラーでは自分の作成分を削除しますが、強制終了・電源断では不完全な出力が残る場合があります。必ず `restore-check` に合格したものを使用してください。
- `--kit-root` (任意): kit ルート。指定時は `.orchestration/activity/clients/` 配下の `pi-web-*.json`(クライアント スナップショットと実行バインディング ジャーナル)だけを `auxiliary/kit-clients/` に保存します。シンボリック・リンクやルート外参照は拒否し、`.env` やトークン類は一切コピーしません。
- `--history-dir` (任意): Console 履歴ミラー ディレクトリー。その配下の `pi-web-*.json` だけを `auxiliary/history/` に保存します。
- `restore-check`: `manifest.json` のハッシュ・スキーマ・全テーブル行数・`integrity_check` を検証し、**新しい**出力ディレクトリーに `state.db` と補助ファイルを `COPYFILE_EXCL` でコピーした後、読み取り専用で開き直して再検証します。既存パスを上書きせず、設定の更新・実ストアへの差し替え・実行への復帰も行いません。

`manifest.json` (version 1)には、作成時刻、ソースのパス/サイズ/mtime、バックアップ DB の sha256・バイト数・全テーブル行数・`integrity_check` の結果、各補助ファイルの sha256 が記録されます。manifest に履歴本文は埋め込みません。ただし、DB・補助ファイルには会話や判断などの機密情報が含まれ得ます。バンドル自体を機密データとして保管してください。DBと補助JSONは一つの原子的なスナップショットではないため、整合した移行には全ライターの停止が必要です。

## 注意事項

- 元DBを読み取り専用で開けない場合は、元のDB・WAL・SHMとディレクトリーのアクセス権を確認してください。WALを削除したり、WALを無視する `immutable` モードで回避したりしないでください。このツールはチェックポイントや修復を自動実行しません。
- ハッシュは破損や不意の変更を検出するためのものです。manifestごと改ざんできる相手に対する真正性の保証ではありません。処理中に第三者が親ディレクトリーを変更しない、信頼できるローカル環境で実行してください。

## 実データでの受け入れ手順(残作業)

1. Pi Console と Pi orchestration を**停止**します。実際の `state.db` を直接触らないよう、`--source` に正確なパスを渡します(自動探索はしません)。
2. 上記 `backup` を実行し、出力の `status: "backed-up"`、`database.tables`(runs/tasks/decisions/trace ＋ decision_memory 等の全ユーザー テーブル)と `auxiliary` 件数を確認します。バンドルを npm/kit 配下**以外**の永続場所に置きます。
3. 同じバンドルに対して `restore-check` を実行し、`status: "verified"` と各テーブル行数が manifest と一致することを確認します。これは完全にオフライン/読み取り専用で、実ストアは一切変更されません。
4. 以上が確認できて初めて、実モデル テスト → コミット/デプロイに進んでください。バックアップ単体では「ライターが止まった」ことは証明しないため、最終移行の直前にもう一度停止→バックアップしてください。
