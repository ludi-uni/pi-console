# ディレクトリ・ローカルrepo・workspace作成試験の計画

今回は計画と限定した読み取り確認だけ。MCP呼出、新規申請、資格生成、grant、取消、ディレクトリ/repo作成、workspace登録、Pi実行、設定変更はすべてゼロ。取消済み接続6457004c-aeb4-4c0a-904c-27f2eb6c3bffは復活・拡張しない。pi-wardenは未接触。

## 作成予定と3操作の意味

**新しい子フォルダ1個を作り、その同じ場所を空のlocal repoにし、Console workspaceへ登録する**形を推奨する。これで3段階を1回のMCP作成要求で確認でき、試験用フォルダや本人の承認を増やさない。

親:

```text
C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019
```

作成予定の子:

```text
C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019\mcp-create-check-20261019
```

| 段階 | 意味と予定の変更 |
| --- | --- |
| 新しいディレクトリ | 親直下にmcp-create-check-20261019を新規作成する。既存名を再利用・上書きしない |
| ローカルリポジトリ | 新規子の中に.gitを作り、objects/refs等の固定7ディレクトリとHEAD/config/descriptionの3ファイルを作る。HEADは未コミットのmainを指す。remote、commit、branch内容、外部repoは作らない |
| workspace登録 | 同じ子をConsole workspaceとして1件登録する。第3の別フォルダを作る意味ではない。Consoleの固定registry C:\Users\leade\.pi\agent\pi-console\workspaces.jsonへ新しい項目を追加する。既存項目とquick promptsを維持する設計だが、保存処理はJSON全体のatomic置換である。内部pathは検証済みVolume GUID形式、MCP返却は同じ場所の表示pathになる |

重要: **repo=trueはGitコマンドの実行ではなく、固定の空.gitレイアウトを作る実装**である。Git自体を起動しないので、ユーザーのGit設定・template・hookを継承する初期化ではない。Git自身でその結果をrepoと認識できることは、今回の読み取りでは実証していない。

## 必要な本人承認と最小scope

- 親は上記の試験親1個だけ。
- 操作は **list・directory・repo・workspace** の4つ。listは必須の許可metadata照合、directoryは新規子の作成、repo/workspaceは選択した追加段階にそれぞれ必要。3操作を全部確認する場合、これが現行APIの最小の組合せである。
- 期間は**7日**を提案する。現行UI/backendの有限選択肢は7日/31日で、7日が最短。確認終了後に本人が早期解除できる。今回は新しいgrantを作らない。
- 任意ファイル読取・既存dataの削除/上書き・clone/push/外部repo作成・任意コマンド・パッケージ導入・Pi実行・run/history/final本文共有の権限は付けない。内部read/control/final資格の分離と、本文公開の既存exact契約は別のまま。

新しいgrantの前に本人のbrowser確認が必要。本人確認10分、申請待ち60分、最終確認最大5分、許可期間7日は別の期限であり、自動的な本人再認証や旧expired/revoked申請の延命はしない。

## 正規手順（まだ実行しない）

1. 本人が必要に応じてConsole PCのowner-loginで確認する。今回はコード発行・cookie取得をしない。
2. 既存pi_console_local/clientId=codex-local-v1を再利用する場合、旧接続の保存状態が残るとbeginは旧接続の再接続を試して拒否され、新しい申請を自動作成しない。必要な場合に限り、正規cancel_local_connectionで**client側の保存状態を閉じる**手順を新規試験準備に含める。これはowner側grantの再取消や設定削除ではなく、戻り値ownerGrantRevoked=falseのローカル切断である。今回この操作は行っていない。旧権限を復活・拡張する手順はない。
3. 別requestIdで新しいbegin_local_connectionを行い、新しい接続IDを本人画面で照合する。作成予定path・操作・期間を提示する。ここも本人確認後の明示された新規試験として行い、今回は申請しない。
4. 本人が親と4操作・7日を最終確認して承認する。旧接続の承認は使い回さない。
5. Codexでget_local_connection、list_allowed_parentsにより新しいID・試験親だけ・4操作・期限を照合する。違えば作成をせず報告する。
6. 次のcreate_managed_workspaceを**1回だけ**呼ぶ。requestIdはreceipt照合用で、認証秘密ではない。

```json
{
  "requestId": "create-check-20261019-v1",
  "parent": "C:\\Users\\leade\\AppData\\Local\\Temp\\pi-console-local-mcp-trial-20261019",
  "name": "mcp-create-check-20261019",
  "repo": true,
  "workspace": true
}
```

7. completed/complete、artifactの名前/path、返却workspace ID/pathを照合する。get_operationで同じrequestIdのreceiptを再確認し、list_allowed_parentsではこの接続が作成したworkspace情報を確認する。この一覧は一般のファイル一覧ではない。

応答喪失や途中失敗時は、作成済みの子/.git/registry行が残り得る。get_operationで元のrequestIdを照合し、新idで作り直さない。自動削除・rollbackはしない。既存名への衝突や親identity/reparse/volume/権限の不確実さは拒否される設計で、エラー時に境界を緩めない。

## 外部通信と自動Pi実行

この3段階の実装に外部API、clone URL、push/remote設定、Git process、shell、package installerはない。Codexとのstdio・Console PC内のliteral127 HTTPとローカルfilesystem/固定Console metadataが通常の経路になる。**この機能が外部repoを作ったり、Pi worker/session/実行を自動開始したりする処理はない。** workspace登録bridgeはWorkspaceStore.registerManagedNewだけを呼び、runtime.resume/create/startOrchestrator等を呼ばない。workspaceを別途開いてsession作成/再開する操作は今回の試験に含めない。

Consoleの既存Cloudflaredサービス等、PC全体の既存通信を停止する計画ではなく、PC全体をoffline/OS sandboxにするものでもない。OS ACL・account・network設定、native binaryのload/build/試験は今回行っていない。

親以外に記録されるものとして、本人が承認するConsole固定のgrant/receipt/資格保護領域と上記workspace registryがある。一般の境界外フォルダに成果物を作る権限を与えるものではない。

## 読み取りで確認したことと未検証

08:53 UTC時点で試験親の所有file identityは既存記録と一致し、予定子mcp-create-check-20261019は未存在だった。親の内容列挙はしていない。作成直前にも衝突を再確認し、providerの排他的作成で最終判定する。既存Codex設定hashも一致。既存descriptorはenabled/contract2/fixtureProbes=falseだが、この計画確認でnative binaryをロード・試験していない。

既存MCPは任意ファイル列挙やGit照会コマンドを提供していない。そのためMCPの既存toolだけで確認できるのは、許可metadata、作成段階のreceipt、artifact/workspace IDとpathまで。**Git自身での認識確認や.git内部の独立した実物検査まで完了したと主張しない。** その確認が必要なら、親grantから任意コマンド権限を暗黙に導かず、別途許可された読み取り手段を検討する。

実装根拠:

- server/folder-mcp.ts:221–247 — scope検査とdirectory→git→workspaceの順序、receipt
- server/windows-folder-provider.ts:41–49, 143–168 — 固定.git layoutとhandleに拘束した作成
- server/managed-workspace-registration.ts:8–12 — 登録bridge
- server/runtime/workspaces.ts:55–81 — create-only登録とatomic metadata保存、Pi呼出なし
- package/local-resume-session.mjs:11, 23–26 — 旧client保存状態の切断と新規申請の関係

今回はこの計画で停止。新しい資格・grant・作成物・workspaceはまだ存在させていない。今後の解除も作成済みrepo/workspaceの削除を意味せず、cleanupは別途所有記録と本人の指示に従う。
