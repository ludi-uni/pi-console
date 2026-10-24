# stdio / discovery / Folder 統合準備の結果

独立コピーに最小統合を実装し、dummy 受入 13/13 と focused 型検査（9 inputs / diagnostics 0）を確認。D の稼働 source/dist/config への適用は 0。実 credential / grant、実 MCP client、OS vault、daemon / native binary の実行は 0。

変更の中心は work/server/folder-mcp.ts、work/package/local-folder-mcp.mjs と宣言、folder-integration.ts、discovery-client.mjs。初回 private claim 後に trusted factory から内部更新 client を一つ作り、開始時の background start と操作前 ensure を接続する。内部 renewal の秘密は外部 MCP result に出さない。外部の protocol、tool 名・引数・catalog を維持する。CLI main の本番 wiring は実 provider 未確認のため接続していない。

本人の親 folder / operations / grant と短期 credential を分離。dummy 7/31 日と明示 none の許可で、8h 後の metadata 取得・用途別 role rotation・old token 拒否・grant/epoch 維持を確認。二重クリック、同時 claim/renew、応答喪失の同一 receipt 照合、別 requestId の reuse 拒否、他 client binding/proof 拒否、期限・取消・owner revoke・親差し替え・epoch 保存失敗・未知 sender を検証した。

fixture に投入する credential は固定公開 hex vector。FolderProvider、identity、issuer、vault、epoch は fake / memory。実 repo 作成や git init を実行していない。pin/guard 契約を超える native safety、durable atomicity と restart proof は未証明。ready=true は fixture readiness のみで、realConnectionReady=false を明示する。

受入操作は所有された Temp 内から以下の一回の focused 実行。新規の browser 画像 0 / UI 操作 0。通常 test 全体や OS/native/SDK ケースは実行していない。

```powershell
& 'C:\Program Files\nodejs\node.exe' .\run-selected.mjs acceptance folder-runtime.test.ts stdio-integration.test.ts
& 'C:\Program Files\nodejs\node.exe' .\typecheck.mjs
```

loopback へのアクセスが sandbox で拒否される場合に限り、所有 fixture の literal127 HTTP に限定した許可環境で実行する。run-selected は profile/env を収集せず、専用の最小環境を渡す。試験生成 HTTP は作成時と終了時に PID/port を記録し、全 connections を閉じて close callback と !server.listening を確認する。

http-ownership.json に保持された 42 records はすべて closed=true。初期 run の ledger が上書きされる不備を修正したため、その初期 run の exact PID/port 保全は不完全。詳細は review.ja.md。受入の失敗ログを削除せず、接続権限不足の最初の結果と RED / GREEN を残している。

D の baseline 12、public source 315、前 adapter seal 337、renewal seal 197、expiry seal 405、directory seal 413、archive 725 と既存 docs はハッシュ一致。重要な未コミット状態を維持した。新しい D docs folder にレビュー資料と ZIP のみを追加する。

初回実接続前の残件は connection-checklist.ja.md。実 binary 対応、同じ daemon を維持する child swap、identity / restart attestation、vault / durable epoch、native Folder provider、owner UI / runtime composition の本番結線が必要。追加 software / 権限取得を行わず、UNKNOWN を dummy PASS で置き換えない。
