# broker開始分離・対象1接続復元 — 隔離候補、未適用

対象はpi-consoleだけ。候補は `C:\Users\leade\AppData\Local\Temp\pi-console-on-demand-candidate-20261020-d907\candidate`。稼働D sourceを変更せず、public baseline140ファイルのhash不変を照合した。実broker・実資格・実接続は扱っていない。

## 観測事実と推定

確定した事実は、前回の1回観測で **broker_not_advertised / HTTP200** だったこと。service/PID/開始時刻/nonce/identity proofを通過した応答にbroker広告がなかった。今回そのhelperを再試行していない。

再起動後に本人用listenerが未開設だった説明は、sourceのport=null初期値、owner-login/Settings startでのみ開く経路、保存された作業記録と整合する**推定**。server内部のOFF/終了途中等を個別測定した証拠にはしていない。候補はこの区別を維持し、無条件の起動や認証拒否のfallbackを追加していない。

## 候補A: 管理証明でbrokerだけを開始

- GET identityはread-onlyのまま。専用POST `/api/manage/local-resume/open` を追加し、既存管理tokenのHMACで現在nonce/PID/開始時刻/管理port/requestIdを結ぶ。
- literal127のlocal/remote/port、Host、単一header、JSON、proxy/Cloudflare/browser Origin/Cookie/fetch metadata排除を確認。不正証明、OFF、bodyの対象不一致、過容量は開始しない。
- 既存startBrokerだけを呼ぶ。owner bootstrap code/cookie、grant store、MCP用途別資格issuerに依存しない。GETの署名済み広告と、POSTの署名済み開始結果を異なるHMAC文脈で検証する。
- 同じrequestIdの再送と別clientの同時要求をsingle-flightで処理し、応答喪失時にもlistenerを増やさない。失敗・期限切れreceipt・閉じたlistenerの古いreceiptは再開しない。
- companionは新しい明示的ensure経路を実ツール要求時に使用する。initialize/catalogでは開始しない。不正identityや不正な既存broker広告からPOSTへfallbackしない。旧read-only managedResumeBrokerの拒否処理と診断は変更していない。
- beginの不正requestIdはensureより前に拒否する。人の新しい設定欄や承認操作は増やしていない。

管理proofはbrokerという**transportの開始**だけを認める。grant認証や接続成立ではなく、次のprivate要求で接続proofを別に確認する。本人の新規許可・scope変更・解除は従来の本人確認を維持する。

## 候補B: 認証済み1familyだけをbind/renew

- composition生成時は保護state/owner/SID/installation/schema/永続clockFloorを検証し、秘密重複防止の予約とowner一覧用metadata取得だけを行う。全familyの起動時復元・資格更新・clockFloor書込をやめる。
- private resume/renewでconnectionId・clientId・秘密proof・approved・元grant期限・owner・clockを検証してから、対象だけの親identityをpinする。clientInfo/IDだけを認証にしない。
- 有効な短期資格は、その対象だけを既存の厳格なrestoreへ渡す。短期失効ならresumeはcredential_expiredを返し、正規renewでのみ更新する。
- unboundの更新には、**閉じたrotation contextだけ**を準備する内部メソッドを追加した。期限切れaccessをopenにせず、既存stage/activate・親pin・epoch・CAS・receipt・revoke guardを使う。新しい5分期限は元grant期限を超えない。
- 起動時に先回りしてreceiptを消さないため、保存済みrenewal requestIdの応答喪失をserver再起動後にも照合できる。別familyの鍵/epoch/receipt/scope/期限/journal/runtimeを変更しない。
- owner view/request/result/revokeでも全接続を復元しない。保存済みgrantは一覧でapproved/runtimeBound=falseとして区別し、未bindをconnectedと表示しない。role/Pi/history/final権限は追加しない。

保護storeは1つの暗号化文書なので、対象の成功更新は文書全体をCAS保存するが、他familyの内容は不変。clockFloorは従来のgrant承認/正常renewal transactionで進み、永続floor未満の時計を拒否する。初期化のためだけに他familyやreceiptを書き換えない。

通常の認証不成立・期限切れ・親不一致・不正管理要求では、資格発行・保護書込・runtime復元・transport開始をそれぞれ対応する認証境界で起こさない。管理証明が正しくtransportを開始した後にMCP grant認証が失敗する場合は、transport開始とgrant拒否を別の結果として扱う。

**既存のsecurity反応は例外として維持**: 使用済みrenewalを別requestIdで再利用した場合は、その対象grantを解除する。commit不確実時やowner binding変更ではfail closed。これを「全ての拒否で状態不変」に変えて認証/失効を緩めてはいない。

拒否後にstoreが未解決状態になる回帰も確認した。未知のowner revoke対象はprotected transaction開始前に拒否するようにし、保存済み容量などの既知の不成立条件も事前確認する。新grant生成や別接続の解除には置き換えていない。

## 受入とレビュー

- 最初の対象限定RED: 1件失敗。旧挙動は起動時にA/Bを両方復元した。対象限定化後、同じ回帰成功。
- 未知revoke対象のRED: 21件中1件で、拒否後backendがunresolvedになることを再現。事前拒否後は成功。
- 最終 **216/216 PASS、失敗0**。既存選定142件 + 新規74件（broker48・target26）。既存integrationの3件を、起動時全復元の期待から「認証後だけ対象復元」へ更新し、許可/期限/親検証は維持した。
- malformed proof/Host/proxy/Origin/Cookie/nonce/port、OFF、同時/二重要求、receipt失効/応答喪失、解除・grant期限境界・本人/SID/installation/親変更、A更新時のB全field不変、保存待機中の旧token拒否、scope外path/Pi/本文拒否、読み取り時の保護書込0を確認。
- 変更server/index、FolderMcp、新管理routeとそのimport graphのTypeScript検査成功。JS構文4件、隔離baselineでgit apply --check成功。typecheckは既存dependencyの型を参照し、native portは変更なしの宣言ファイルだけを使用。native binary/OS専用entryは実行していない。
- 新規管理/対象復元の試験はfake IO・memory backend・公開固定dummy codec・fake providerのみ。既存transport回帰の1件だけ所有loopback HTTP fixtureを使用した。PID42984 / 127.0.0.1:57019、allClosed=true、試験runner exit0。実ConsoleへのHTTP/管理helper呼出0。
- 認証・所有・期限・scope・他family不変・秘密出力・retry境界を自己レビューし、今回候補に残す必須指摘なし。UI sourceは変更していないが、owner一覧の新しい未bind状態について画面現物の追加検証は未実施。

通常npm testはOS/native項目を含むため実行していない。再現は上記Tempルートのrun-tests.mjs（pure/all）。docs内の同名scriptは証拠コピーであり、その場所からは実行しない。

## 成果物・適用状態

**12ファイル**（実装/宣言9、試験3）。candidate.patchが統合候補、broker.patch/target.patchはレビュー用の分割差分。manifestに元/候補SHAを記録した。brokerだけを反映して旧全family復元へ実接続する手順は、この候補の受入範囲ではない。統合した境界をレビューする。

今回の実施は隔離source/fixture作成とdummy試験だけ。本番source/dist/config変更0、実helper/資格生成更新/接続復元/新規申請/実作成0、Console/PC再起動0、VTS等の他アプリ操作0、画像0、UI操作0、本人への追加質問0。pi-warden、commit/push/publishなし。

## 実適用前に親で明示する承認範囲

今回の承認は隔離候補まで。次の段階では、統合差分のD source反映とConsoleだけの管理再起動（事前にjob確認）、新しい管理proof routeによる実broker開始、指定した有効grant1件の実復元/短期更新/接続・scope確認を、実行範囲として明示する必要がある。PC全体再起動やVTS操作は不要。

この候補は、fcfの失われた初回材料を再発行したり、元の初回期限2026-10-20T01:26:54.443Zや旧generationを無視したりしない。既存の承認済み継続材料があるclientの通常再接続に対応する候補であり、今のfcfを必ず救済できるとは保証しない。耐久initial handoff・migration・新grant・本人回復操作は別の判断として残した。実作成試験は、実接続・元の親/4操作/7日期限・予定子path競合なしを新たに照合できた場合だけ、既存の条件付き計画へ戻せる。

証拠: verification.json、source-preservation.json、candidate-manifest.json、RED/GREEN、acceptance-final.tap、typecheck-final.log/status、ownership.json。Dの稼働sourceはbaseline140件すべて不変。
