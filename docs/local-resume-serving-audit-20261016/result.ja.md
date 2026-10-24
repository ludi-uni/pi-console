# 配信反映と新確認 UI の表示条件の照合

**Dへの配置だけでなく、ローカル本人管理で実際に配信されるHTML・JS・CSSが最新候補と一致することを確認した。一方、承認どおりの既定OFFでは新確認UIが選ばれず、従来のLocalFolderMcpが表示される。通常ConsoleのHTML/main assetとversion0.5.2は今回変更されていない。**

ユーザーがどのURL・画面を開いているかは未取得なので、その見え方の原因を1つに断定していない。キャッシュや別URLと決めつけていない。

## 観測結果

- 現在の標準manager statusはrunning / managed=true / PID2576 / port31717 / 起動2026-10-16T03:04:07.545Z / version0.5.2。
- OSで同じPIDだけを照合し、Node実行ファイルとD:/Develop/pi-console/server/index.tsの実行entry一致を確認した。command line全体は保存・出力していない。
- このentryはimport.meta.urlから ../dist/ を参照する。配信元はD:/Develop/pi-console/dist。source24/dist14の全38ディスクhashは適用manifestに一致。
- PID2576のlistenだけを読み、31717と127.0.0.1:61937を確認。新listenerは開いていない。
- 61937の既存本人管理listenerへGET /local-owner/ → 200。HTMLは配信時にasset URLを /assets/ → /local-owner/assets/ と書き換えるため、正規化して比較した。
- 正規化HTML SHA256は 018754b88f0d8daaac32bdbe4efe84a555f2c583cdacd9b242aa408f706ed30c で、承認したdist/owner.htmlに一致した。

| 実配信された参照asset | HTTP | manifest hash一致 |
| --- | --- | --- |
| owner-DmBri3OW.js | 200 | 一致（47fda42444501095dad7ea72636980e6ab5db4b8628c3e51944061691d3a3401） |
| owner-6YqVm4Az.css | 200 | 一致（dcb74d201c01d141a10180664d61024d10eab5232729ed77be3238550924389a） |
| local-owner-D2BWZZ-V.js | 200 | 一致 |
| local-owner-Bmp8QR_D.css | 200 | 一致 |

HTMLと4assetはすべてcache-control:no-storeで応答した。この直接GETはブラウザーのキャッシュを使っていない。ただし利用者タブのキャッシュ状態は読んでおらず、それを原因と確定も否定もしていない。

通常listener31717へのGET / は403で、通常画面HTMLのネットワーク取得はできなかった。Host/認証情報の変更や回避はしていない。通常画面について確認できたのは、適用manifestとDのdist/index.htmlおよびindex-*.js/cssの一致と、それらが旧候補／適用前と同一であること。

## 新しい確認画面が見える条件

1. 別のloopback本人管理ページに入り、既存owner-loginの本人確認が有効である。
2. server側createLocalMcpInstallationのenabledがtrueで、auth/statusのresumeAvailableがtrueになる。
3. LocalOwnerがLocalResumeMcpを選び、対象のpending接続・親フォルダ・操作・期限を本人が選択して「許可内容を確認」へ進み、reviewが得られる。

今回実際に反映したserver/index.ts:55は **enabled:false**。local-owner-bootstrap.ts:148はoptions.resume.status().enabledからresumeAvailableを返し、web/LocalOwner.tsx:21は resumeAvailable ? LocalResumeMcp : LocalFolderMcp の分岐。したがってこの固定構成では、本人確認後も新UIではなく従来UIになる。新しい要約パネルは、常に表示されるトップ画面の変更でもない。

auth/statusは有効な本人cookieを必要とするため、この調査では認証済みレスポンスを取得していない。resumeAvailable=falseは固定された実装／構成からの導出であり、cookie取得やログイン・grant作成を試して観測した値ではない。

versionはpackage.jsonを変更しない承認範囲だったため0.5.2のまま。通常画面のindex.html・main JS/CSSも変更対象のUIを含むowner entryとは別で、旧hashと同一。この画面やversion表示だけを見ても、今回の配置の有無は判別できない。

## 画面読取とCAIVIの調整

Codexのread-onlyタスク一覧で「CAIVIの統合不具合を修復」がactiveだった。CAIVIのsource・ログ・試験は読んでいない。共有ブラウザーのattach、tab切替、navigate、スクリーンキャプチャなどを実行していない。現在のタブを安全に読む専用ツールは公開されておらず、voice限定のscreen-contextもこのテキスト会話では使用できない。

そのため、利用者が開いているURL・画面版そのものはまだ未確認。親への具体的な確認事項は次のとおり。

- 現在のタブの **originとpathだけ**（query/fragment/鍵/コードを除く）。
- 見ている画面が「通常Consoleの設定」「ローカル本人管理」「フォルダ許可の確認」のどれか、または見えている見出し。
- それでも相違が残る場合は、既存スクリーンショットか、CAIVI実機QAに競合しない読取可能な画面／時間枠。

## 最小の次手順

反映／配信hashの不一致は今回の対象では見つからなかったので、再コピー・再起動・キャッシュ全削除を修正として行う根拠はない。まず上記URLと画面名を照合する。

新UIの見た目だけを確認したい場合、既存のダミー画像 D:/Develop/pi-console/docs/local-resume-confirmation-ui-20261016/images/02-after-wide.png と03-after-narrow.pngを利用できる。実機でキーやgrantを作る必要はない。

OFFでも利用者に新機能の状況を伝える必要があるなら、最小の製品修正はLocalOwnerのOFF分岐へ「新しいローカル連携は未有効」の理由を表示すること。認可・資格発行を変えない表示差分として検証し、新owner bundle/manifestに固定してから別の反映範囲として提示する。今回は実装・build・反映していない。

実際に新しい連携を利用可能にすることは別の機能有効化であり、今回のOFF配置には含まれない。単にenabledをtrueにすれば安全に使えると約束しない。本人・親フォルダ境界のprovider・Windows資格保存／transport等の残る実運用条件を確認する必要があり、未承認のoption2試験やgrant作成は勝手に進めない。

## 操作範囲

静的ファイルGETとread-onlyの管理所有／限定process/listen状態確認だけ。ブラウザー操作0、新画像0、追加restart0、設定変更0、新機能有効化0、新資格0、新grant0、MCP要求0。cookie／profile／.envの手動読取やrun/history/final本文取得はしていない。標準managerの既存環境／管理資格の内部利用だけ。pi-wardenには触れていない。

原因確定前の推測修正はしていない。配信が最新であることとOFFの表示分岐は確認できたが、利用者タブの特定は上記情報待ち。
