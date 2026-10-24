# 保存backendの隔離dummy実装計画

対象は pi-console の既存provider fixtureだけ。Dの実行source、dist、設定、実daemon、実credentialは変更しない。新しいTemp所有rootに現source315ファイル・tracked dirty・既存fixtureを保全し、旧sealを照合する。

## 今回の操作
1. 保存・再読込のRED試験を実行。
2. 公開固定dummy値専用のfile storeを作る。owner/client/resource/scope/generation binding、epoch、使用済hash、鍵receipt、解除状態、writer fenceを一つのversioned envelopeに収める。
3. 排他作成lock下でrevision/fenceを確認し、同じdirectoryの一時fileへwrite+fsync後rename。応答喪失はunknownとして閉じる。mock codecだけを使用し、暗号保護を主張しない。
4. 再読込、別Node helper、expiry、同時更新、保存failure、replay/revoke、binding不一致、公開値以外拒否・非露出を検証。既存26契約も再検証する。
5. scoped typecheck、自己review、source/dirty/旧seal保存確認、dummy所有file/process終了照合、ZIPで未適用差分を納品。

## 実際の利用手順（将来の本人承認後）
ローカル連携開始→本人browser確認→親folder/操作/期限を選択→対応MCP clientへ受け渡す既存設計を維持する。今回追加backendはその実用経路に接続しない。公開dummy receiptのsave→同bindingで再open→epochとreceipt読戻し→revoke→再openして拒否、を自動試験する。

## 明確な限界
OS暗号APIは再実行しない。成功済DPAPI受入（Protect1/Unprotect3、dummy2files削除確認済）を証拠として再利用。mock codecは暗号でなく、実秘密を受け付けない。filesystemの電源断耐久、古いblobへの外部rollback、native reparse/path競合、実vault ACL、実runtime鍵切替との分散atomicityは証明しない。default realConnectionReady=falseを維持。UI変更/画像/操作は0。Pi/SDK/native/HTTP listener起動は0。
