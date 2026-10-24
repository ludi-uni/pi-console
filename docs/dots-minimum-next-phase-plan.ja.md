# 次フェーズ指示：限定読み取りから完成させる

## Objective

`D:\Develop\pi-console`、`openai-codex/gpt-6.1-sol`を維持。先行91PASSの部品は再利用し、まず**新 `/mcp/dots` の限定読み取りを実client binaryで縦断検証**する。操作・更新・本人管理経路を一度に完成させない。この文書は次回の指示案であり、実装・実運用操作の承認ではない。根拠と選択肢は[詳細資料](dots-minimum-completion-design.ja.md)。

## Boundary

本人が明示して行うローカル管理と、Dots指示/repo内容/モデル判断から動くworkerは別権限。scopeはOS sandboxではない。default none、明示ID/canonical path/session/generation、解除・再実行拒否を維持する。workerに管理ファイル・credential・ownerAPI・管理コードを操作させない。「個人用だから同一ユーザーで許す」は採用しない。既存 `/mcp/readonly` のscope/接続は独立・不変。

## Order

1. **読取りtransport**：新endpointのprotocol/固定guard/client結線だけ。worker隔離・本番更新を必要としない隔離pilotで検証する。
2. **owner管理＋workspace scope**：既存GUI/store/CASを再利用。Accessと両立する本人認証方式を選定・承認してから実装する。
3. **停止中更新**：本人通常終了後の対象所属観測・保守排他・実offline install/verify adapterを受入する。本番適用は別承認。
4. **実Dots読取り**：2・3の適用が必要な本番とは分け、まず別承認の隔離pilotへ実client接続。正式適用後、本人が選んだ実scopeで受入する。
5. **worker隔離→限定操作**：管理資源からの分離を実OSで証明した専用workerだけ。通常owner workerへのfallback禁止。

## Phase 1

**実装範囲案**：新endpointの読み取り用protocol adapterと固定path/固定upstreamのguardを限定追加。現在の一次仕様 `2026-07-28` の `server/discover`、要求ごとの `_meta`、HTTP header/body一致・versionエラーを対象にする。legacy対応が実clientに必要なら着手前に版を確定し、限定追加として再承認する。read-only catalogは `get_status` / `get_progress` のみ。新認証の有効化を旧MCPのenable/scopeへ依存させない。既存GUI/storeと操作コアは作り直さない。

**受入**：専用Temp/profile、dummy認証、動的loopback、pin済み実tunnel-client binary＋dummy control plane＋新endpointを使用。本人fixture GUIで登録済みA/sessionだけread許可し、discovery/catalog/progressが成功。B・解除後・古いinstance/revision/generationは拒否。header偽装/重複/欠落、未知version、redirect、他path、ownerAPI・全controlは拒否し、worker起動/queue/実行・秘密流出は0。既存readonlyのscope/接続/hash不変。source hash、binary版/hash、成功/拒否結果を保存する。

**合格名**は「隔離実binary transport＋dummy scope合格」。実Dots・本人認証・実scope・本番適用合格とは呼ばない。今回91件は再実行せず先行証拠として保全し、実装時は影響する回帰を確認する。

## Exclusions / approval

本番拒否条件の削除、`controlIsolationVerified`固定true/環境flag、別経路回避、全scope、自動登録/approval/trust、Events、Orchestrator、実キー・実data取得、grant、stop/restart/install/deploy、公開/commit/pushは禁止。今回の変更は新規計画文書2件のみ。

本人の判断が必要：①このread-first順序、②Dots製品/版と非秘密protocol情報、③local専用管理brokerかAccess本人管理への要件変更か、④AppContainer等の隔離方式、⑤更新の保守信頼境界。OS設定/ACL/account/credential/network/sandbox導入、実接続・本番操作・有料provider試験は、それぞれ対象と影響を示して別承認を得る。未決事項を自己判断で実装しない。
