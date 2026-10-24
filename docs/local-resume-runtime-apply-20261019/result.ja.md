# 新規申請待ち60分化 — dist同期・管理再起動完了

2026-10-19。ユーザーの「大丈夫だよ、再起動して」という明示承認に基づく反映。D:\Develop\pi-consoleのみが対象。新しい実MCP申請・MCP資格・grantの作成、期限切れ申請の復活、pi-warden作業は行っていない。

## 現在の稼働

| 項目 | 確認結果 |
| --- | --- |
| 新PID | **26656** |
| 稼働identity | pi-console **0.5.2**、startedAt **2026-10-19T06:21:30.396Z** |
| 起動元 | D:\Develop\pi-console\package\server-manager.mjs の既存管理起動。server entryは同じDのserver\index.ts、NodeはC:\Program Files\nodejs\node.exe。管理起動の返却PIDと認証済み管理status/public identityが一致。起動引数そのものは取得していない |
| 待受 | **127.0.0.1:31717**、PID26656 |
| 旧PID | 7476はpost-readで不在 |
| 本人管理 | 旧49969 listenerは終了。新しいowner-loginは行っていないため、新listener/cookie/bootstrap codeは未作成 |
| 正常応答 | 認証済み管理status=running/managed、GET /api/manage/identity=200、PID・startedAt一致 |
| 外部トンネル | Cloudflared PID5296は同じ開始時刻で存在。こちらでは停止・再起動していない |

## 反映した内容と保全

検証済みの保存build7ファイルを同期した。新asset4件を先に追加、共通CSS1件は同じhashのため再利用し、起動確認後にindex.html/owner.htmlの2件を切り替えた。**実write6件・再利用1件、旧asset31件はすべて残した**。旧dist33ファイルはdist-beforeへ保全済み。D上でbuildし直したり旧assetを削除したりしていない。

source14ファイルと対象外の既存baselineはhash一致。既存Codex設定もhash一致。保護データは有無・size・mtime・file identityが前後一致し、本文・暗号文・秘密はコピー/復号していない。新MCP申請・MCP用途別資格・grantはゼロ。管理起動用tokenだけは承認された通常のserver lifecycle内部で更新され、値を取得/出力していない。既存の期限切れ申請ファイルは元のまま。

## 再起動中に起きたこと

管理再起動関数の呼出は**1回**、停止は完了したが、通常CLI環境では既存Pi CLIを解決できず、起動前に失敗した。停止前にこの解決経路を確認しきれていなかった。

停止後の読み取りで31717はECONNREFUSED、管理記録/token/lockはなし、通常のPi CLI解決はpi_cli_not_foundと確認した。既存のStartupと同じstartupEnvironmentが、インストール済みpublic selector/manifest/cliを検証してPi **1.1.0**を選ぶ仕組みを使い、**追加の停止・再起動をせず起動1回で処理を完了**した。インストール、selectorの書換、環境設定の保存、Piの試験実行はしていない。

停止要求は06:19:36.811 UTC、新identity成立は06:21:30.396 UTC。この間に起動解決の遅れがあった。正確な全リクエストの停止時間は測定していない。最初の失敗journal(application.json)は改変せず保全し、start-completion.jsonに後続の起動完了を記録した。

通常CLI単体ではこのshellからmanaged Piの選択を自動解決できないという既存運用上の残件がある。今回は既存Startup resolverで完了しており、この反映タスクではCLI sourceを追加変更していない。次回も無条件に同じ通常CLI呼出を繰り返さず、検証済みStartup参照を含む管理起動経路を使う必要がある。

## 60分とUIの確認

- 実配布sourceに対する期限のdummy回帰 **9/9成功**。新規60分の正確な失効境界、再表示で延長しないこと、client再起動復旧、旧5分記録の期限維持/expired復活拒否、review最大5分、owner cookie10分、grant初期7日、版の混在時に短い期限を採用することを確認した。メモリbackend/fake provider/公開固定値だけで、OS保護API・native binary・実申請は使っていない。
- 新PIDは検証済みsource適用後にDの管理起動から生成され、全14source hashが一致。これをfresh runtimeへの読み込みの証拠とした。**本番で申請を作って60分を測ったものではない。** version文字列0.5.2は変えていない。
- 新HTML2件とasset5件の全hashが保存buildに一致。D/distに実際に配置されたHTML/module/CSSをそのまま所有する一時HTTP fixtureで表示した。本人状態は公開dummy、production cookieやprofileは使っていない。**7項目・4操作・画像2枚**で新しい本人期限表示、固定60分案内、read-only設定、390px表示、runtime errorなしを確認した。fixture PID35588/127.0.0.1:59775は停止、headless Edge PID39248は終了、専用profileも削除済み。
- 以前の実装受入79件・UI23項目/23操作/5画像は先の封印済み成果物に残している。今回の9件/7項目/4操作/2画像と混同しない。

実本人の認証済み画面をこちらで再表示したとはしない。再起動で旧cookieとlistenerが終了しており、実bootstrap codeやcookieの発行を避けるため、本人による次の手順を残した。

## 本人確認を戻す最小手順

Console PCのPowerShellで実行する（こちらでは実行していない）:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'D:\Develop\pi-console\package\pi-console.mjs' owner-login
```

明示確認に本人がyesと答え、開いたloopback browserへ本人の端末だけに表示される2分有効のコードを入力する。コードをチャットやURLへ貼らない。本人確認は10分で終了し自動延長しない。古い49969のURLを再利用せず、今回開いた画面を使う。

新しい画面で「ローカル連携を始める」→「本人確認と接続手順」を開けば、固定60分と他の期限の区別を確認できる。ここまでの画面確認から新規client申請や親folder/grant承認へ自動的には進まない。既存expired申請を延命したり、無断で取消/別requestIdの申請に置換したりしていない。

## 自動承認レビュー

post確認のうち、生のprocess CommandLineを取得して起動entry一致のbooleanを出す照会は、自動承認レビューに拒否された。派生値だけの出力でも取得自体が禁止という理由だった。その操作は実行せず、CommandLine取得を完全に除外したmetadata照会に変更し、実行ファイル・開始時刻・待受・管理起動の記録・認証済みidentityで確認を完了した。拒否を迂回する間接的な引数取得は行っていない。

証拠: before.json、application.json（最初の失敗を保持）、failure-observation.json、start-completion.json、source-verification.json、process-verification.json、installed-expiry-tests.log、browser-result.json、images/。
