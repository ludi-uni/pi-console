# 権限OFFのまま新UIを表示・確認する修正

**隔離版で実装・検証・配布物固定まで完了。本番には未適用、追加managed再起動0。** 新UIの表示と実権限を分離し、既定OFFのまま本人管理で表示確認できる候補にした。

## 表示と権限

LocalOwnerの認証済み領域に、新LocalResumeMcpを常に表示する。resumeAvailable===trueの場合だけ既存の実接続componentをmountし、false/未指定/null/文字列ではOFF専用componentへfail closed。従来LocalFolderMcpへの自動fallbackは廃止した。別用途の既存本人登録・個別権限・認証・backend APIは変更していない。

OFF時は「権限機能はOFF」「未保存」「未承認」「この下書きでは接続していません」を表示し、開始/承認/同意チェックはdisabled。実接続ID、資格、許可や成功状態を作らない。開始/承認ボタンにhandler自体がなく、強制clickでもネットワーク要求0を確認した。

「画面の流れを確認」から、親フォルダ・操作・期限をローカルメモリ内で入力し、実確認と同じ表示専用ScopeSummaryで確認できる。pathの存在/安全性は未検証と明示し、期限は「31日（未承認）」等で、実expiresAtを捏造しない。入力はサーバーへ送信・保存せず、戻ると維持、閉じて破棄/再読込では消える。以前の実接続用pending receiptはOFF下書きが消さない。

この画面が見える場所は **ローカル本人管理で認証した後**。通常Console全体の設定画面の刷新ではない。本人確認が失われると新UIも隠れる。親が配信更新を反映した後、既存の本人管理ページを再読込すればOFF表示と「画面の流れを確認」が見える。実権限の有効化や新キー入力は必要ない。

## 変更範囲

現稼働との差はsource3更新のみ:

- web/local-resume-review.css — c2df90a913ffeaf7fb506b15be6be221a904330e0e37dcb21a055e4964d17bb8 → 254897cf113b6201bde482d9841f1cf83c8ec8eba493ddc514aab4a92f5425a4
- web/LocalOwner.tsx — ce4126ecb9e65edcb22c5b10141ece61ebb6b6c4a64de034a7b3c5e65f39a522 → 5a35f4aecdb06d48308f13d6db2e1e3693742d70aa12ddcb842f1ffd9710a250
- web/LocalResumeMcp.tsx — 3b0b831622168835f03c6f5868bb4c4786de781fe281283a9ed79d8f64d22c7a → b2ea14c10b514d8365fcb4b41ac15464c1dc55ebd64015f59e45ba49c0acfb9b

サーバー・manager・資格/保存/失効/transportのコードは変更しない。source familyは既存24件のまま。現Dのsource330件中327件は完全同一で、今回の配置対象を24件に拡大していない。

## 検証

- focused SSR: 現行版で2pass/3failのREDを確認し、修正後5/5成功。
- 関連pure integration37件と合わせ **42/42成功**。Activeの状態/通信プレフィックスとイベント/ガード28属性が旧版と一致。
- tsc --noEmit と Vite7.3.6 build成功。既存installed依存のみ使用し、install/lifecycle hook/実.env/profile読取0。依存junctionを削除済み。
- 実LocalOwnerと新componentを専用isolated headless Edge + loopback fake owner APIで **34項目・32操作** 検証。1100/390/320px、下書き/要約/長いpath/期限なし/有限期限/戻る/破棄/再読込/履歴遷移/本人認証切れ/不正capability/true→falseを含む。
- OFF新連携要求0、資格・許可・transport変更要求0、禁止route0、実資格0、実grant0、実MCP client接続0。trueモード回帰用のfake view読取1回だけで、実機の権限やflagを変更していない。実行時例外0、外部origin要求0。
- 入力中1600msの要求・focus保持と、同じOFF状態の本人status再取得でも入力/focus保持を確認。新pollingは追加しない。
- 下書き許可ボタンのdisabledを外して2回clickしても要求が発生しないことを検証。OFF側にはfetch/request/storage/crypto/timer呼出しがなく、Activeをmountしていない。
- 7枚の公開dummy画像を確認。画像にある2030年の本人statusはfixtureの表示だけで、実cookie/本人/資格/許可ではない。偽の成功状態やfixture定数が本番bundleへ混入していないことも静的検証。
- 初期fixtureではCLI runnerのURL global未提供、既存ボタン名2か所の誤指定、累積counter窓、非同期表示切替待ちを訂正した。error logsを保持。文言調整前に完了した34項目の結果も別logに保持し、最終sourceで34項目を再度完了した。現role/最終文言からbuildを更新済み。
- セルフレビューの残存必須指摘0。独立第三者レビューや実MainApp全体のE2E、他ブラウザー、実owner認証/実Windows providerの確認まではしていない。

画像:

- images/01-off-owner-wide.png
- images/02-off-draft-form.png
- images/03-off-review-wide.png
- images/04-off-review-390.png
- images/05-off-review-320.png
- images/06-off-after-reload.png
- images/07-owner-auth-required.png

## 配布物とhash

release-off-visible-ui.zip: 249025 bytes、全30エントリーhash一致。

ZIP SHA256: f04a7cc9cc8983ac58195d9c2f888f7ac3229f3a403e633c42420ce49c2e8248

deployment-manifest SHA256: 3b6f9cbcdfa3c0e9d1225648090181179ec756f7967ccd6321ea3e958638ff1f

配置scopeは **source3更新 + dist14件**。distは現候補と同一8、HTML変更2、新asset4。共有chunkの再分割に伴い、ownerだけでなくindex.html/main JS/shared JSもhashが変わる。MainAppのsourceやAPIを変更したものではない。両HTMLの全参照assetが新buildに含まれることを確認し、ownerだけを旧shared assetと混在させない。

相対パスpatchを別のdummyコピーへ適用し、source3件の結果がpayload hashと一致した。ソースはsource-payload/にも保存。family-source-manifestは参照用であり配置manifestではない。

## 反映手順・再起動要否・復旧

**このfrontend-only更新にはmanaged再起動不要。** 稼働server/index.tsとlocal-owner-bootstrap.tsは、HTML/JS/CSSをGETごとにdistからreadFileする。server/packageの差分がないため、既定OFFや既存manager nonce/cookieを切り替える必要もない。今回は静的配信の更新も実行していない。

反映する場合は、直前にbefore hashを再照合し、source3件と現dist22件のbackupを確認。新asset4件を先に置いてhash検証し、HTML2件を最後にatomic置換する。既存asset12件は保持する。unknownな変更があれば上書きせず停止する。

backupはsource3 + dist22 = **25件**を実際に保全済み。before-off-ui.zipへ25件とmanifestを保存し、25件の内容hashを照合した。backup ZIP SHA256: 362f4181aa77bdd8258a6b8a32c26921c305fdf95e812d43b03ef99e31edec2e。

復旧はsource3と旧dist22を戻し、旧HTMLを最後に復元。新asset4件はopen tabが参照することがあるので、復旧に即時削除は必須ではない。削除する場合も元々未存在・適用hash一致の所有物だけを安全な参照確認後に扱い、未知の変更を保持する。rollback-plan.jsonに具体的な対象と順序を固定した。

最終範囲の文案はapproval-text.ja.md。配信更新そのものはまだ許可された隔離実装の外であり、親へこの固定範囲を返している。勝手に追加再起動しない。

## 保全と終了

現D source330/dist22/既存dirty15/HEADが開始時と一致。旧候補seal430、適用記録seal60、配信監査seal9も全一致。Startup/.env/profile/既存grant/networkは変更していない。実Console PID2576は 2026-10-16T03:59:46.830Z に標準managerでrunning/managed=trueを再確認し、稼働のまま維持。

所有dummy HTTP53069/PID14432は終了endpointでclosed=true。専用browser console-off-42f6ad8cもclose済み。捕捉15PIDの終了を同じ権限コンテキストで確認。CAIVIの共有ブラウザーへattachせず、見える実機QA画面を操作していない。

本番source/dist配置0、追加managed再起動0、実キー/grant/enablement0、option2 transport/native/OS crypto0、commit/push/publish/Library保存0。pi-wardenには触れていない。残るのはこの候補の配信範囲の判断と、反映する場合の静的ファイル更新であり、実権限の有効化ではない。
