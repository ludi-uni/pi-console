# 旧版から更新する前にデータを保護する

[入口へ戻る](../README.md) · [English](upgrade-storage.md)

旧版の Windows スタートアップは、npm が更新時に置き換えるパッケージ内の `.pi-console/` にワークスペース登録、クイック指示、自動整理設定を保存していました。**パッケージを更新する前に**、以下の操作を行ってください。更新後のプログラムが動き始める前に、npm が旧ディレクトリーを削除する場合があります。旧版のインストール済みパッケージには移行用スクリプトがないため、`package/prepare-upgrade.mjs` を含む**新しいソースの作業ツリー**から実行します。

## 1. 状況の確認とバックアップ

作業ツリーのルートで実行します。

```powershell
node .\package\prepare-upgrade.mjs
```

既定では旧データを `<Pi agent directory>/npm/node_modules/@ludi-uni/pi-console/.pi-console/` から、現在のデータを `<Pi agent directory>/pi-console/` から読みます。`<Pi agent directory>` は `PI_CODING_AGENT_DIR`、未設定なら `~/.pi/agent` です。現在の保存先を `PI_CONSOLE_DATA_DIR` で指定している場合はそれを使用します。配置が異なる場合、絶対パスで `--legacy` と `--data-dir` を指定できます。

表示される `backup` は、npm パッケージの**外側**に作る固有名の `pre-upgrade-*` ディレクトリーです。両方の場所に存在する `workspaces.json` と `session-retention.json` をそれぞれ `legacy-*`、`stable-*` という名前で退避します。`missing` は現在の登録にないワークスペース数、`conflicts` は自動解決できない差異です。登録が既に揃っていてもバックアップは保管してください。

## 2. 結果を判断する

- `status: "needs-review"`：**まだ更新しないでください。** `backup` 内の旧版と現在のファイルを比較します。同じ ID に異なるパスがある場合、クイック指示が異なる場合、自動整理設定が異なる場合は、自動でマージしません。現在の登録や設定を残すか変更するかを判断し、現在のファイルを手動で調整してから改めてバックアップしてください。旧版ファイルで現在の登録を丸ごと上書きしないでください。
- `status: "preview"`：バックアップと差分確認が完了しました。`missing` があり自動追加したい場合のみ、次の手順へ進みます。
- `status: "no-legacy-data"`：旧ディレクトリーが見つかりません。既に更新済みなら、削除されたデータはこのスクリプトでは復旧できません。外部バックアップを確認してください。

## 3. 必要なら不足分だけ追加する

Pi Console（Windows スタートアップのサーバーを含む）を停止してから実行します。

```powershell
node .\package\prepare-upgrade.mjs --apply
```

`--apply` は改めてバックアップを作り、**現在のワークスペース登録にはないパスだけ**追加します。既存のワークスペース情報とクイック指示は保ちます。旧版の自動整理設定は、現在のファイルが存在しない場合のみコピーします。競合があるか、確認中に現在のファイルが変われば書き換えを拒否します。出力が `applied` であることを確かめ、`needs-review` なら新しいバックアップを確認してください。サーバー稼働中の実行は競合の原因になるため避けてください。

## 4. 確認してから更新する

現在の `workspaces.json` と `session-retention.json` に必要な情報が揃っていると確認してから、npm の Pi パッケージを更新します。このスクリプトは npm の更新、Pi セッションの変更、旧データの削除を行いません。**npm に置き換えられる旧パッケージの中から実行しないでください。** たとえば作業ツリーが `D:\Develop\pi-console` なら `node D:\Develop\pi-console\package\prepare-upgrade.mjs` を実行できます。
