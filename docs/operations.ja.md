# 運用・開発ガイド（Windows）

[入口へ戻る](../README.md) · [English](operations.en.md) · [使い方](usage.ja.md)

## 導入方法

Node.js 24 以降と Pi 0.87.1 以降が必要です。[公開版の簡単な導入](../README.md#すぐに使う)のほか、ソースの作業ツリーを Pi パッケージとして登録できます。

```powershell
npm install
npm run build                     # dist/ を作る
pi install (Resolve-Path .).Path  # このフォルダーを Pi に登録
pi list                           # 登録を確認
```

Pi を再起動するか `/reload` を実行し、`/pi-console` で起動します。ローカルパッケージは作業ツリーとビルド済みの `dist/` が残っている必要があります。`dist/` は Git に含まれないため、Git URL をそのまま `pi install` する方法には対応しません。公開 npm パッケージにはビルド済みの画面と実行時依存関係が含まれます。インストールだけでは接続・起動は行われません。選択前の Web 画面には `Server ready · no Pi session` と表示されます。

Pi パッケージを使用せず単独で起動する場合、インストール済みの `@earendil-works/pi-coding-agent` CLI と設定済みの Pi モデルが必要です。

```powershell
npm install
npm run build
npm start  # リポジトリ直下の .env を任意で読み込む（Node 24）
# ローカルモードでは http://127.0.0.1:31717 を開く
```

CLI を検出できない場合は、`PI_CONSOLE_PI_COMMAND` に Pi の `dist/bundle/cli.js` の絶対パスを設定します（`pi.cmd` ではありません）。Pi パッケージ経由の起動では、任意の作業フォルダーにある `.env` を読み込みません。遠隔アクセス用の変数はホスト Pi の環境へ渡してください。

## セキュリティと起動

標準のサーバーは認証なしで `127.0.0.1` のみに接続します。LAN 公開や無保護のトンネルは禁止です。保護された遠隔モードは別途 Cloudflare Tunnel + Access を設定し、すべてのリクエストで署名済み Access JWT を検証します。その場合もサーバーはループバックのままです。詳しい設定は [Cloudflare Tunnel + Access（英語）](cloudflare-access.md)を参照してください。

`/pi-console stop` は Pi が所有するサーバーを停止します。通常 Pi を終了すると拡張機能もサーバーを停止しますが、Pi プロセスが強制終了された場合は子プロセスが残ることがあります。Windows の **Settings → Start with Windows** は現在のユーザーのスタートアップショートカットを登録・解除します。Pi にインストール後のフックがないため、信頼された対話中の Pi セッションで最初に拡張機能を読み込む際にショートカットを登録します（または **Install now** を選択）。

## データの保存先とモデル設定

| データ | 保存先・注意 |
| --- | --- |
| Pi パッケージ／Windows スタートアップの登録・クイック指示 | `~/.pi/agent/pi-console/workspaces.json`。`PI_CODING_AGENT_DIR` の下に変更可能。`PI_CONSOLE_DATA_DIR` で明示的に指定可能。 |
| セッションの自動整理設定 | 同じ安定したデータディレクトリー内の `session-retention.json`。 |
| 単独の `npm start` | 作業ディレクトリーの `.pi-console/` が既定。 |
| Pi の会話 | Pi のセッションディレクトリー。`PI_CODING_AGENT_SESSION_DIR` で変更可能。ブラウザーの再接続では削除しません。 |
| ブラウザーの外観など | ブラウザー内の設定。pi-web とは共有しません。 |

**旧版の Windows スタートアップから更新する場合は、npm の更新前に[バックアップと移行](upgrade-storage.ja.md)を実施してください。** 旧パッケージ内の `.pi-console/` が先に削除される場合があります。

Kit の実行履歴は既存の Orchestrator SQLite にあり、Pi のチャット履歴は Pi が管理します。Console の正規化したイベント履歴やフォアグラウンドの子エージェント進捗はメモリー内です。ludi-agent-kit の npm Pi パッケージは自動検出されます。必要な場合は `PI_CONSOLE_KIT_ROOT` で場所を、`PI_CONSOLE_ORCHESTRATOR_STORE` で標準以外の kit DB を指定できます。Pi Console の状態アダプターはこれらを読み取るだけです。Kit への指示を明示的に選択すると、正確な Pi セッション紐付けで kit API を呼び、kit が自身の履歴を書き込みます。紐付けを検証できない実行はそのセッションの Orchestrator 実行として表示しません。Kit がなければこの送信先は無効です。

**Orchestrator settings** では Pi セッションがあれば Pi の利用可能モデルからプロバイダーとモデル ID を設定でき、手入力も可能です。新しい優先順位を設定しても既存のルートはフォールバックとして残ります。変更は kit のローカル上書きファイルに保存され、新しい実行から反映されます。Pi セッションモデルや共有の既定値は変更しません。互換性のある kit が必要です。

## テスト

```powershell
npm run build
npm test           # 単体、疑似 Pi HTTP、隔離したローカルパッケージ導入、Pi RPC 接続（モデル呼び出しなし）
npm run test:real  # 実際の Pi。無害な PowerShell コマンドと中断する sleep を実行
npm run test:e2e   # Playwright と実際の Pi。インストール済み Chrome チャンネルを使用
```

`test:real` と `test:e2e` は設定済みのプロバイダーを呼び出し、少額のモデル料金が発生する場合があります。実際にインストールされた kit の質問回答・再開 API を、モデル呼び出しなしで隔離テストする場合は以下を実行します。kit は一時ディレクトリーへコピーされ、モデル呼び出しが発生すればテストは失敗します。

```powershell
$env:PI_CONSOLE_REAL_KIT_ROOT = Join-Path $env:USERPROFILE '.pi\agent\npm\node_modules\@ludi-uni\ludi-agent-kit'
node --import tsx --test tests/real-kit-decisions.test.mjs
```

## 設計資料

利用者向けの画面・モバイル・再接続の詳細は [Phase 3](phase-3-daily-driver.md)。内部の実行・監査は [Phase 2 observability](phase-2-observability.md)、相関付けと状態は [Phase 2 execution model](phase-2-execution-model.md)、ランタイムは [Phase 1](phase-1-runtime.md)、設計契約は [Phase 0](phase-0-architecture-contract.md)（各英語）を参照してください。

## ライセンスと配布

Pi Console のソースコードは [MIT License](../LICENSE) です。実行時依存関係のライセンスと著作権表示は [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) にあり、画面の Settings → About the app からも参照できます。Pi CLI は別途導入が必要です。ペットの画像は別のパッケージから読み込まれ、このプロジェクトのライセンスには含まれません。改変版の配布前に依存関係と追加した画像の権利を確認してください。

公開版は [`@ludi-uni/pi-console`](https://www.npmjs.com/package/@ludi-uni/pi-console) です。ローカルで配布用 tarball の内容を確認するには `npm pack --dry-run` を使い、必要なら `npm pack` します。`prepack` がブラウザー用ファイルをビルドします。利用者には互換性のある Pi CLI と Node.js/npm による実行時依存関係が必要です。認証のないループバックサーバーを直接公開しないでください。
