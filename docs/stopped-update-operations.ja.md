# 通常終了後の停止中更新（目標1）

## 今回の状態

**本番 apply は拒否します。** 実機の読み取り診断経路は実装しましたが、OS snapshotと人の確認だけでは管理外の直接起動・間接wrapper・他ユーザー・外部npm更新を保守期間中に排他できません。checkbox / force / mock切替はありません。本番適用・停止・再起動・許可変更・キー入力・接続変更・Events操作は今回行っていません。

本人の最小診断操作（現在のreviewed対象を既定値として固定）:

```powershell
node .\scripts\stopped-update.mjs --check
```

結果は JSON の `blockers` と具体的な `ownerActions`、終了コード **2** です。`--help` は説明のみ。`--apply` は診断・対象・archive・lock・networkへアクセスする前に拒否します。既存 `apply-reviewed-events.mjs` の拒否は変更していません。

診断は Windows OS process inventory、現在ユーザー/共通Startup shortcut metadata、Task Scheduler action metadata、service metadataの非秘密分類だけを出力します。raw command lines / arguments / service paths / 全環境変数は出力しません。shortcut は Save しません。専用PowerShell childは `SystemRoot` / `WINDIR` のみ継承し、live credentials / profile環境 / PATHを引き継ぎません。失敗・拒否時は中断し、昇格や別経路で再試行しません。

public管理identityのGETを利用する場合だけ、別途確認済みの明示loopback portを `--identity-port` で指定できます。既定の31717へ接続しません。今回、本番identityへ接続していません。公開identityは所有権/dataDir証明ではありません。nonce/proof/url等は出力しません。dataDir内容、`.env`、state/token、auth/scope/claims/receipt、Startup policyは読みません。最終診断では固定対象のrealpath/lstatだけを使い、dataDir/prefix/entryのcanonical位置とfilesystem identityを照合します（ディレクトリー内容やentry bytesは読みません）。リンク・入れ替わり・取得拒否なら中断し、別経路や昇格で続けません。これはruntimeがそのdataDirを使用している証明ではありません。

## 実機read-only証拠

初回はOS inventoryのみを読み取り確認し、canonical metadataを診断につないだコード変更後にもう1回だけ `--check` を実行しました。最終結果は以下です（瞬間的な観測であり現在の状態の保証ではありません）。

- process 518件、metadata未観測143件、未分類node24件、Console/関連候補15件。
- 固定dataDir/prefix/entryのcanonical位置とfilesystem identity取得・照合成功。runtime所属や停止を証明するものではありません。
- Task Scheduler 197件、service299件中、`pi-console`直接文字列一致は双方0件。間接wrapperがない証明ではありません。
- Startup4件中、reviewed launcher/所有marker/引数形/working directory一致1件、他3件は未分類。
- public identity未要求、`complete:false`、`externalStartExclusion:false`、本番適用不可。

関連候補は誤検出も含む保守的分類であり、PID列から所有権や終了対象を判断してはいけません。別実行・別セッションを停止しません。

## 現行起動元とlockの限界

現行D:ソースを正として確認しました。以下5ファイルは準備checkoutとSHA-256一致でした。古いcheckout全体の置換はしていません。

| 現行部品 | 関係 |
| --- | --- |
| `package/server-manager.mjs` | start/stop/restartは同じdataDirの `server.lock` をwx取得。detached serverはPi/ブラウザー終了後も生存。 |
| `package/startup.mjs` | manager経由。常駐watchdogではない。 |
| `package/startup-manager.mjs` | Startup設定・shortcut登録はmanager lockとは別。 |
| `extensions/pi-console.mjs` | コマンドはmanager経由。TUI session_startはStartupを再登録しうるが、その場でserverを起動しない。 |
| `package/launcher.mjs` | legacy `startConsole` は直接spawnでmanager lock不参加。 |

`package.json` のnpm start/devも直接server起動です。外部wrapper/watchdog/別dataDir/外部npm更新までlockで排他したとは扱いません。新規巨大admission fenceは追加していません。

本人は別途承認された通常操作で対象と所属worker/背景処理・guard/tunnelを終了し、起動元を管理者と特定し、保守中の再ログイン・Startup実行・Pi hook再登録・直接起動・別更新を避ける必要があります。ただしその自己申告だけではapplyを解除しません。観測不能/排他不能な経路があれば拒否を維持します。今回はこれらの運用操作を実行していません。

## コアとsoftware-only復元

`package/stopped-update.mjs` は準備 `deployment/stopped-events-update.mjs` の必要部分を移植しました。pinned target、139files、安全manifest、固定archive SHA-256、manager互換wx lock、全prefix backup、offline/ignore-scripts/omit=dev install契約、失敗時の停止再確認とsoftware-only復元を保持します。準備pathへの実行時依存はありません。`events-deployment-engine.mjs` からはtarget定数だけを移植し、稼働中停止/fence/再起動経路は採用していません。

`package/stopped-update-prefix.mjs` は準備 `prefix-backup.mjs` のmanifest/hash、no-links、全prefix backupと失敗prefix退避を参考にした隔離ファイルadapterです。新規依存はありません。実機用install adapterは提供していません。archive/manifest/install/完全観測は今回mockです。

順序:

1. canonical pathsとfilesystem object identityを照合。inodeはWindowsの数値精度問題を避けBigInt由来の文字列で比較。install前はentryも同一objectを要求し、install後・復元前はdataDir/prefix objectとentryのcanonical位置を要求します。ソフトウェアentryの原子的置換・部分更新による消失は復元可能ですが、prefixの入れ替わりやentry/祖先のlink・転送は拒否します。adapterのinstall後/復元前inspectには `softwareMayHaveChanged:true` を渡します。
2. `<dataDir>/server.lock` をwx取得（PID/atは現行manager互換）。既存・stale・不明lockは奪取しない。
3. 完全process観測、残存0、管理外起動の排他をadapterが証明。`complete:true`だけでは足りず `externalStartExclusion:true` も必須。
4. archive/139files manifestを検証し、依存・空directoryを含むprefix全体を新規backupに保存・hash検証。
5. 対象/停止状態/archiveを再確認後install。ここでは起動しない。
6. partial installや検証失敗時、同じ対象と停止状態を再確認。backupを照合し、失敗prefixを退避してsoftwareだけ復元（overlayしない）。

backupはprefix/dataDir双方外。prefixがdataDir配下なら `reviewed-releases` の明確なsoftware subtreeだけを許容し、stable領域を一緒に退避しません。rootを含め任意階層の `.env` / `.pi-console` / data/auth/scope/claims/receipt/queue/report / server-state/token/lock等の予約名を発見すると、曖昧なsoftware名でも保守的に拒否し、その内容を読みません。stable data/auth/claims/receipt/queue/report、古いPID/token/state/lockは巻き戻しません。

復元前にruntime/直接起動・対象入替・観測不完全が発生した場合、復元上書きを拒否してlock/backup/失敗softwareを保持します。復元失敗も同様です。lock初期化失敗時のpartial lockも保持します。残存lockを単純に消して進む手順は提供しません。更新/復元後の起動は別途承認された本人操作です。

## 今回の隔離検証

専用Temp/dataDir、dummy stable材料とmock install/観測を使用し、test childの環境をclearしてSystemRoot/WINDIR/TEMP/TMPだけ継承しました。HTTPはdummy identityのdynamic loopback portだけ。実セッション・本番31717/31718/31719・外部接続は使いません。

- `node --test tests/stopped-update.test.mjs tests/stopped-update-safety.test.mjs`: 最終 **39/39 PASS**、fail/skip0。
- `node node_modules/typescript/bin/tsc --noEmit`: PASS。dist未変更。
- target入替、不完全観測、残存process、二重update、manager形式lock、archive/manifest不一致、backup failure、partial install復元、復元前runtime出現、復元failure、backup改竄、stable保全を今回実行。
- 初回29件は19pass/10fail。exclusive backupコピー先の扱いとWindows inode精度を修正。子の32件合格後、親が原子的entry置換・entry消失で復元を誤拒否する不具合を隔離再現して修正し、install前の置換拒否・祖先junction拒否を含む4件を追加しました。さらに新しい権限ファイル・既存MCPキー/scope・receipt等がsoftware内に混入した場合のバックアップ／復元拒否を追加しました。実機診断へのcanonical metadata接続と、取得拒否時に中断し別経路へ進まない2件も追加しました。最終39件を今回の合格証拠とし、過去19/19は加算していません。
- 権限・認証・receipt の明示的保存名（`workspace-permissions.json` とlock、`dots-permission-receipts`、`readonly-mcp.key`/scope、`prompt-receipts`、`control-mcp`）もsoftwareに混入すると、バックアップ／復元前に拒否します。
- tgz SHA-256は `e77ea1b3a17ec134d9b4666b19705e87e3ddef33a9801f79317ae6d31cde66d6` と再照合。tgz未変更。

Web/HTML/React変更・新Web APIはないためBaseline/Playwright GUI検証は非該当。Vite buildも非実施（変更はNode/PowerShell CLIのみ、環境ファイルの自動読取りを避ける）。本番通常終了・更新・復元・実adapterによる完全排他は未検証です。

残るowner action: 全起動元/所属process/保守排他の実契約と適用直前のcanonical対象再照合を別途設計・受入し、実機用install/manifest adapterと私有software backup配置を承認すること。それまでは診断を利用できてもproduction applyを解除しません。
