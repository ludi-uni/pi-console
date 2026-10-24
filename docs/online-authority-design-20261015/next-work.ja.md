# 次の実装残と担当

設計方針は採用済み。新たなA/B質問や、service/鍵の作成はしていない。

| 担当 | 残る仕事 | 今回の状態 |
| --- | --- | --- |
| Codex | 正本APIとdevice認証port、service account/device enrollment UX、lease検証・同期guardのsource差分を隔離実装 | metadata仕様modelだけ。実認証・token署名・TLS・timer・lease guard配線は未実装 |
| Codex | approval/binding mapper、OS vault adapter、sealed pendingとCAS/receipt回復、sender continuityを92件のruntimeへ接続 | 既存不足を維持。実鍵・実storeに接続していない |
| service設計/運用担当＋本人 | 独立root/log/control registerをDB backup/restoreと分離できる具体service・権限・障害/復旧運用を確定 | vendor未選定。独立root自体の巻戻し耐性は仮定で、実証なし |
| 本人 | 具体化したservice作成/接続、account/device登録、費用・資格・ネット設定の範囲を後で承認 | 今回の承認は設計のみ。実操作の一括承認とは扱わない |
| 本人＋Codex | review可能なOS専用dummy受入と実client受入、最後に本番適用と実key/grant/MCP有効化 | 未承認・未実行。前のDPAPI成功だけで実provider完成にはしない |

仕様modelの21試験は、CAS競合、同request照合、保存結果不明、短命利用権、ネット断/復帰、boot拒否、DB/root不整合、復旧epoch、端末/grant失効、期限、遅延/nonce/clockを確認する。正本の真の耐久性、multi-region linearizability、TLS/device認証、suspend実挙動、実key/OS store、実client自動再接続を確認したものではない。

modelのtransaction64件・in-memory nonce記録はfixtureの上限であり実serviceの保存設計ではない。実装時はaudit/retentionと安全なtombstone/high-water管理を決め、古いrequestを削除した後にreplayを再許可しない。実正本の一貫性保証を確認できなければready=falseを維持する。

新modelは1 device/1 familyを扱う。実serviceのmulti-tenant/multi-familyのpartition・一意制約・跨scope拒否は別途実装・受入が必要。既存92の複数family試験を外部DBの分離保証へ一般化しない。

端末資格の有効期間・安全な更新方式は未選定。modelはdevice revokedを確認し、実資格の期限/更新は実装していない。失効資格の自動再発行を通常ネット復帰へ混ぜない。

通常のネット復旧で同じdevice/approvalが有効なら自動復帰を目指す。本人の手を要するのは初回登録、失効資格の再登録、期限切れ/変更scopeの再許可等。DB障害のたびに利用者へキーを作らせる運用にはしない。
