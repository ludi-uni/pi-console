# 通常設定と本人管理の導線差・最小修正案（未実装）

**通常の「設定→ローカルMCP」は旧SettingsLocalMcpのまま。前回更新したLocalOwnerは別の本人管理画面であり、通常設定の改善を満たしていなかった。** Dではない別packageや古い配信が原因ではない。今回読み取ったsourceと、親が実見したスクリーンショットの「フィオにつなぐ」「ローカルMCP連携」「ローカル連携を始める」、左の独立「Dots ワークスペース権限」は一致する。コード変更/適用は0。

## 現物の対応

| 入口 | 表示component・認証・API | 現状 |
| --- | --- | --- |
| 通常Consoleの設定→ローカルMCP | main.tsx:484→SettingsPage.tsx:41→SettingsLocalMcp.tsx。/api/settings-local-mcp/statusでAccess本人登録状態を取得 | SettingsLocalMcp.tsx:41がauthenticatedOwner時にFioConnectionとLocalFolderMcpを直接表示。新LocalResumeMcpのimport/表示なし |
| 通常設定→Dots ワークスペース権限 | SettingsPage.tsx:8–9,42→WorkspacePermissions。/api/workspace-permissions、/api/local-mcp等 | 別メニューで既存workspace/session read/controlとexact finalを管理 |
| loopback本人管理 | LocalOwner.tsx:16,20。/local-owner/auth/statusの一回コードcookie境界 | 認証後はLocalResumeMcp available={status.resumeAvailable===true}。OFFでも新しい下書き画面を表示 |

LocalFolderMcp.tsx:27–28が旧「キーを3本作る必要はありません」「ローカル連携を始める」を描画する。FioConnectionは別用途のPi sessionへの接続で、親フォルダの新OFF previewではない。新LocalResumeMcp.tsx:12–35のInactive部分だけが新しいメモリ内下書き画面。Active部分は:40で/local-owner/resume/を固定利用する。

settings-mcp.tsのstatusはresumeAvailableを返しておらず、通常設定の本人登録済み状態とloopback owner cookieは同一の認証契約ではない。ownerUrlは厳格なローカルstatus条件かつ既にbroker待受時だけ返るが、現在SettingsLocalMcpは表示に使っていない。単に通常設定へActive componentを載せたり、Access本人登録をloopback認証済みとして扱ったりしてはならない。

## 推奨する最小修正

ユーザー追加指示は「Dots ワークスペース権限」の**独立メニューをなくす**こと。権限チェック・grant・既存許可の廃止ではない。次の構成にまとめる。

1. 通常の「設定→ローカルMCP」を唯一の入口として残す。本文先頭に既存LocalResumeMcpを明示的available=falseで再利用し、**権限機能はOFF／画面の流れを確認**を直接表示する。新OFF previewは送信・保存・資格生成しないので、Access owner登録やloopbackログインをこの表示確認の必須作業に増やさない。通常設定のstatus読取が失敗しても、previewを使えなくする必要はない。実管理の認証は従来どおり別に維持する。
2. 現在主画面に並ぶFioConnectionとLocalFolderMcpの旧開始導線は、既存利用者向けの**「既存の接続・権限を管理」**へまとめる。新previewと旧開始ボタンを同列に並べない。既存API prefix、onStart、request/result照合、storage key、登録/解除処理を作り替えない。登録本人確認・owner登録/結果照合/解除の機能もここから到達可能に保つ。
3. 左の「Dots ワークスペース権限」を削除し、その管理機能は上記接続文脈の**「ワークスペース・セッションの権限を確認／変更」**から開く。read/controlの対象workspace・session・generation・解除内容の確認と、exact final本文共有の別承認を保つ。親folder許可だけでrun/history/final本文やPi制御を追加しない。
4. 既存権限editorは全体snapshotを編集する契約なので、接続IDだけの権限editorであるかのような表示や暗黙の絞込みをしない。選択中接続の下から開いても、**既存workspace/session権限全体の管理**と明記する。接続ごとのfilter導入で他の許可を落とすようなsave変更は今回含めない。finalも独立承認であることを明記する。

表示の流れは、設定→ローカルMCP→新OFF画面→画面の流れを確認→親folder/操作/期限の下書き→未保存の確認。通常設定の既存メニューから1clickで新OFF画面へ入り、他の本人管理ページへ移動しなくてよい。既存の実接続・権限を扱うときだけ同画面内の管理項目を展開する。

## 変更対象（案）

- **web/SettingsPage.tsx**: permissionsのSection/labels/nav/detail分岐とWorkspacePermissions直importをなくし、SettingsLocalMcpへ言語を渡す。local-mcpの入口は維持。
- **web/SettingsLocalMcp.tsx**: 新OFF画面の再利用、既存Fio/Folder/owner機能の接続管理内への配置、WorkspacePermissionsの必要時表示を追加。apiPrefix=/api/を維持し、loopback cookie/APIへすり替えない。
- **web/WorkspacePermissions.tsx**: 必要なら表示名/aria名を「ワークスペース・セッションの権限」にする最小の文言変更だけ。review/save/result/cancel、scope/schema/API、TrustedLocalMcp/FinalOwnerの権限処理は変更しない。
- **tests/workspace-permissions-browser.test.ts / tests/final-owner-browser.test.ts / tests/final-owner-ui-edges.test.ts**: 独立メニュー名を押す前提を、新しい接続管理内の導線へ変更する必要がある。今回まだ変更/実行しない。後続でtest本体の副作用を確認したうえでdummy経路だけに限定する。

LocalOwner/LocalResumeMcpの既存OFF/Active契約、server/settings-mcp.ts、各権限backend、manager、credential保存、transportは今回案では変更不要。既存CSSの再利用を基本にし、画面実装で必要となった場合だけ狭い余白・配置調整を追加する。

WorkspacePermissionsはmount時に自身と既存子componentの読取が動く。したがって、閉じたdetailsの中へ常時mountするだけの移動は避け、利用者が権限管理を選んだときだけmountする。内部に凍結済み診断も含むため、今回そのcomponent/診断の中身へ立ち入った変更や試験を拡張しない。実装を承認された後のUI dummyではOS/診断専用routeを遮断し、実OS試験0を維持する。既存のpending照合IDを新previewの破棄/戻るで消さず、既存編集を閉じる際は未保存の扱いを明確にする。

## 他案との比較・既存承認との差

「通常設定に本人管理ページへのリンクだけ追加」は小さいが、別認証/別画面への移動が必要で、今回の通常設定の旧表示と独立メニュー問題を解決しないため推奨しない。新Active接続を通常設定へ移植する案は別認証契約と新API接続が必要で、OFF表示だけという現在の承認範囲を超える。**既存の純粋OFF画面を通常設定で直接再利用し、既存管理UIを文脈内へ移す案**を推奨する。

既存承認manifestのsource3は LocalOwner.tsx / LocalResumeMcp.tsx / local-resume-review.css であり、SettingsPage/SettingsLocalMcp/WorkspacePermissionsは含んでいなかった。main側bundleがchunk分割により更新されても、この通常設定sourceは変わっていなかった。このため前回source3/dist14適用成功と、通常設定に旧UIが残ることは両立する。新案は別のsource/test対象とbuild候補を固定し直す必要があり、以前の固定ZIPを再配信するだけでは直らない。

## 後続で必要なdummy確認（まだ未実施）

通常SettingsPageそのものを使用し、通常設定から新OFF画面へ到達、左の独立Dots項目なし、preview中は新権限API/資格/transport要求0、初回/owner未登録/Access owner/読取失敗をfake応答で検証。既存接続管理・workspace/session read/control・exact finalの表示/編集/取消/失効結果が到達可能で、従来と同じAPI prefix/認証ガードであることを確認する。選択・戻る・再読込・pending復元・狭い画面・キーボード・変更取消で既存grantや照合IDを落とさないことを検証する。単にLocalOwnerのfixtureを見るだけでは受入にしない。

## 証拠と今回の操作

親が実見したLibrary画像IDは libfile_2224d1b3acd0819180f7231451695fc5、filename image(20261016-053437).png。本agentは公式prepareを行ったがconsumer-localのbytesは得ておらず、Python WindowsApps aliasが起動できなかったためhelperの実行/代替downloadはしなかった。**こちらで画像の実ピクセルを見たという主張はしない。** 画面表示については親の実見と一致するsource行を根拠にしている。署名URLやtokenは出力・保存していない。

今回読み取った13sourceのhashと、適用済みsource3/dist14全17件の一致、既存tracked dirty15不変を記録した。Console HTTP操作0、実ブラウザ操作0、テスト/build0、source/dist変更0、設定/認証/接続変更0、restart/install/update0、権限有効化0、実key/grant0、pi-warden作業0。作成物はこの調査・最小修正案と証拠のみ。
