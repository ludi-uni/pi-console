# Pi Console

[English](README.en.md)

Pi の会話と実行状況を、Windows の PC やスマートフォンのブラウザーで確認・操作するためのローカル優先の Web コンソールです。Node.js 24 以降、Pi 0.87.1 以降が必要です。Pi の TUI と**同じ会話画面ではなく**、別の Pi RPC セッションを使用します。

> **安全上の注意**：標準モードは認証なしで `127.0.0.1` にだけ接続します。LAN やインターネットへ直接公開しないでください。遠隔利用には [Cloudflare Tunnel + Access の設定](docs/cloudflare-access.md)が必要です。
>
> **旧版から更新する場合**：以前の Windows スタートアップ版は、npm の更新時に消える場所へワークスペース登録を保存していました。**更新する前に**[バックアップと移行手順](docs/upgrade-storage.ja.md)を実行してください。更新後には旧データを回収できない場合があります。

## すぐに使う

公開済みパッケージを Pi にインストールする場合：

```powershell
pi install npm:@ludi-uni/pi-console@latest
```

Pi を再起動するか `/reload` を実行してから、Pi で `/pi-console` を入力します。表示されたローカル URL を開き、ワークスペース（Pi の作業フォルダー）とセッションを選んでください。**インストールだけではサーバーは起動しません。**

ソースからのローカル導入や `npm start` の手順は [運用・開発ガイド](docs/operations.ja.md#導入方法)をご覧ください。

## 目的別ガイド

| やりたいこと | 説明 |
| --- | --- |
| 会話、ファイルのプレビュー、実行状況を使う | [使い方](docs/usage.ja.md) |
| データの保存先、起動設定、テストを確認する | [運用・開発ガイド](docs/operations.ja.md) |
| 旧版から安全に更新する | [更新前のバックアップと移行](docs/upgrade-storage.ja.md) |
| 保護された遠隔アクセスを設定する | [Cloudflare Tunnel + Access（英語）](docs/cloudflare-access.md) |
| 内部設計を調べる | [設計資料への案内](docs/operations.ja.md#設計資料) |

ソースコードは [MIT License](LICENSE) です。依存関係と素材の権利については [配布時の注意](docs/operations.ja.md#ライセンスと配布)をご確認ください。
