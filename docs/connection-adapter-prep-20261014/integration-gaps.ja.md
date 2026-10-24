# 現行実装との照合と必要な差分

baseline/の13ファイルはDの現状をコピーした比較資料。現在のHEADは23815ba260320e3fc720ad3288ca89728f99b4f7、version0.5.2。重要な未コミット変更を維持する。baselineを編集していない。準備コードを本番へ適用していない。

| 現行の契約 | 準備adapterとの違い | 実接続までに必要な変更 |
| --- | --- | --- |
| connection-expiry MAX_CONNECTION_MS=8h、MAX_GRANT_MS=24h | 承認期間7/31日/noneと資格5分を分離 | 認証・承認・転送のexpiry型を分離し、旧有限期限を勝手に延長しない移行 |
| FolderMcp.approveはmin(owner expiry,8h,grant expiry)でconnectionUntilを決定 | owner cookieは初回承認だけで通常更新に不要 | 長期continuation family、短命credential rotation、明示noneと固定root/scopeの永続契約 |
| PiControlActivation/PiControlCompositionは静的credentialsでlistenerをstartし、closeはappをdispose | 更新でdaemon/listener/Piを停止・交換しない | 既存runtimeでstage→比較付きactivate→旧資格無効化を原子的に行う専用port。既存start/closeを更新ごとに呼ばない |
| TrustedLocalMcpのcredential epochとexact grantが結び付く | 短期rotationと承認済みscopeを独立させる | continuation family/grant epochと資格rotation epochを分離。scope・exact read/final期限を延長/拡大しない |
| local-folder companionはclaimを24h以内として検査し、短期connection expiryでwipe | 内部clientが短期資格更新を担当し、公開MCP結果は秘密を含まない | 明示した新continuation capability、同一接続の更新hook、長期承認状態を別扱い。古いdaemonを互換と見なさない |
| owner profileは手動3資格・max24h・separate approval and restart | 人が3本を用意しないprivate issuer/vault | 保護された生成・保存・handoffのproviderと適用設計。現在のprofile値を転用/配置しない |
| SettingsTunnelは有限60/480/44640分、longTransportだけowner identity保持 | 継続許可7/31日/noneとトンネルを連動 | backend/nativeの明示型、取消と期限の共通lease、未知世代の停止。無期限を巨大timestampへ置換しない |
| verifyConnectionはsame view + held pipe | 再起動でも同じclient/対象の証明が必要 | 認証された再起動lineageを提供する実SenderPort。PID/表示名/health 200だけでは不可 |
| folder/native compositionはcandidateOnlyの固定bindingを照合 | adapter fixtureには実providerがない | 実provider/native/Windows安全性の確認は別の承認と検証。今回は行わない |

実装済みは未登録のContinuationBridge、private loopback HTTP handler、companion内部client、型宣言、fixture。既存Folder/Pi/nativeのport実装・MCP toolcatalogへの組込み・discovery capability・production compositionは未実装。未接続providerをPASS/利用可能としない。

既存のcancel_local_connectionはhandle切断、owner grant解除はConsole側という契約を維持する。新helper.cancelは継続familyの取消用であり、既存toolへ無断で置き換えない。UIの一か所の解除へ結び付ける際は、対象client/familyと影響を明示し、他clientや実行中Pi、作成物へ拡大しない。
