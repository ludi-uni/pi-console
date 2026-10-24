# 承認済み再計画への追加：directory対象

元の114files／725展開hashアーカイブと設計文書は変更しない。この追加版を隔離rootへ保存し、現行D source/dist・実認証・接続／grantへ適用しない。

「Dots連携」→対象を「登録workspaceの選択session」「許可するdirectory配下」から選ぶ。directoryのためにworkspaceを作らない。root・操作・期限の下書き→接続の照合→その対象の最終許可確認→状態／解除を同じ導線で扱う。directoryではparent scopeだけ、workspaceでは既存exact session/generation契約だけを使う。目的に不要な権限や本文共有を付けない。

## 既存契約と今回の対応

既存FolderMcpのcreate_managed_workspaceは名前にworkspaceを含むが、workspace:falseで登録なしの新規directory／固定空repoを扱える。試作では公開純粋moduleを変更せずコピーし、in-memory Windows portを注入する。各操作はUIフィルタでなくFolderMcpの期限・operations・root照合とproviderのidentity/handle検査を通す。実filesystem／native／Git／SDKは呼ばない。

| 操作 | 既存folder契約 | 今回の試作 |
| --- | --- | --- |
| 許可rootと作成結果のmetadata照合 | list_allowed_parents/get_operation。全child一覧／本文ではない | dummyで対応 |
| 指定root直下の新規directory作成 | exclusive single-component create。既存nameへの上書き禁止 | dummyで対応、workspace登録0 |
| 新規directoryに固定の空local repo構造を生成 | 固定.git layout。Git process・hooks/template・cloneなし | dummyで対応。実Git認識は今回未検証 |
| 既存fileの一覧・本文読取／任意write | current公開APIなし。read roleの名だけで本文読取とは扱わない | 未対応・要求拒否 |
| rename／delete／既存上書き | current公開APIなし | 未対応・要求拒否 |
| 任意shell／process／Pi実行をdirectoryに閉じ込める | folder scopeはOS sandboxではない | 未対応。疑似成功を返さない |
| workspace登録 | 独立workspace operationが必要 | directory modeでは要求せず呼ばない |

rootはdrive付きabsolute Windows pathを厳格に扱う。現在のcanonicalParentはASCII componentの限定契約で、相対／..／slash別表記／UNC／device／ADS／予約名／trailing dot-spaceを拒否し、caseを正規化する。新規childは単一nameだけ。case衝突も上書きしない。未知のunicode/case-sensitive／volume／identity／reparseは「確認不能」として拒否し、勝手に緩めない。

providerはvolume rootからcomponentごとのrelative handleを検査し、全reparse tag・junction/symlink・別volume・caseSensitive・未証明volumeを拒否。review時identityと実操作時identityを再照合し、各副作用の直前にguardを呼ぶ。差し替えや途中失効では拒否またはpartial receiptを残し、既に作ったdummy artifactを削除・再試行しない。今回のmock試験はこのsource orchestration契約を確認するもので、Windows native flags／実TOCTOU耐性の再証明ではない。

将来のread/writeには、既存fileのhandleベースopen/read/write、全ancestorとfinal fileのreparse・identity・volume検査、hardlink/alias、size limit、overwrite/partial-write契約が必要。rename/deleteにはsourceとdestination双方の権限・root identity・名前競合・root自体保護・再帰禁止等が必要。既存portにそのAPIがないため今回は実装しない。process isolationは今回のscopeから外し、未対応として返す。pi-wardenへ戻らない。

## 編集と状態

draftとserverSnapshotを別に保持。背景取得は操作busyを使わず、draft、focus、選択位置、scroll、detailsを変更しない。応答はquery sequence／snapshot revision／画面epochで新しいものだけ適用し、戻る／中断後の遅延結果を捨てる。失効・generation変更は確定を止めて通知し、draftは消さない。未完了mutationは同じrequestで照合し、二重送信を防ぐ。sessionStorageに入れるのは非秘密draft・journal参照だけ。storage禁止時は画面内memoryで操作可能。

画面の本人確認・client照合・許可・作成はすべてdummy。実grant、purpose credential、本人profile/cookie、MCP有効化、実client／SDK／Pi／native操作は0。一般MCPのstdio選択も同じ画面で模擬し、Dots実Appの能力を保証しない。正式適用前の本人レビューが終点。
