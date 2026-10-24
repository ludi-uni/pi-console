# 新規ローカル連携の申請待ち60分 — source適用済み、稼働反映保留

対象は D:\Develop\pi-console のみ。2026-10-19。承認済みの期限改善を隔離copyで実装・dummy検証し、source 14ファイルをDへ適用した。dist配布・追加再起動・実申請・資格生成/転送・grant承認は行っていない。pi-wardenは調査・変更・再試験していない。

## 実装

- package/local-resume-policy.mjs の専用固定値で、新しく作るlocal-resumeの未承認申請とclient復旧記録だけ60分。共有CONFIRMATION_WAIT_MSと旧FolderMcpの既定5分はbytewise維持。trusted compositionだけ60分を選ぶ。HTTP/clientから待ち時間は指定できない。
- 旧保護記録は元のexpiresAtで読む。validatorは旧5分・新60分の正確な差だけ許容し、読むだけで移行・書換・延長しない。期限切れ・取消済みの同じ申請は復活しない。poll/retryの期限延長もない。
- MCPのpending結果に非秘密のrequestExpiresAtを追加。client/serverのうち短い期限を返すため、sourceと稼働serverの版が一時的に異なる場合も旧期限を拡張しない。
- 本人確認10分、確認画面最大5分、初期grant7日を区別して表示。UIは期限境界で承認を無効にし、送信直前も再確認する。本人確認は手動owner-loginへ案内し、自動更新しない。bootstrap code2分、短期アクセス資格5分、承認期間の計算と既存exact read/control/final契約は変更していない。
- 応答喪失・403でも保存結果の照合記録を残し、二重送信しない。申請記録がまだ60分内でも、保存済みの承認済みclientを切断するときは未承認申請の復旧を挟まない。切断意図の再起動復旧を既存回帰で確認した。
- 実際の本人管理の明るい外枠で、通常の連携ボタンの文字を読めるよう新しい連携component内だけ配色を指定した。OFF previewの副作用は追加していない。

## 検証

最初に9件のfocused回帰を作り、変更前の6件失敗をred.txtへ保存した。最終は選別済みのtest:local-resumeのみ **79/79成功**（既存70 + 新規9）、型検査と隔離Vite build成功。通常test一覧にはnative/OS試験があるため実行していない。

dummyは公開固定値、メモリbackend、fake providerだけ。Windows保護API/native binary、実フォルダ作成/git/登録、実credential/grantの操作はゼロ。transport試験は所有する一時127.0.0.1 HTTPだけで、全listener終了をTAPに記録。

headless Edgeは実component・実本人管理CSS/外枠とfake HTTPを使い、**23項目・23操作・5画像**。60分案内、申請/本人/確認/grant期限の区別、5分/10分の時計境界、取消、二重クリック1送信、応答喪失と403後の照合記録保持、390/320pxの横はみ出しなし、runtime errorなしを確認。owner-login実行や本番URLへの接続はしていない。最後のfixtureのPID/port/profile所有記録と終了はbrowser-result.jsonにある。最終listener停止・browser終了・profile削除はすべてtrue。

初期UI probeでは描画完了前の判定、模擬時計を独立シナリオ前に戻していないこと、fixtureに実際の本人管理の外枠がなかったことを修正した。これらの初期失敗でもfinallyでlistenerとbrowserの終了を確認した。初期試行の詳細JSONは上書きされており、最終試行の所有記録を正式な受入証拠とする。

追加/変更したWeb機能は既存と同様のDOM/React操作、setInterval、Date.toLocaleString、単一simple selectorを連ねた:not。MDN Baseline Widely availableと互換性を確認した。ブラウザー実測はEdgeのみであり、全ブラウザー実測とはしない。

- https://developer.mozilla.org/en-US/docs/Web/API/Window/setInterval
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toLocaleString
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:not

## 保全と適用状態

作業開始時の371 source/build対象をhash記録。14ファイル（新規3・既存11）をsource適用し、対象外360ファイルが開始時と同一であることを照合。既存未コミット変更を維持した。変更前sourceはsource-before、候補はsource-candidate、適用ごとのjournal/hashはapplication-manifest.jsonに保存した。HEADは23815ba260320e3fc720ad3288ca89728f99b4f7のまま。commit/push/publishなし。

settings-owner.json、workspaces.json、実pending保護ファイル、grant/client保護ファイルとlockの有無/size/mtime/file identityを前後照合し一致した。秘密の内容は読取・コピー・復号していない。既存Codex設定hashも一致。既存の期限切れ申請を取消・更新・復活させていない。trial folder/configの撤去もしていない。

**本番の60分化が稼働済みとは判定しない。** 管理起動はNodeの--import tsxでwatchなしなので通常はserver再起動が必要。追加再起動が未承認のためこちらでは行わず、旧backendに新UIだけを配信しないようdistも保持した。変更前に記録されていたPID7476は最後のGet-Process照会では未検出だった。こちらの操作で停止/再起動したものではなく、新しいPIDや現在の稼働版は未確認。現在のruntimeを旧5分と断定もしない。public/authenticated管理API、実MCP clientには今回接続していない。

## 後続の実操作（未実行・追加承認対象）

1. 現在のmanaged server identityと稼働状態を、既存の管理status経路で最小確認する。確認済みsource hashと現在のDが一致することを再照合する。
2. 同期反映の承認後、隔離buildの新assetを先に配置し、旧assetは残す。Dのdistを直接buildで消し直さない。管理CLIの `node package/pi-console.mjs restart` でsourceを読み直す。この操作はWeb接続や実行jobを中断し、owner cookie/未承認runtime申請も再起動をまたいで使えなくなる可能性がある。既存expired申請は延命しない。
3. server起動/identity確認後に新buildのindex.html/owner.htmlを同期し、本人がowner-loginで新たに確認する。運用側の未確認な状態でblind start/restartしない。
4. 旧期限切れ申請の明示取消と別requestIdでの新規申請、実credential生成/保存/転送、親folder/grant承認、実client試用は別の明示指示後。今回の実装適用承認から自動実行しない。

現在の保留はruntimeとdistの同期反映・実接続だけ。sourceとdummy受入は完了。
