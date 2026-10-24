# 再起動影響の読み取り調査

2026-10-19。適用・停止・再起動は保留のまま。プロセスmetadata、TCP状態の集計、Dのソースと公開コードpin、owner登録の状態値だけを読んだ。本文、資格値、process command line、process環境、browser profileは取得していない。トンネルstatus/result APIも呼んでいない。証拠保存以外の変更、取消、資格操作、接続テストは0。

## 現用状態

| 項目 | 結果 | 限界 |
| --- | --- | --- |
| Console | PID30988のnode.exeが存在。作成日時は既存管理identityの起動時刻と整合 | 管理identityの再接続試験は今回行っていない |
| 管理トンネルdaemon | 03:14 UTCの対象Console子孫にはesbuild.exeとそのconhost.exeだけ。tunnel-clientという名前のプロセスはマシン全体の限定検索でも0件 | Console内メモリのentry状態や対向App状態は未取得。「App設定がない」「全接続が不存在」とは言わない |
| Pi SDK worker | 対象Consoleの子孫にnode.exe等のPi workerは未観測。通常workerは `server/adapters/pi/process.ts:78` から子processとして起動する | メモリ内job、準備中、入力待ち、外部orchestratorの全状態をプロセス一覧だけで否定できない |
| TCP | 03:17 UTC、Console PIDのListenは31717だけ、同portにEstablished1件 | アドレス/本文を取得していないため、表示browser・公開経路等の用途は識別していない。この接続は再起動で切れる可能性がある |
| owner登録 | 非秘密の登録状態値はregistered | subject/issuer/AUD等の値を出していない。現在browserの認証有効性は未確認 |
| 既存ソース | 元の356ファイルはhash一致。旧launcherのscript/binding/legacy companion/control companionの4pinも一致 | 外部native binaryは存在metadataだけ確認し、内容読取/hash検証/実行はしていない |

以上より、今回の観測時点で「Consoleが動かしている稼働中のトンネルdaemon」は見つからなかった。以前のheartbeatエラーを対象なしの証拠に使っていない。再起動直前にはprocess状態の再確認が必要である。

全体のjob停止は未確定。管理APIはidentity/shutdown等だけで全体件数を返さない。既存read-only runtime統計は許可されたobserved scope限定なので、空scopeの0件を全体0件とは扱えない。本人認証済み画面を読む既存の接続経路もない。run/history本文やorchestrator DB本文の取得は行っていない。

## トンネルの用途と取消

対象は旧App **pi-console-echo-testの固定echo Tunnel** と、このPCのlegacy stdio companionの中継である（`package/tunnel-binding.psm1:17-19`）。新方式のCodex local-resume stdioとは別経路。親フォルダ/Pi操作の許可も転送とは別である。起動引数はCloudflareを管理しない設定で、この取消コードは公開Console用Cloudflareトンネルの設定変更処理ではない。

終了時の経路は `server/index.ts:261` → `settingsMcp.dispose` → `SettingsTunnel.dispose/stopAll` → entryへのcancel/AbortSignal。launcherは保有するnative pipeへcancelを送り、native側は自分が起動し所有を確認したdaemon/companion treeの停止を試みる。停止未確認なら成功扱いにせず `stop-unconfirmed` となり、7秒の待機でlauncher結果を閉じる。第三者daemonを名前だけで採用・停止する処理ではない。この調査では一切起動/停止していない。

保存状態への影響を分けると:

| 対象 | 取消/再起動の影響 |
| --- | --- |
| SettingsTunnel entry・要求ID・lease・ready状態 | メモリのみ。取消で終端化し、再起動では新しいMapになる。旧要求IDでstatusを読むとunknownになり得る |
| native入力key | password/SecureString/子process環境で使用し、保存しない。終了時にメモリをclear/disposeする。自動復元用のkeyはない |
| launcher専用Temp | 所有する一時runtime directoryは、停止確認が取れた場合だけ除去する。停止未確認なら保全する（`package/tunnel-key-dialog.mjs` のfinish） |
| `settings-owner.json` | トンネル取消はowner登録解除を呼ばず、このファイルを書き換えない。登録は再起動後のload対象 |
| workspace権限、親grant、run/history/final本文、作成済みrepo | トンネル取消経路からの書換・削除はない。ただし下記のとおり、Console全体の再起動と区別する必要がある |
| 管理launcherの `server-state.json` / `server-token` | 管理停止で旧state/tokenが除去され、起動時に新しい管理identity/tokenが作られる。これは正規manager内の処理であり今回未実行 |

**Console全体の再起動では、旧方式のメモリ上の接続許可も失われる。** legacy FolderMcpは通常起動で新しいconnections Mapになり、PiControlActivation.disposeはメモリの資格をwipeしlistener/serviceを閉じる。WorkspacePermissionsのinstanceも新しくなる。保存済みowner登録や基本権限が残っていても、旧接続やexact対象への許可まで自動復元するとは言えない。再接続時の明示承認が必要になる。現在そうした有効な旧許可があるかは、認証済みruntime状態を読めていないため未確定。

## 正規の復帰経路

コード上の再接続経路は存在する。ただし自動復帰や実通信成功は確認していない。

1. 同じ登録本人で認証済みConsoleの「既存の接続・権限を管理」を開き、旧接続のトンネル方式を選ぶ。
2. 旧要求の照合がunknownになった場合は、画面の明示的な取消/停止と「終了を確認したので新しい接続の準備に戻る」を使って終端を確認する。手で保存状態を消したり、旧IDを勝手に別要求へ置き換えたりしない。
3. 新しい要求で保持期間を選び、Console PCの鍵入力画面を開く。**本人が既存のRestricted runtime keyをPCの伏字欄へ直接再入力**し、接続を明示する。keyをチャットへ渡す必要はない。未保存なので再入力を省略して復帰できるとは言えない。
4. daemon readyと対向Appの接続確認は別。必要な既存Appの再検出と、新しい接続ID/対象/期限への本人承認を行う。App削除・再作成や許可の自動再付与はしない。

「既存の接続を確認して使う」は同じConsole世代・同じ保有view/pipeに限定され、再起動をまたぐ復元には使えない。復帰条件は、本人の新鮮な認証、手元の有効な既存runtime key、対話デスクトップ、固定native binaryのpin、対向App/ネットワークの有効性。今回はD側4pin一致とbinary存在だけを確認した。key有効性・binary hash・対向Appの実接続は未検証である。

## 読取APIを呼ばなかった理由

`SettingsTunnel.status → result → check` はowner/期限/Console世代の不一致でstopを起こし得る（`server/settings-tunnel.ts:34,104-111`）。従って今回の「変更・取消なし」の条件では呼べない。旧control statusも全体job件数を返さず、confirmedAt更新を伴う。ブラウザーのcookie/資格を抜き出して代用していない。

## 本人に確認する最小限の事項

**「いまこのConsoleで、Pi実行・orchestratorの実行/準備/入力待ちや、外部client経由の実作業はありませんか？」**

稼働トンネルdaemonは今回未観測なので、その存在を前提に追加のkey入力や旧接続テストを依頼する必要はない。もし本人が現用の旧接続/許可を把握している場合だけ、再起動後に上記の再入力・再承認が必要になってもよいかを確認する。既に承認された「一時切断」だけで全て元に戻るとは約束しない。

証拠root: `C:\Users\leade\AppData\Local\Temp\pi-console-restart-impact-20261019-482af06b`。
