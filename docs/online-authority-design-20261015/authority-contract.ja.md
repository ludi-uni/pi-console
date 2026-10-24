# 正本CAS・復旧の契約案

以下はwire API/認証プロトコルの実装ではなく、内部portの意味を固定する仕様。公開HTTP endpointや実資格は作らない。実認証にはreviewした標準方式を選び、device proof、audience、scope、nonce、TLS応答の現在性を検証する必要がある。自作の署名方式やmock metadataを実トークンに転用しない。

| 操作 | 検証と効果 |
| --- | --- |
| Current | 認証されたdeviceとfamily bindingに対し、正本のapproval/device状態、epoch、recovery epoch、revisionを返す。projection未検証・root不通なら拒否。返却だけでローカル権限は開かない |
| RotateCAS | requestId、fingerprint、expected family epoch、approval revision、recovery epoch、binding commitmentを一致させて正本で一度だけcommit。競合は409相当として閉じて再照合。変更したscopeや任意clone等を混入させない |
| Result | 同device/binding/request/fingerprintで2分内・現在epochなら同じcommit結果metadataへ照合。古い/別fingerprint/別復旧epochは拒否。key本文や無期限の旧leaseを返さない |
| Lease | 正本の現在device/approval/binding/epochに対するfresh nonce付き短命利用権。60秒、role期限、grant期限の最小値。正本CAS receiptをそのままleaseとみなさない |
| RevokeDevice / RevokeGrant | 独立正本へ失効とrevisionを記録。DB復元で消さない。接続中へ失効通知できても、未検知端末の既発行利用権の残存上限を明示する |
| RecoverProjection | 利用権発行停止→独立root/control registerでrecovery epoch更新→正本からprojection再構成・照合→監査確認後に発行再開。通常のclient権限では呼べない |

CASのlinearization pointは独立正本への条件付きcommit。ローカルstoreやprojection DBだけのcommitではない。正本commit後にprojection/応答が失われたらunknownとして閉じ、request照合か復旧手順へ進む。各層を跨ぐatomic transactionが既にあるとは主張しない。

CASのpartitionはowner/device/client family/bindingで分ける。別familyのepochを同じ権限として使わない。実認証資格、lease proof、private keyをURL・argv・log・公開MCP応答・チャットへ出さない。監査は非秘密request ID/世代/結果に限定する。認証済み私用channelでのみ必要なproofを扱い、clientInfoを権限の根拠にしない。

DB復旧epochが変わったら旧nonce/lease/pending要求を使ってopenしない。新epochでCurrentからやり直す。既存approval/device失効は正本に残る。recovery epoch変更を口実にexpired/revoked grantを延長しない。旧ローカルblobから古いepochを提示してもCASが通らず、ローカル側を新しい正本で再照合する。

復旧epoch変更も、未検知の既発行leaseには最長60秒の残存を許す。変更を検知した端末、新boot、再照合した端末は旧epochを拒否する。ネット越しの全端末瞬時無効化を保証する設計ではない。

### ローカル状態機械

| 状態 | 受理 | 次の遷移 |
| --- | --- | --- |
| BootClosed | 旧新keyとも拒否。cached lease無効 | fresh online Currentへ |
| ReconcilingClosed | prepare/CAS/persist/lease照合中は拒否 | 一致・保存完了・fresh lease確認でOpenへ |
| Open | ローカルrole期限と外部lease期限、binding、世代の両方が有効な管理操作のみ | 通信失敗/不確実時計/失効通知/期限切れでClosedへ |
| NetworkClosed | 通信復旧を待つ。人のkey入力を要求しない | online再照合成功で自動Open、失効ならBlockedへ |
| Blocked | device/approval失効、parent/continuity不一致、root/DB不明 | 理由に応じ本人再登録または運用復旧。勝手に資格を再発行しない |

Console起動直後のreadinessは、外部サービスの疎通だけではtrueにしない。標準device認証、正本整合、承認/親/peer、OS store、ローカルcommit、実runtime lease guard、対応client受入が全て必要。
