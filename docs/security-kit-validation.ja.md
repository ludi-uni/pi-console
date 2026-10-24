# Security / kit compatibility 検証記録

対象: `work/security-kit`。保留中のMCP操作機能は含めません。

## 変更と検証

- Vite 7.3.7 / source-map-js 1.2.2。更新後 `npm audit --package-lock-only --ignore-scripts --json` は検出0件。
- Pi CLI探索を共通化し、マネージド配置に対応。
- SDK許可範囲は安定版0.99.2〜1.4.0。範囲内すべての版を実行検証したわけではありません。
- Pi 1.4.0の隔離インストールで実SDKワーカーと全211テストが成功。その後追加したDBバックアップテストを含む全218テストはホストのPi 1.1.0で成功。
- `npm run build` / `git diff --check` 成功。ビルドには既存のチャンクサイズ警告あり。
- `npm pack --dry-run --ignore-scripts --json` でバックアップツール・ワーカー環境フィルターの同梱を確認。確認対象の `.env` / `auth.json` / `state.db` / `node_modules` / バックアップディレクトリーは配布対象になっていません。
- JWT重複ヘッダ拒否、ワーカーへのConsole環境変数継承制限、Startupエラーログの抑制を回帰テストで検証。
- 履歴ミラーは過去の状態の表示専用。古い紐付けから回答・再開できず、保全された未回答判断が新しい操作をブロックしないことを検証。

## 実データの保全

2026-10-24、明示承認後に管理Consoleの停止を要求してバックアップを作成。処理結果の通知が途切れたため、ユーザーの再起動後に成果物を確認し、改めて `restore-check` を実施して成功を確認しました。

- 保存先: `<Console data>/orchestration-backups/bundle-2026-10-24T08-42-00-259Z`
- 復元検証先: 同ディレクトリーの `restore-check-2026-10-24T08-48-30-140Z`
- runs 8 / tasks 31 / decisions 7 / trace 1808 / decision_memory 5 / 補助ファイル12件。
- DB全体のバックアップと新規ディレクトリーへの復元検証のみ。現行ストアの切替や移行は未実施。
- 手順・機密データの扱い・停止条件は [バックアップ手順](orchestration-backup.ja.md) を参照。

## 実モデルの連携検証

ユーザーが指定した無料モデルのうち `devin/swe-2-high:high` を使用し、実際のConsole関数 `startKitRun` → `pendingKitDecisions` → `answerKitDecision` → `resumeKitRun` を通して完了を確認しました。

- run: `run-mvm6olzj-d0c9a9`。同一セッション・ワークスペース・DBで判断の保存と回答を確認。
- 実モデル呼び出し1回。再度の完了済みrun再開は追加呼び出し0回で、タスクを再実行しませんでした。
- 先行したQwen3.8 Flashの検証は180秒でタイムアウトし、完了扱いにしていません。
- 隔離したkitコピーへ固定planを注入し、モデルによるplanner生成を省略。判断は意図的にdirtyにした作業フォルダに対する実kitの安全ゲートです。
- ConsoleのHTTP/UI経由・モデルが自発的に作る判断・すべてのproviderの検証ではありません。
- 証拠: 一時ディレクトリー `pi-kit-real-model-it/console-driver.mjs`、`console-run1.log`、`store/state.db`。一時成果物には機密履歴が含まれ得るため配布しません。

## 稼働状態と未実施項目

2026-10-24のユーザーによる再起動後、管理Console PID 23004のコマンドラインは `D:\Develop\pi-console-security-kit\server\index.ts` を指していることを確認しました。エージェントによる追加のインストール・起動元切替・再起動は行いません。

ストア移行、公開パッケージのリリース、将来の自動起動設定までの切替確認は未実施です。別の配布物を反映する場合は、起動元、停止対象、現行コードのバックアップ、復旧方法を再確認してください。
