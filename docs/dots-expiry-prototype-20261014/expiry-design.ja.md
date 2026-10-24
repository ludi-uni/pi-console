# 操作許可の長期限 — 隔離契約

対象は今回の新しいprototypeだけ。旧試作、旧133ファイル配布、旧114files/725hash保全、D稼働source/dist/実grant/tokenを変更しない。

1か月は**31日（31×24時間）**、1週間は7×24時間。暦月と混ぜない。既定は従来15分。操作grantは`{kind:'until',at:<absolute epoch ms>}`または`{kind:'none'}`を明示し、noneは本人の別checkbox確認を記録する。missing/null/不正値をnoneと解釈しない。

三つの期限を分ける。

- 操作grant：owner、exact対象（directoryのpath/identity、workspaceのpath/session/generation）、操作と期限を保存。1週間/31日/期限なしをbackend policy guardでも扱い、480分には切らない。
- 接続資格：メモリのみの有限480分以下。grantの長期限とは別で、期限到達／再起動で失効し、同じgrantでも本人が現在のtargetとscopeを明示して再確認するまで操作を許さない。tokenの無期限化／自動refreshは行わない。
- 転送保持：有限1時間/8時間/1週間/31日をdummyで扱う。stdioはTunnel不要。転送を長くしてもgrantを延長しない。

現在Dの一次sourceではTRANSPORT_MINUTESは60/480/44640で、31日の専用保持と24時間timer chunkがある。**10080（1週）はそのsourceにはない**ため、既存で提供済みとは記載しない。新prototypeの1週転送は明示した模擬追加。D側のコードは変更しない。

新policy storeはversion2、strict schema、非秘密のowner/target/operation/expiry/consentと結果nonceだけを保存する。接続資格・token・credentialsは保存しない。有限旧versionはabsolute終了をそのまま移す。既存grantの保存再読込・移行・resumeで期間を計算し直して延長しない。clock floorとexpired/revoked/target_changedの状態を保存し、戻ったclockで復活させない。

再起動では保存grantが残るが、runtime接続世代は失効。directory identity、workspace/session/generation、owner、操作を照合して明示再確認する。新sessionへ黙って転用しない。noneを選んでも全workspace・親folder・本文共有・file一般操作・任意processを増やさない。解除でrepoや送信済み本文は消さない。

これはprototype-only policy engineの設計・実装で、現行FolderMcp/PiControlActivationの実永続化対応を完成させたものではない。旧engineの8時間制限を単にUIで隠さず、新policyを独立にenforceし、有限runtime lease失効は別の状態として表示する。directoryの既存file一覧/read/write/rename/delete/process未対応は維持。
