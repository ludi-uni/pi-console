# Dots連携：退避済み・設計レビュー待ち

**稼働/テストは成功、本人UX受入は未達。** 継ぎ足しを止め、現在の実装・検証成果を復元可能な個別アーカイブとして保存した。稼働環境は戻していない。今回の機能実装・D source/dist変更・再起動・接続／grant変更は0。

まず[再設計案](redesign.ja.md)と[短いシナリオ／受入条件](scenarios-and-acceptance.ja.md)をレビューする。推薦は「Dots連携」という一つの目的ガイドと、接続後の状態・解除の要約。同じ導線で必要な別権限を順に確認する。自動更新は入力draft・表示状態から分離する。

- [現状の問題と責務・境界](current-analysis.ja.md)
- [この時点の判断履歴](history.ja.md)
- [復元手順](restore.ja.md)
- [退避manifest](archive-manifest.json)：current114ファイル、phase差分214レコード、before/after・hash・元root
- [公開ファイルの状態観測](public-source-observation.json)：315ファイルのhash、他作業は内容を退避していない
- [整合hash一覧](archive-integrity.json)：portable archiveの個別bytes確認

current/は現行、phases/は各段階のbefore/afterとpatch、objects/はhashオブジェクト、current-build/は現行公開build13ファイル、evidence/は限定dummy受入証拠と13画像。旧rootは削除していない。実認証／秘密／profile／.env／実grant／repoデータは含まない。現行コードの全体をGit stashしたものではない。

本人の設計レビューで、目的ガイド、不要な権限を必須にしないこと、状態更新の契約、接続後の管理・解除の表示を合意する段階で停止する。隔離prototypeや機能実装は、この合意後の次段階として別に進める。
