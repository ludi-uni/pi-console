# 最新 UI 版の隔離リリース候補を固定

**source24件（更新9・追加15）とdist14件**を、新しい独立した候補として固定した。既定OFFを維持し、本番には未適用。旧source23/dist13候補は変更・置換していない。

## 最終配布物

- 候補root: C:\Users\leade\AppData\Local\Temp\pi-console-release-ui-build-20261016-7a8e31c2
- 配布物: release-latest-ui-default-off.zip
- ZIP bytes: 308070
- ZIP SHA256: 45c429b32abcf33b74eb3b26291c0119178e401ad2bfac15d07baca43ec58b5f
- ZIP全49エントリーをmanifest/hashと照合して一致。
- deployment-manifest SHA256: ace3e540eecfa3cf858264fd43afdc9ae79e331574885c9d0991e67696033c5f
- source24とdist14の全パス・before/after hash・bytesはdeployment-manifest.jsonに固定。新CSSの具体的な追加はweb/local-resume-review.css。

## 旧候補との差

source22件は旧候補と完全同一。web/LocalResumeMcp.tsxを改訂版に変更し、web/local-resume-review.cssを追加した。既存Dを基点とした更新9・追加15のsource24件であり、25件ではない。

旧dist13に対して同一11件、owner.htmlの変更1件、新owner JS/CSS追加2件、旧owner JSを候補から除外1件。

| 新しいdist対象 | bytes | SHA256 |
| --- | ---: | --- |
| assets/owner-DmBri3OW.js | 15730 | 47fda42444501095dad7ea72636980e6ab5db4b8628c3e51944061691d3a3401 |
| assets/owner-6YqVm4Az.css | 4043 | dcb74d201c01d141a10180664d61024d10eab5232729ed77be3238550924389a |
| owner.html | 520 | 018754b88f0d8daaac32bdbe4efe84a555f2c583cdacd9b242aa408f706ed30c |

候補から外れた旧owner-CiGCtWZi.jsは旧ZIPに保持。これを稼働Dから削除する指示ではなく、現distの既存asset8件はretainExistingDistで保持する。旧23/13のZIP SHAは efc21d31aa5e00aa93534540b9295dc7df5da5b269e48760d227807390a827c4 のまま。

## 検証

- 既存インストール済み依存のみを参照し、tsc --noEmitとVite 7.3.6 buildが成功。329モジュールを変換して14静的ファイルを出力。新install・package lifecycle hook・.env/profile読取は0。
- 初回sandbox内では一時依存junction作成がEPERMで止まり、ビルド開始前だった。許可された限定実行で同じ処理を実行し成功。依存junctionは実体を照合した上で参照だけを削除済み。インストール依存の記録対象ハッシュも不変。
- integration.test.mjsだけを明示して純粋なmemory/fake回帰 **37/37成功**。UIの状態／通信プレフィックスとイベント／ガード28属性が旧候補と一致。
- owner.htmlの4asset参照は新distにすべて存在し、生成owner JSに新要約、生成owner CSSに専用スタイルが含まれることを静的検証。
- 最新UIの以前の25項目・36操作・6画像は同一sourceハッシュの既存証拠として参照。今回は画像を新規作成せず、ブラウザーやHTTP listenerを起動せず、本番bundleの実ブラウザー表示を検証済みとはしていない。
- **option2公開dummy transport試験0、その他loopback transport試験0、OS暗号0、native試験0、実資格0、実grant0、実client接続0**。
- 捕捉したbuild supervisor5656、tsc36524、Vite2376、回帰supervisor26660、Node test supervisor21560の5PIDを終了確認。listener0。file/runtimeの所有情報はownership.json、build-result.json、regression.json、process-observation.json。

## 同じbackup/rollbackの成立

新候補でも旧承認案と同じ方法を使える。既存source9と適用直前の現dist20をmanifest/hash付きでbackupし、失敗時にそのsnapshotへ戻す。追加CSSを含む、元々未存在のsource15と新dist asset2は、適用後hash一致を確認したものだけを復旧時の削除対象にする。未知の変更は上書き・削除しない。

root/backup先を固定して各before/afterを照合し、backupが取れない、busy、manager所有不明、予期しない既存ファイルがある場合は適用を止める。既存static assetの配置時削除はしない。managerの古いstate/token/lockを戻して所有を偽装しない。HEAD/Startup/dataDir設定/.env/profile/既存grant/networkはそのまま維持する。具体的な対象はrollback-plan.json。

旧案から増えるのは新規source CSS1件と新規dist CSS1件であり、rollbackアルゴリズムは変わらない。認可・保存・資格・有効化・OS／ネットワーク／プロセス権限の変更はない。managed stop→配置→start1回という将来の操作範囲も旧案と同じ。ただし配布物そのものは新source24/dist14なので、旧23/13のmanifestで説明しない。

## 保全と適用状態

D source315、dist20、既存dirty15はbuild後と配布固定後にも一致。HEADは23815ba260320e3fc720ad3288ca89728f99b4f7。旧リリースseal420、UI候補seal381、照合seal7の全内容を再照合して不変。

今回は隔離コピーへのbuildと候補の固定だけ。**本番配置・停止・再起動・新資格/grant/enablement・ネットワーク設定変更・commit/push/publishは0**。Pi実行/queue/orchestratorの現在状態は取得していない。親が追加CSSを含む最終範囲を確認した後も、適用直前のfreshなidle/所有確認が必要。pi-wardenには触れていない。

最終確認の文案はapproval-text.ja.md。今回のbuildの残存blockerはない。実運用操作は未実行であり、現在の稼働状態や新機能有効化まで確認済みではない。
