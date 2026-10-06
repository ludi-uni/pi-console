# 運用・開発ガイド（Windows）

[入口へ戻る](../README.md) · [English](operations.en.md) · [使い方](usage.ja.md)

## 導入方法

Node.js 24 以降と互換性のある Pi SDK（0.99.2 / 1.0.0 / 1.0.2）が必要です。[公開版の簡単な導入](../README.md#すぐに使う)のほか、ソースの作業ツリーを Pi パッケージとして登録できます。

```powershell
npm install
npm run build                     # dist/ を作る
pi install (Resolve-Path .).Path  # このフォルダーを Pi に登録
pi list                           # 登録を確認
```

Pi を再起動するか `/reload` を実行し、`/pi-console` で起動します。ローカルパッケージは作業ツリーとビルド済みの `dist/` が残っている必要があります。`dist/` は Git に含まれないため、Git URL をそのまま `pi install` する方法には対応しません。公開 npm パッケージにはビルド済みの画面と実行時依存関係が含まれます。インストールだけでは接続・起動は行われません。選択前の Web 画面には `Server ready · no Pi session` と表示されます。

Pi なしでも、任意のディレクトリーから同じサーバーを管理できます。

```powershell
# ソース作業ツリーまたはインストール済みパッケージのフォルダーで
.\scripts\pi-console.ps1 start          # または node package\pi-console.mjs start
.\scripts\pi-console.ps1 status
.\scripts\pi-console.ps1 stop
.\scripts\pi-console.ps1 restart 31718 # ポートを指定して再起動
.\scripts\pi-console.ps1 port          # 設定中のポートを表示
```

Pi パッケージを使用せず単独で起動する場合、インストール済みの `@earendil-works/pi-coding-agent` CLI と設定済みの Pi モデルが必要です。

```powershell
npm install
npm run build
npm start  # リポジトリ直下の .env を任意で読み込む（Node 24）
# ローカルモードでは http://127.0.0.1:31717 を開く
```

CLI を検出できない場合は、`PI_CONSOLE_PI_COMMAND` に Pi の `dist/bundle/cli.js` の絶対パスを設定します（`pi.cmd` ではありません）。Pi パッケージ経由の起動では、任意の作業フォルダーにある `.env` を読み込みません。代わりに、次の安定した保存先の `.env` を明示的に読み込みます。

### Pi からの起動と Windows スタートアップの `.env`

`/pi-console` と Windows スタートアップは、通常 `~/.pi/agent/pi-console/.env`（Windows: `%USERPROFILE%\.pi\agent\pi-console\.env`）を読み込みます。npm パッケージの外側にあるため、Console の更新でも残ります。以下は既定の配置を編集する例です。

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.pi\agent\pi-console" | Out-Null
notepad "$env:USERPROFILE\.pi\agent\pi-console\.env"
```

Cloudflare 用の設定例（すべて実際の値に置き換えてください）：

```dotenv
PI_CONSOLE_PUBLIC_ORIGIN=https://console.example.com
PI_CONSOLE_ACCESS_TEAM_DOMAIN=https://your-team.cloudflareaccess.com
PI_CONSOLE_ACCESS_AUD=your-application-audience-tag
# 任意。Tunnel の転送先ポートと一致させます。
PORT=31717
```

- `PI_CONSOLE_DATA_DIR` が起動元に指定されていれば、そのディレクトリーの `.env` を読み込みます。未指定で `PI_CODING_AGENT_DIR` があれば、その下の `pi-console/.env` を使います。**読み込み先の指定は、ファイル内ではなく Pi／Windows 起動元の環境で設定してください。** ファイル選択後に別の `.env` を追って読み込むことはありません。
- 起動元の環境変数は、ファイルの設定より優先します（空文字の指定も優先）。`/pi-console 31718` のような明示的なポート指定も `PORT` より優先します。ファイルの値が効かない場合は、起動元に古い環境変数が残っていないか確認してください。
- ファイルがなければ従来の環境変数だけで起動します。読み取りエラーは起動エラーになり、Cloudflare の3変数が一部しか設定されていない場合も起動を拒否します。認証を無効化して回避しないでください。
- 変更後は Console を再起動し、ブラウザーを再読み込みします。`/pi-console restart` または `pi-console.ps1 restart` を使います（再起動は進行中の Web セッションを中断します）。旧版などマネージャー外で起動されたサーバーは新しいマネージャーからは報告のみで、停止は起動元のプロセスで行います。勝手に終了させることはありません。
- このファイルは信頼できる運用者だけが編集してください。作業フォルダーや npm パッケージ内に置かず、実際の値を公開リポジトリーへコミットしないでください。Windows パスを記載する場合は `C:/...` 表記が安全です（二重引用符内の `\n` は Node の `.env` 構文で改行になります）。

単独の `npm start` / `npm run dev` は引き続き、リポジトリー直下の `.env` を読み込みます。上記の保存先を使うのは Pi パッケージと Windows スタートアップの起動です。Cloudflare Tunnel の Host 設定と認証は [Cloudflare ガイド](cloudflare-access.md)を参照してください。

## セキュリティと起動

標準のサーバーは認証なしで `127.0.0.1` のみに接続します。LAN 公開や無保護のトンネルは禁止です。保護された遠隔モードは別途 Cloudflare Tunnel + Access を設定し、すべてのリクエストで署名済み Access JWT を検証します。その場合もサーバーはループバックのままです。詳しい設定は [Cloudflare Tunnel + Access（英語）](cloudflare-access.md)を参照してください。

0.4.3 以降、サーバーは**独立したバックグラウンドプロセス**です。`/pi-console`、`pi-console.ps1`、Windows スタートアップのいずれも同じデタッチドサーバーを共有マネージャー経由で起動するため、Pi の終了・`/reload`・強制終了後も動き続けます。`/pi-console stop`（または `pi-console.ps1 stop`）はどの起動元からでもこのサーバーを停止します。0.5.0 の Web セッションは、標準 CLI RPC ではなく、選択した Pi の公開 SDK を読み込む Console 専用ワーカーを使用します。履歴は指示を注入せず、Pi のセッション投影から直接取得します。双方向の分割転送により、巨大な完了・集約・ツールイベントや画像付きコマンドも内容を保持します。既存 JSONL parser の 8 MiB 上限は変更せず、物理フレームを最大64 KiB、チャンクの生データを32 KiBとし、generation・sequence・SHA-256を検証します。デルタイベントだけ累積した回答の複製を除き、最終イベントは全文を維持します。

通常の Pi のユーザー設定・リソース・セッション保存に加え、codemode、tool search、MCP、Console のレポート保存用安全拡張を読み込みます。プロジェクトのリソースは信頼判定後にだけ読み込みます。ブートストラップ段階のユーザー拡張フック、Pi に保存済みの判断、ユーザーが明示したグローバル設定 `defaultProjectTrust: "always"` を尊重し、それ以外の未確認プロジェクトは拒否します。拡張による新しい信頼判断の記憶は拒否するため、Pi CLI で確認してください。未対応ダイアログは安全にキャンセルし、拡張からのセッション作成・切替・fork・tree移動は明示的なエラーにします（Console のセッション操作を使用）。SDK の非対応バージョンや安全拡張の読み込み失敗は起動エラーとし、標準 RPC には自動で戻しません。`PI_CONSOLE_WORKER_COMMAND` はテスト用の明示的な差し替えであり、互換性の回避策ではありません。

Console は選択した SDK の検証済みインストール先を、ワーカー専用の `PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT` として拡張の読み込み前に渡します。SDK ワーカーの起動スクリプトは Pi CLI ではなく、グローバル npm インストールも拡張の通常のモジュール探索からは見えないためです。これにより、Pi が存在するのに background subagent が `neither is available` と失敗する検出漏れを防ぎます。起動元に古いホスト指定があっても、ワーカーは `PI_CONSOLE_PI_COMMAND` で選んだ SDK と同じインストールを使い、サーバー側の環境変数は変更しません。修正の反映には Console サーバーとワーカーの再起動が必要です。進行中の処理を止めてよいことを確認してから再起動してください。ホストの依存パッケージ欠損・非対応 SDK・モデル認証エラーは別の問題であり、この指定では回避しません。

転送上限は論理 JSON レコード192 MiB、出力待ちのシリアライズ済みデータ256 MiB、保留コマンド64件／256 MiB、未完転送60秒、出力待ち15秒です。各方向で同時転送は1件とし、完全な検証後にだけメッセージを公開します。超過・不正データ・タイムアウト・切断は切り捨てではなく失敗にします。JSON 全体のシリアライズと再構成にはメモリー確保が必要で、ディスクへの退避方式ではありません。abort は SDK の出力待ちを解除しますが、既に出力待ちになったレコードは削除しません。Console の永続 FIFO、添付・HTTP 本文の上限、配送不明時の保留・自動再送禁止は維持します。

管理状態はパッケージではなく Console のデータディレクトリーに保存します。`server-state.json`（PID・ポート）、`server-token`（起動ごとのランダムな管理シークレット）、`server.log`（サーバー出力）です。identity は新しいチャレンジへの HMAC 応答と PID・起動時刻で所有を検証し、shutdown もトークンを通信上に流さず HMAC 証明で要求します。古い管理状態は安全に解除する場合がありますが、再利用された PID やポート上の別プログラムには停止要求を送りません。古い／読めない `server.lock` は自動削除しません。コマンドが動いていないことを確認してから、そのロックだけを手動で削除してください。シグナルによる強制終了は一切行わず、シャットダウン時間内に終了しない管理サーバーは `stopping` と報告するだけです。管理経路はループバック Host でもプロキシ／トンネルヘッダーを持つ要求を拒否します。

`/pi-console restart`（または `pi-console.ps1 restart`）は管理対象サーバーを停止してから起動し、進行中の Web セッションをすべて中断します。Windows の **Settings → Start with Windows** は現在のユーザーのスタートアップショートカットを登録・解除します。スタートアップ登録も同じマネージャーを経由するため、ログイン時の起動は実行中のサーバーに合流し、二重起動しません。Pi にインストール後のフックがないため、信頼された対話中の Pi セッションで最初に拡張機能を読み込む際にショートカットを登録します（または **Install now** を選択）。

## データの保存先とモデル設定

| データ | 保存先・注意 |
| --- | --- |
| Pi パッケージ／Windows スタートアップの登録・クイック指示 | `~/.pi/agent/pi-console/workspaces.json`。`PI_CODING_AGENT_DIR` の下に変更可能。`PI_CONSOLE_DATA_DIR` で明示的に指定可能。 |
| Console の保留指示 | 同じディレクトリーの `queue/<sessionId>.json`。本文と添付の内容を含み、再起動後は保留して明示的な Resume を待ちます。 |
| 指示の配送記録 | 同じディレクトリーの `prompt-receipts/<requestId>.json`。指示のハッシュと受付結果のみを保存し、本文・添付は含みません。同じ requestId の重複実行を再起動後も防ぎます。 |
| セッションの自動整理設定 | 同じ安定したデータディレクトリー内の `session-retention.json`。 |
| 管理対象サーバーの状態・トークン・ログ | 同じディレクトリー内の `server-state.json`、`server-token`、`server.log`。トークンはローカル限定のランダムな秘密で、起動ごとに再生成されます。 |
| 単独の `npm start` | 作業ディレクトリーの `.pi-console/` が既定。 |
| Pi の会話 | Pi のセッションディレクトリー。`PI_CODING_AGENT_SESSION_DIR` で変更可能。ブラウザーの再接続では削除しません。 |
| ブラウザーの外観など | ブラウザー内の設定。pi-web とは共有しません。 |

送信の応答が失われた場合、ブラウザーに配送不明の表示を出します。**Check delivery · same request** は保存済みの同じ要求 ID・本文・添付で確認し、新しい要求として再送しません。サーバーが受付結果を保存できなかった場合は、安全のため同じ要求を再実行せず、履歴の確認と明示的な手動解決を求めます。配送記録は自動削除しません。削除すると、古い要求の重複排除が失われるので注意してください。要求 ID を指定しない既存 API クライアントには、この重複排除は適用されません。

ブラウザーの下書きには、未確認の配送要求も保存します。複数タブの保存は revision を照合し、古いタブで新しい下書きを上書きしません。競合したタブの入力・添付はメモリー内に保持し、保存済みの下書きを読み込む前に確認します。未保存入力がある場合はコピーして退避してから **Load saved draft** を選んでください。

**旧版の Windows スタートアップから更新する場合は、npm の更新前に[バックアップと移行](upgrade-storage.ja.md)を実施してください。** 旧パッケージ内の `.pi-console/` が先に削除される場合があります。

Kit の実行履歴は既存の Orchestrator SQLite にあり、Pi のチャット履歴は Pi が管理します。Console の正規化したイベント履歴やフォアグラウンドの子エージェント進捗はメモリー内です。ludi-agent-kit の npm Pi パッケージは自動検出されます。必要な場合は `PI_CONSOLE_KIT_ROOT` で場所を、`PI_CONSOLE_ORCHESTRATOR_STORE` で標準以外の kit DB を指定できます。Pi Console の状態アダプターはこれらを読み取るだけです。Kit への指示を明示的に選択すると、正確な Pi セッション紐付けで kit API を呼び、kit が自身の履歴を書き込みます。紐付けを検証できない実行はそのセッションの Orchestrator 実行として表示しません。Kit がなければこの送信先は無効です。

**Orchestrator settings** では最大16件の自由名モデルと使用許可を管理します。Pi セッションがあれば利用可能モデルから選択でき、手入力も可能です。登録モデルと画面で編集するその経路は Console のデータディレクトリーの `orchestrator-models.json` に保存します。Console の開始・再開時にメモリー上で Kit に合成するため、インストール済み Kit の backend 定義は変更しません。Kit の CLI には適用しません。既存の固定割り当ては Pi agent ディレクトリーの `ludi-agent-kit/models.local.json` を維持します。従来の capability 経路と標準 capability の無効化設定は Kit 内の `routing/routing.local.json` を使用するため、**kit の更新前に別途バックアップが必要**です。[kit 設定の退避・復元手順](upgrade-storage.ja.md#ludi-agent-kit-の更新)で、既存設定を上書きしないプレビュー付きツールを使えます。登録モデルの許可・経路は次の開始・再開時に反映します（実行中のランには反映しません）。Pi セッションモデル・認証情報・共有の既定値は変更しません。新規 capability は agent に自動割り当てされず、標準 capability の無効化で必要な agent が使えなくなる場合があります。

## テスト

```powershell
npm run build
npm test           # 単体、疑似 Pi HTTP、隔離したパッケージ導入、SDK 初期化・信頼・履歴、巨大レコード転送（モデル呼び出しなし）
npm run test:real  # 実際の Pi。無害な PowerShell コマンドと中断する sleep を実行
npm run test:e2e   # Playwright と実際の Pi。インストール済み Chrome チャンネルを使用
npm run test:compat # API モックの UI 基本操作。Chrome / Firefox / WebKit（モデル呼び出しなし）
```

`test:compat` は専用の Vite サーバー（`127.0.0.1:31719`）を起動し、API と SSE をモックします。Console サーバー・Pi ワーカー・モデルは起動しません。本文と添付の送信、下書き復元、画面遷移、音声認識・通知・Clipboard API が利用できない場合の動作を PC・縦長・横長の画面サイズで確認します。Chrome はインストール済みチャンネルを使い、Firefox / WebKit は現在の Playwright に対応するバイナリーが必要です。未導入・バージョン不一致なら `npx playwright install firefox webkit` で用意してください。Chrome だけを確認する場合は `npm run test:compat -- --project=chromium` を使います。WebKit の成功だけで実機 Safari / iOS の確認済みとはみなしません。

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
