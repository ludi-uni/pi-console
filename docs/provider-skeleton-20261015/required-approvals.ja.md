# 実接続前の具体的な承認

本人の「状態を確認して再開して」は今回の隔離開発再開に使用した。本番適用・vault操作・実key/grant・daemon操作・実接続への承認としては使っていない。過去の「停止中」の回答も現在のjob状態の証明にしない。今回、live job / daemonの状態取得はせず、状態に依存しないpure/dummyのみを実行した。

今回の骨格に対して今、本人がキー入力・ログイン・再起動を行う必要はない。実装側で以下を先に具体化する。

1. 固定binaryの公開artifact / release / source対応を確定する。現確認source revisionで child終了/EOF/write failure→daemon shutdown であり、無停止child交換へ戻さない。
2. 実identity / issuer bootstrap / OS protected vault / durable atomic storeとfencingを実装してレビュー可能な差分を作る。今回のMemoryFixtureAtomicStoreを実vaultに見せかけない。
3. OS vaultを実際に検証する段階では、使用するOS保護方式、本人ユーザーの保存場所/対象名、読書き/削除の範囲、公開dummyのみの受入、後片付けを具体的に示して承認を得る。実credentialを使う許可とは分ける。今回は一切実行しない。

その後に必要な実運用承認を次の三つに絞る。これは将来の承認対象の明細であり、今回の許可ではない。

- **初回更新（必要な場合）**: Console / companion source・distの確定差分、固定binary、旧daemonのidentityと終了確認方法、新daemon一つだけの起動、rollback、影響を示す。その時点のPi/orchestrator停止確認と本人の明示承認後に実施。旧停止→新一つで重複を避ける。UNKNOWNなbinaryで試す承認を勝手に仮定しない。
- **ローカル連携開始**: 同じ本人browser画面で、用途別credentialの自動発行・OS protected保存/配布先、選択親folder、操作、期限、解除先を明示して本人が許可する。人がread/control/finalの3本を作る欄は追加しない。親許可にPi任意command、run/history/final本文公開、clone/push/deleteを混ぜない。
- **対応clientのmetadata-only接続**: 選定clientと対象connectionを明示し、未選択なら本人が一度だけ選ぶ。metadata確認に実接続承認を使い、repo作成・Pi実行・本文公開まで暗黙に進めない。既に選択済みなら選び直さない。

通常のcredential更新に本人確認を繰り返させないUXは目標のまま。本番providerが未接続の現在はunavailableで止める。本人の解除は連携管理一か所に結び、送信済み本文・作成済みrepoの削除とは区別する。
