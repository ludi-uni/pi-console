# 現状の棚卸しと問題の根拠

## 観測したこと

本人の指摘：ローカルMCPとDotsワークスペース権限が分かれ、順番が分からない。定期更新が操作を妨げる。「フィオにつなぐ」は本人限定の表記で、製品UIのDots連携ではない。Sentinel_052b7016abbc8191bdf5dddf4c5fc8a1、再計画承認Sentinel_8f45a4fbca6c8191bba7b4dce86e8d60。

現在の公開315ファイルのhashは最終受入・適用時の期待値と一致した。Git HEADとdirty状態を変更していない。実装所有範囲は適用manifestの列挙と変更前後の連鎖で識別した。Gitの全diffを今回の成果とは扱わない。

| 問題 | 現在のコード上の根拠 | 利用者への影響／未確認点 |
| --- | --- | --- |
| 入口が分かれる | current/web/SettingsPage.tsxのsectionにlocal-mcpとpermissionsが別にあり、それぞれ「ローカルMCP」「Dotsワークスペース権限」 | 設定の選び方から内部責務を理解する必要がある |
| 同じページ内にも開始口が複数 | SettingsLocalMcp.tsxがFioConnectionとLocalFolderMcpを並置。WorkspacePermissions.tsxにはTrustedLocalMcpとFinalOwnerがある | どの目的にどれが必要かの案内が全体としてつながっていない |
| 自動更新が操作処理と同居 | FioConnection.tsxの周期effectはopen・非busy・非review・非errorで2.5秒後にrun(refresh)。runは操作lockとbusyを使う | 選択中でも更新が開始され、ボタン等をbusyにできる。本人の妨害報告と一致する経路。実画面の秒単位の妨害率は測定していない |
| 編集意図とserver状態が近すぎる | 同refreshでcontrol/transportを更新し、接続選択をserver一覧から再選定する。WorkspacePermissionsのrefreshはselectedを空にし、phase/listとconfirmedをリセットする | 更新と編集の契約が全体で統一されていない。全入力が毎回消えるとまでは主張しない |
| 固有名が製品名になる | FioConnection.tsxの見出し・ボタンと主段階の文言に「フィオ」 | 他のDots利用者や一般MCP clientの導線として通用しない |
| 実装試験がUXを代表していた | 直前のD回帰171件、dummy UI8ケース／71操作／13画像、型212入力で診断0、正常起動の証拠はある | その試験は本人による自然な操作順・長い編集・周期更新との共存を合格させる証拠には不足していた |

参照ファイルはアーカイブのcurrent/にコピー済み。最新dummy証拠はevidence/にある。入力妨害の根拠は本人レビューとsource経路の一致であり、今回本番操作を再現した結果ではない。

## 現在の責務と境界

| 責務 | 現在の構成 | 何を許可したことにはならないか |
| --- | --- | --- |
| Consoleの管理者本人 | 検証済みAccess登録本人、または既存のloopback本人認証。settings-owner/settings-mcp/local-owner-bootstrap | 登録だけではMCP接続・親folder・Pi操作・本文共有を許可しない |
| MCP経路 | literal127の本人broker、stdio companion、既存の所有Tunnel。公開listenerはMCPを拒否 | 接続できても対象操作や本文が許可されたとは限らない。clientInfoや表示名は認証にしない |
| 登録workspaceと観測session | PiConnectionPreparationが登録先・canonical path・header・generationを照合。SDK open/createは本人の明示操作 | workspace表示は実行開始ではない。Pi/SDK/extensionsを信頼する前提で、任意PiコマンドのOS sandboxではない |
| 基本workspace範囲 | WorkspacePermissions、workspace-permissions、trusted-local-mcpのread/control、instance/revision/session generation | 選択や保存でtransport・identityを作らない。複数clientから共有される範囲を一client専用と表示しない |
| exact Pi操作 | PiControlActivation／composition／HTTP、内部用途別credential、期限付きexact target grant | 全履歴／最終回答本文の共有、親folder作成、orchestrator・queue/background等の任意制御を暗黙に付けない |
| 親folderの管理API操作 | FolderMcp／LocalMcpGrants／managed registrationとsafe provider | 許可配下の新directory／local repo／workspace登録等だけ。既存上書き／削除、任意clone、push、公開、任意command初期化を含まない |
| 結果・exact final共有 | 既存results-read／final-ownerの個別契約 | 接続・親folder・Pi操作の許可だけから本文公開を導かない |
| 転送寿命と解除 | SettingsTunnelの所有・期限・結果照合、各許可のrevoke | 31日転送はPi権限期限ではない。解除で実行中Pi・送信済み本文・作成済みrepoを消したことにはならない |

## まだ確認していないこと

実Dots Appの全catalog／binding、一般clientごとのsecure import／再検出機能、実認証画面・実grant・実folder作成の今回の動作は未確認。既存のscope storeは共有範囲を持つため、将来の「この接続だけ」のUIがbackend実態と一致するかも契約確認が必要。親folder providerやSDKを新しく試験・設計したわけではない。凍結対象の診断・OS隔離へ話を広げない。

アーカイブは公開実装の保全で、秘密・認証cookie・profile・.env・所有者実データのbackupではない。したがって認証済み状態や稼働接続をそのまま復活させる成果とは説明しない。
