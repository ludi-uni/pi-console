# 最新確認 UI 候補の実反映結果

**承認されたsource24件（更新9・追加15）とdist14件をD:/Develop/pi-consoleへ反映し、既定OFFでmanaged再起動1回を完了した。** 現ConsoleはPID2576、port31717、version0.5.2、起動時刻2026-10-16T03:04:07.545Z。管理資格のHMACによる所有証明を標準managerで再取得し、2026-10-16T03:08:00.075Zにもrunning / managed=trueを確認した。

## 承認と直前確認

- 適用承認: fcf3fc82-cc2c-4372-90f8-c94627f9eef2 / 確認質問2f607827-d7bf-48e1-8791-ebec7bbd9ed7、2026-10-16 02:22:51 UTC。
- 停止・queue空の確認: 2026-10-16 02:56 UTC、Sentinel_863bb84e28688191ba518664411ee599、本人の「空だよ、進めてほしい」。過去の停止返答ではなく、今回の状態確認への回答を使った。
- 適用直前に候補ZIP / deployment-manifest / payload / Dのbefore hash / backup hash / HEAD / PID32188・port31717のmanager所有を再照合。busyの新しい証拠はなかった。管理APIにはjob件数がないため、本文を読んで状態推測はしていない。

## 固定候補とハッシュ

- 候補: C:/Users/leade/AppData/Local/Temp/pi-console-release-ui-build-20261016-7a8e31c2/release-latest-ui-default-off.zip
- ZIP SHA256: 45c429b32abcf33b74eb3b26291c0119178e401ad2bfac15d07baca43ec58b5f
- deployment-manifest SHA256: ace3e540eecfa3cf858264fd43afdc9ae79e331574885c9d0991e67696033c5f
- 適用後の **source24 + dist14 = 38ファイルすべてのハッシュ一致**。application-manifest.jsonに各パス・ハッシュ・bytesとruntime証拠を保存。
- 既存asset8件は保持したため、Dのdist全体は22ファイル。配布対象14ファイルに旧23/13候補を混在させていない。
- server/index.tsの適用ハッシュが承認候補と一致し、createLocalMcpInstallation({enabled:false})を確認。activation-preview未適用。新機能の有効化や実grantによる動作確認はしていない。

## 起動準備の失敗と復旧・再開

03:00:07 UTCに所有Console PID32188のmanaged stopを確認し、38ファイルを配置・検証した。しかし操作スクリプトが、非Piから起動するための既存startupEnvironmentを呼んでいなかった。汎用resolvePiCliは管理インストール先を見つけられず、server spawnより前にPi CLI not foundで止まった。新候補の起動と復旧後の旧候補起動でこの準備失敗が各1回起きた。

最初の失敗時はsource9件・dist20件をbackupへ復旧し、自己所有の追加source15件・asset2件だけを適用hash照合後に除去した。未知の変更との競合は0。既存Startupの変更していないstartup-environment.mjsで、既存インストール済み公開Piコードのselector/package manifest/cli存在を正規手順で解決できることを確認した。インストール、selector変更、Pi実行、設定書換えはしていない。

同じ固定候補を、復旧した停止状態から再照合して再配置し、標準startManagedServerへ既存Startupと同じenvを渡して起動した。追加stopは0。**実際のserver spawnは1回、managed stopも1回**で、03:04:07 UTCにPID2576の所有起動を確認した。初回の失敗記録execution-journal.jsonは保持し、成功した再開をresume-execution-journal.jsonに分けて記録した。停止から起動まで約4分だった。

起動スクリプトの保存先を一度誤ってD内の自己所有一時ディレクトリに作成したため、ハッシュを照合してTempへ移動し、生成した空ディレクトリだけを除去した。実装ファイル・既存データへの影響はなかった。

## 保全

- 元source9件・dist20件の29ファイルを C:\Users\leade\AppData\Local\Temp\pi-console-latest-ui-apply-20261016-984a7c21/backup に保持。before-source-dist.zipにも29件とbackup-manifestを格納し、元29件の内容hashをZIP内で照合済み。
- backup ZIP SHA256: a68447de41f10f4d6b877522b5e665ccfeec3de16e02b5d897c87e8c3354cb2e、640969 bytes。
- 対象外の既存source306件とdirty13件はハッシュ不変。既存dirty15件のうち承認対象package/server-manager.mjsとserver/index.tsには承認差分を反映し、元内容はbackupに保全。追跡対象の変更一覧テキスト自体は反映前と同じ15件。追加source15件は指定された新規ファイルとして配置。
- HEADは23815ba260320e3fc720ad3288ca89728f99b4f7のまま。package/startup.mjsとstartup-environment.mjsのhash不変。OS Startup entryの書換えは行っていない。
- 最新候補seal430件と旧候補seal420件・UI候補381件・照合7件を再照合して保持。旧ZIPを差し替えていない。
- .env/profile/既存grant/networkの手動読取や変更は行っていない。標準manager/Startupは既存設定と既存管理資格を内部利用した。server-state/server-token/log/lockの通常ライフサイクル更新は承認範囲内で、旧state/tokenを復元していない。秘密をURL/argv/log出力/チャットへ転記していない。
- 同一の権限コンテキストで旧PID32188終了、新PID2576稼働、一時operator10400/4860終了を確認。限定sandboxからのプロセス非表示は稼働判定に使っていない。

## 今回行っていない操作

新MCP資格発行0、新grant0、新機能有効化0、実client接続0、選択肢2の公開dummy transport試験0、他Pi/他アプリを個別に停止する操作0。pi-wardenには触れていない。新しい画像・ブラウザー操作は0。対象は所有Consoleの標準shutdownが管理するworker/broker等と承認済みファイルだけ。

## ユーザーに必要な操作

1. 開いていたConsoleページを再読込する。
2. 本人確認が切れていた場合は、既存のowner-login手順で本人確認をやり直す。
3. 以前から使っていたMCP接続が切れた場合だけ、必要な再接続・再承認を行う。こちらでは実client接続や再承認を代行していない。

新しいローカル再開機能はOFFのため、新規キー入力やgrant作成は必要ない。機能をONにする操作は今回に含めていない。過去のcheckpoint.jsonは回答待ち時点の履歴で、このresult/application-manifestが最終状態を示す。残存する適用・起動blockerはない。
