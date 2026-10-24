# Piに登録されたConsoleと実配信の同一性

**Piに登録されているConsoleは D:\Develop\pi-console。現在稼働・配信されているConsoleも、今回更新した同じDの0.5.2で一致する。** 確認時刻は2026-10-16 05:31 UTC。

| 対象 | 現物のpath・結果 |
| --- | --- |
| Piグローバル登録 | C:\Users\leade\.pi\agent\settings.json の packages に D:\Develop\pi-console が文字列で直接登録。Consoleに一致する登録はこの1件。秘密や他設定は出力しない |
| 登録先の実体 | realpathも D:\Develop\pi-console、symlink/junctionへの別コピー参照ではない |
| package | @ludi-uni/pi-console 0.5.2 |
| Pi拡張entry | D:\Develop\pi-console\extensions\pi-console.mjs。package.json の pi.extensions は ./extensions/pi-console.mjs |
| 拡張が使うmanager | ../package/server-manager.mjs、つまり同じD配下 |
| 実プロセス | PID2576、entryは D:\Develop\pi-console\server\index.ts、開始2026-10-16T03:04:07.545Z。Node実行ファイルはC:\Program Files\nodejs\node.exeだがConsole本体はD |
| 起動時cwd | D:\Develop\pi-console。変更されていないmanagerが cwd=packageRoot を指定。OSが保持する現在cwdを直接読む操作はしていない |
| 実配信dist | D:\Develop\pi-console\dist。server entryのimport.meta.urlから../dist/を解決し、cwdに依存しない |
| 今回の適用との照合 | source3/dist14全17件のhashが固定manifestと一致。実配信本人管理HTML1件・owner/main参照asset6件も一致、no-store |

## Cドライブにある別物

**旧Console 0.4.3が C:\Users\leade\.pi\agent\npm\node_modules\@ludi-uni\pi-console に残存**する。これはDの0.5.2とは別の通常ディレクトリ。現在のグローバルConsole登録はローカルDのpathであり、npm旧版を指す登録はなかった。Pi1.1.0の実装も、ローカルdirectory登録はそのdirectoryからresourceを解決する分岐であり、npm cacheを代わりに使う分岐ではない。旧版は今回移動・削除・更新していない。

通常のRoaming npm global配下、Pi managed global配下、Pi git cacheのConsole既知pathには別packageなし。Dのproject .pi/settings.jsonはなく、グローバル/当該projectの明示extensions直下にもConsole別entryなし。既知のC:\Develop\pi-console、C:\Users\leade\Develop\pi-console、Documents\GitHub\pi-consoleは存在しなかった。Cドライブ全体のclone探索をしたという意味ではない。

Pi本体は別に、**C:\Users\leade\.pi\agent\install\releases\1.1.0\node_modules\@earendil-works\pi-coding-agent** にある。pi.ps1→同じbinのpi-launcher.js→install/current-versionの1.1.0→dist/bundle/cli.jsという導線を公開launcherとmanifestで確認した。Pi本体がCにあることと、ConsoleをDから使うことは両立する。Piコマンド自体は起動していない。

## 読み取り確認の範囲

標準managerはrunning/managed=trueでPID2576・port31717・version0.5.2・同じ開始時刻。本人管理loopback listener61937のHTMLとassetをGETだけでhash照合した。無認証の通常公開側HTMLは従来どおり403で、迂回・本人ログイン・Cookie利用はしていない。runtimeの生argvは保存/表示せず、対象PID1件からserver entrypathだけを抽出した。全process/envのdumpなし、.env/profile/credential内容の手動読取なし。標準managerは既存の内部認証を用いる読取状態確認のみ。

OSの現在cwdや、既に開いているPiセッションのメモリ内拡張オブジェクトは未確認。代わりに登録設定・ローカルpath解決の実装・拡張entry・manager起動cwd指定・実server entry/PID・実配信hashを突き合わせている。Piのreloadや追加起動はしていない。

設定/認証/接続の変更0、restart0、install/update0、画面操作0、pi-warden作業0。今回作成したのはこの監査記録だけで、Console source/distは変更していない。権限機能は引き続きOFF。
