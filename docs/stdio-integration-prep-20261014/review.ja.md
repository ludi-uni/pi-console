# 自己レビューと適用境界

対象は独立 Temp の stdio / discovery / Folder 統合。source への未適用差分であり、実 client の接続完了ではない。

外部 MCP の initialize、通知、server/discover、tool 名・引数・catalog を保持。clientInfo は認証に使わない。追加の continuation capability は別の private discovery。既存 discovery の version 1 は変更しない。CLI main は従来経路のまま。実 provider が未接続なら ready=false / realConnectionReady=false。

信頼境界は Folder 管理 API の本人選択 root / operations / grant expiry。Pi の OS sandbox ではない。親許可は run/history/final 本文の公開、任意 clone/command/push、削除や既存データ上書きを許可しない。今回は metadata のみを fake provider で実行。native の親 handle・reparse・TOCTOU の保証は今回検証していない。activation は provider.withParent の pin/guard 契約内で行う。

credential は用途別 read/control/final/handoff/renewal を分離。fixture では公開固定 hex vector を注入。秘密は private claim と private header/body 内だけであり、MCP result・URL・argv・log に載せない。初回 bootstrap は trusted composition の責任。人がキーを作る欄は追加していない。

初回 status を共有 Promise で束ね、同じ request の二重クリックで二つの内部 client を作らない。更新は一つの client の serial queue。応答喪失は unknown として止め、同じ receipt / requestId で照合。別 requestId で使用済み renewal を再送すると revoke。owner grant は 7/31 日または明示 none、credential は 5 分。この opt-in がない legacy は既存の期限契約を維持する。

本人 cookie を通常の更新には要求しない。sender identity / restart proof、approval policy、issuer、protected vault、persisted clock・epoch、runtime stage/activate は別 port。今回の identity/vault/epoch は memory fake。実 provider の安全性、永続化の atomicity、restart lineage は未証明。epoch 保存が失敗した場合は copied Folder を無効化して応答を拒否する。native durability の代替とはしない。

既存 cancel_local_connection は companion handle を閉じるだけ。本人 grant 解除は bridge.cancel → approval.cancel → runtime/vault invalidate。repo、送信済み本文、Pi job を削除・停止しない。

検証記録の制限: 初期試験の HTTP ledger は試験ごとに上書きする不備があった。各 teardown は close 後 !server.listening を assert したが、初期 run の正確な PID/port 一覧は保持できていない。以後は作成時に永続記録し、append で保存する。http-ownership.json の各記録についてのみ exact ownership と終了を主張する。過去の識別子を推測して復元しない。

今回 browser UI は変更していないため新規画像 0 / UI 操作 0。以前の dummy UI 証拠は以前の報告に属し、今回の stdio 統合の実 client PASS に流用しない。再起動後の入力画面が表示され空欄取消できたという本人の回答も、今回の continuation 本番適用の承認にはしない。
