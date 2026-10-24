# 通常設定の新OFF画面・権限管理統合：実装／適用完了

**通常Consoleの「設定→ローカルMCP」に新しいOFF画面を直接表示する修正をDの実配信へ適用した。** 独立した「Dots ワークスペース権限」メニューはなくし、既存の接続・workspace/session権限・exact final管理は同じ設定内へまとめた。フィオ固有の接続UI/aria表記はDotsへ変更。権限機能OFF、backendの権限チェックと既存grantは維持し、実key/grant/transportの新規操作0、追加restart0。

## 本人が見る導線

通常のConsoleを再読込し、**設定→ローカルMCP→「画面の流れを確認」**。別のローカル本人管理画面へ移る必要はない。親フォルダを下書き入力して **「下書きの確認画面へ」** を押すと、どのfolder・操作・期間かを確認できる。全て未保存・未承認で、実際の開始／許可は無効。

既存の管理は **ローカルMCP→「既存の接続・権限を管理」→「ワークスペース・セッションの権限を確認／変更」**。既存のread/control対象・session/generation・解除内容確認と、final本文公開の別承認を維持した。「接続管理に戻る」でeditorを閉じ、「新しい連携画面に戻る」で新OFF画面へ戻る。親folder許可からPi制御やrun/history/final本文公開を追加しない。既存editorが扱うのはworkspace/session権限全体であり、接続ID単位の権限であると偽っていない。

通常設定には別の本人登録作業を新たに必須化しない。新previewは未認証状態・管理status読取失敗でも利用でき、実管理には従来の本人認証とbackendチェックが必要。署名検証済みAccess本人とloopback owner cookieを同一視していない。

## 変更と契約

UI source5件: SettingsPage.tsx / SettingsLocalMcp.tsx / WorkspacePermissions.tsx / FioConnection.tsx / local-resume-review.css。関連navigation既存test3件を新導線へ更新し、focused SSR test1件を追加した。source合計9件（8更新・1追加）。

SettingsPageの独立permissions nav/detailを取り除き、local-mcpを唯一の設定入口とした。mobileで設定メニューへ戻る際に管理editorと一時reviewをunmountする。SettingsLocalMcpはLocalResumeMcp available=falseを再利用し、既存managerは明示展開時だけ表示する。owner status失敗時は古いowner UI状態を消し、Fio/FolderはauthenticatedOwner===trueでのみ表示する。API prefix・onStart・owner申請/照合/解除・storage keyは既存契約を維持した。

WorkspacePermissionsのembedded時に限り凍結診断をmountしない表示ガードを置いた。診断実装・OS isolationの実装/試験は変更・実行していない。単独/既存本人管理の互換表示は維持。Fioは表示/ariaの名前だけDotsへ変え、関数・API・storage・binding識別子は変えていない。新しいWeb APIは追加しない。

Fioのstate/request prefixとevent/guard属性44件、WorkspacePermissionsのstate/request prefixとevent/guard属性20件が旧sourceと一致。LocalResumeMcp本体と全backend/managerは変更なし。

暗色テーマで新OFFテキストが暗い背景に重なる問題は、通常設定内のOFF領域だけlight canvasを指定して解消。採用した基本CSSはMDNの[background-color](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/background-color)・[border-radius](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/border-radius)のBaseline Widely availableを確認した。実ブラウザは今回のEdgeで確認し、別ブラウザまで検証済みとはしていない。

## 検証

- focused SSRは旧sourceで1pass/5failのREDを確認し、最終6/6成功。
- pure integration37 + focused6 + 既存Pi接続state8 = **回帰51/51成功**。通常aggregateはOS/native試験を含むため実行していない。既存E2E3本は入口を更新したがowner-pin/transport helper等を起動しないためそのまま実行せず、下記fake UI受入で確認した。
- 最終tsc --noEmit、Vite build成功。既存installed依存のみ使用。install/lifecycle hook/実.env・profileのbuild読取0。一時依存junctionは終了確認後除去した。
- **通常SettingsPageそのもの**（初期menu・周辺の通常settings含む）を隔離loopback HTTPとfake API、専用headless Edgeで **35項目・48操作・画像8枚** 確認。新OFF導線、独立menu不在、管理への出入り、read/controlとfinalの別承認、review/取消、拒否されたfake保存の再送なし、既存grant snapshot不変、390/320px、mobile戻る、未認証/不正なtruthy owner値、認証再読取403時のstale UI除去、権限拒否、pending receipt再読込照合を含む。
- 新previewの強制二重clickでもresume/credential/grant/transport要求0。fixtureに許可していないroute0、凍結診断route0、外部origin要求0、runtime JS error0。fake workspace save拒否を1回、fake final review/cancelを試したが、実grant/本文/実clientは一切使っていない。
- 撮影時だけviewportを1pxへ変えるfullPage挙動を再現し、固定幅でheightだけ拡張する撮影へ変更。前後のpanel維持を確認した。最終8画像を実見し、新OFF文字の読める状態と狭幅を確認した。初期画像の既存処理照合warningはこのfixtureに残した公開dummy照合IDによるもので、実ユーザーのpending状態ではない。

本人画像libfile_2224d1b3acd0819180f7231451695fc5は親が実見済み。本agentは公式prepareでconsumer-local bytesを得ておらず、利用可能なPython aliasが起動できなかったためローカル実ピクセル取得は完了していない。その代わりに、指定どおり同じ通常SettingsPageを再現して実画像を確認した。Libraryへ新たに保存していない。

## 固定候補・backup・適用

配布scopeはsource9 + dist13 = **22件のhash対象**。distは新asset4・同一7・HTML変更2。新assetを先に配置し、source9、その後参照assetを検査してHTML2を最後に原子的置換。実書込み15件。旧asset17を保持し、現在dist30件。共有chunkの分割も更新されるためowner側のHTML/bundleも候補に含む。

固定ZIP release-settings-ui.zip: **268490 bytes / 31entries全hash一致**。SHA256 **a1db66a463aaa9144c40ba9cca67d9db0ad4f6eacbb6ccf3745127204593b2b2**。

manifest SHA256: **bba054bd56f4fc16bc9e4b02efc51aa35fe95270e9cae630e0d2b31700f0871c**。候補固定時点のmanifest原本は識別用にそのまま保持し、適用済みの事実はapply-result.json/result.jsonに記録した。

backupは変更前source8 + 現dist26 = **34原本**。before-settings-ui.zipはmanifestを含め35entries、全原本hash一致、843951 bytes。SHA256 **bef4e8493024ec10f9c21aaa7f615bfac74e812f2158a85c483efd38afd84563**。新規test1件は元々不存在として記録した。

適用直前source330/dist26/dirty15/HEADを再照合。適用後は22hash一致、対象外source322、対象外dirty14、対象だったdirty1（SettingsPage）は旧内容をbackup保全したうえで承認差分だけ更新。tracked statusは同じ15件で、HEADも23815ba260320e3fc720ad3288ca89728f99b4f7のまま。以前のseal506/64/20も全照合した。

## 実配信確認と運用状態

実際のloopback owner HTMLが200で正規化hashが候補と一致、owner/main参照asset **5件** が全て200/no-store/hash一致。実配信JSに新管理導線/Dots表記があり、独立Dots permissions menu文字列とフィオ接続表記がないことも確認した。fixture専用markup/公開dummy capabilityは本番bundleに混入していない。通常公開側HTMLへの無認証GETは従来どおり403で、認証やHost制限を迂回していない。main HTMLはdisk hashで照合し、main JSは同じdistを返すowner static経路で実配信byteを確認した。

**実ユーザーの認証済みtabは未確認。** 実本人認証を代理せず、Cookie・tokenを読み出さずに、通常componentのdummy受入と実配信hashを区別して確認した。

ConsoleはPID2576、start2026-10-16T03:04:07.545Z、version0.5.2のまま。最終標準manager確認 2026-10-16T06:03:00.537Z はrunning/managed=true。追加restart0。静的handlerがGETごとにdistを読むため再起動は不要だった。standard manager内部の既存認証によるread-only statusだけを使用し、実.env/profile/credential内容を手動で読んだり出力したりしていない。

## 終了・復旧・制限

所有fixture HTTP PID8444 /127.0.0.1:50708は終了endpointでclosed=true。専用browser console-settings-6c1e94afの捕捉8PIDは全終了。共有browserへのattachやCAIVI前面操作0。一時dependency junctionも除去。

適用失敗/rollback実行0。必要時の復旧は今回の変更前8sourceと旧26distから、未知の変更を拒否して対象source/HTMLだけ復元し、旧HTMLは最後。今回作成test1件を消す場合も元不存在・適用hash一致のものだけ。新asset4は開いたtabが参照できるよう即時削除せず保全する。rollback-plan.jsonとbackup-manifestを固定済み。

新権限有効化・実key/grant・transport・実client接続・セキュリティ設定変更・追加restart・OS/native受入・pi-warden作業・commit/push/publish/Library保存はすべて0。Self-reviewの残る必須指摘0（独立第三者reviewとはしていない）。
