# 設計・offline model review

対象はonline-authority-spec.tsと21仕様試験、設計文書。既存92の実装は変更なし。

確認点: CAS/同request照合、projectionと独立rootの区別、復旧epoch、短命leaseの期限算出、boot online必須、nonce/approval/binding一致、ネット失敗時のclosed、通常復帰と資格失効の区別を確認。

修正済み: fixture lease検証をpublic methodへ直接渡すだけでは、fresh online要求の存在を表せなかった。reconcile内で作るone-use pending contextを必須にし、cached lease単独でopenできない契約へ修正。leaseのnonce、approval revision、authority revision、recovery epochの不一致も拒否する。これは実認証/署名検証の代わりではない。

実運用blocker:
- 高: AuthoritySpec.truthは独立・非巻戻しを仮定するin-memory model。外部log/control registerの耐久性、linearizable CAS、backup分離、復旧運用は未実装・未証明。rootとDB同時復元のnegative controlでは失効が消える。
- 高: device認証、TLS・署名されたfresh response、実nonce生成・保存、OS vault、承認/peer/binding、runtime lease guardとtimerは未接続。mock metadataは実leaseではない。
- 中: lease上限60秒は仕様値。ネット断/遠隔失効の瞬時反映は保証せず、実clock/suspend・timer・client再接続は未検証。
- 中: localCommitOkはmetadata保存を仮定するbool。実role keyの準備・sealed pending・結果不明回復を実装したとは扱わない。

限定仕様内の未修正必須指摘なし。接続readyは常にfalse。service選定や実操作へ範囲を広げない。
