# 簡素化したローカル保存・通常再起動復元

本人4ec6aa48-dd83-4072-b3ac-d08b7f3bb954の承認に基づき、外部正本/60秒leaseを必須から外す。旧608file sealとD source315/dirty15を保全。旧92のadmission契約を維持した隔離copyだけを編集する。

同期CurrentUser protection port（default未接続）と、公開固定vectorだけを扱うfake codec、所有Tempの原子的file backendを作る。approval・binding・runtime復元材料・用途別key・epoch/replay/revokeを一つの保護対象へ保存。通常起動はclosedから検証し、期限不変でrestore、内部key期限だけ切れていればfakeの通常rotationで更新する。破損/期限/本人・client・親binding不一致/不確実な保存は閉じる。一か所revokeは先にruntimeを閉じてからtombstone保存し、保存不明を完了扱いしない。

新実資格・実vault・OS crypto・本番provider/daemonは使用/設定しない。DPAPI成功受入は既存証拠を再利用するだけ。新コードのOS protection adapterはfake portで確認する。全store巻戻し、同権限悪意process、OS/admin侵害からの防御は保証外。実client自動再接続は別受入で、万能連携を約束しない。

RED→最小実装→fake保護/Temp/CAS/通常再起動/rotation/revoke/expiry/binding/失敗の受入→既存92と型検査→所有file/process照合と未適用ZIP。UI/画像0、ネット必須や新serviceなし。
