# Dots連携：退避と再計画の完了

**稼働/テストは成功、本人UX受入は未達。** 本人の指摘を受けて継ぎ足しを停止した。今回の成果はアーカイブと再設計文書まで。稼働実装は撤去・rollbackせず、source/dist・設定・接続／grant・実行状態を変更していない。

退避は過去の実際の適用manifestに載るpathだけを個別コピーした。現存成果114ファイル、9段階の214ファイル差分レコード、変更前後の213種類のhashオブジェクト、現行build13ファイル、最新の限定dummy証拠・13画像を保存。旧rootも残した。共有ファイルは既存ユーザー変更を含むbefore/afterとして扱い、全体をこのタスクの所有物にしていない。他作業は状態metadata・hash確認だけで内容を別に退避していない。秘密／profile／.env／実owner・grantデータはコピーしていない。

ZIPは9,003,023bytes。SHA-256は0e4fb0ddd8771c65f5ab08d1927a5227627eaa1c268afc7b9756adbcb5af951d。所有Tempへ安全なentryのみ展開し、725ファイルと整合manifestのbytesを照合した。実環境への復元は未実行。履歴に古い承認候補と配置済みmanifestの違いを記録し、実際の配置済みversionで退避を確定した。最終欠落version・未説明gapは0。

公開315 sourceファイルは最終適用時と同じhash。Git HEADは23815ba260320e3fc720ad3288ca89728f99b4f7。既存Git変更は保持し、今回追加したのはdocs/dots-connection-replan-20261013の成果物だけ。stash/reset/clean/commit/pushは0。source/dist変更・stop/restart・接続／grant変更・新機能試験・native/OS実行・pi-warden操作も0。

推薦する再設計は、一つの「Dots連携」入口で目的→対象→操作と期限の下書き→接続照合→必要な別権限の個別確定→client確認→状態／変更／解除へ進む案A。一般MCPのstdio導線を残す。周期更新はserverSnapshot・本人draft・mutationJournal・viewStateを分離し、古い応答と背景busyから入力／選択／focus／IME／scrollを守る。

初回、接続済み、期限切れ、切断、権限不足、空workspace、戻る・中断・再開を、見える文言と操作で文書化した。複数client／共有scopeの影響、App binding／各clientのsecure import等の未知は明示している。旧171件・dummy UI8ケースをUX合格の根拠にしない。今後の本人walkthroughと編集中更新の受入を別に設けた。

レビュー用の正本はD:\Develop\pi-console\docs\dots-connection-replan-20261013。ZIP内のcurrent/・phases/・objects/は、そこへ展開されているのではなくZIP内にある。所有Tempの検証用展開はrestore-check/。本人に見てほしい順はredesign.ja.md、scenarios-and-acceptance.ja.md、必要に応じcurrent-analysis.ja.mdとrestore.ja.md。

ここで停止する。案Aの導線・更新契約・状態／解除の表示を本人がレビューした後、隔離dummy prototypeを次段階として検討する。今回の依頼を機能実装や実適用の承認に読み替えない。
