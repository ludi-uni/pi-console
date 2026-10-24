# 実接続前に別途確認する項目

この表は承認や設定を実行した記録ではない。実値・秘密を収集していない。準備段階で停止する。

| 項目 | 別途確認する内容 | 現在の状態 |
| --- | --- | --- |
| 接続client | Dots＋既存local stdio companion、または一般MCP client。正式な起動/設定経路、対応protocol、保護されたhandoffの能力 | installed commandのsourceは確認。実clientとの互換性未検証 |
| 本人/継続主体 | 初回owner、認証されたclient instance、同じ対象のdaemon/Console再起動を証明する仕組み | SenderPortの契約だけ。clientInfo/名前/PID単独は不可 |
| folder対象 | 本人が選ぶabsolute parent、volume/file identity、reparse/差し替え等の安全性 | 実rootは未選択・未許可。実provider/native未検証 |
| folder操作 | metadata、新規child、必要な空repo、必要なworkspace登録を個別選択 | adapter fixtureはmetadata/directoryだけ。実repo作成・登録は未実施 |
| Pi control対象 | 選択workspace/session/generation/instance/revisionと許可操作 | 実対象未選択。folder許可からcontrolを導かない |
| read/final本文 | 読むfeatureとexact対象/run、既存の本文共有への影響 | 別承認。長期連携から全history/finalを公開しない |
| 利用期間 | 7日/31日/明示none。同じトンネルと許可を固定し、資格は短命に更新 | 型/fixtureのみ。現行SettingsTunnelの選択は有限1h/8h/31日。7日・noneの本番対応は未実装 |
| 更新資格 | read/control/final、private handoff、sender-bound renewalの用途分離・一意性・回収期限 | IssuerPort未接続。実token生成は0。人に3本のランダムキー作成を要求しない |
| 秘密保存/配布 | vault保護、sender proofの保持、短いreceipt回収、取消/clock floor/epochの永続化 | 保護vault/runtime checkpoint未実装。既存profileの値は読取/変更しない |
| 外部トンネル鍵 | 取得方法・寿命・clientへの割当・取消。必要なら本人専用の入力画面 | source上はCONTROL_PLANE_API_KEYを使う。実値は未取得。ここに貼る/URL/argv/logに置く手順は禁止 |
| daemonの扱い | 現在のdaemonを保持できるか、新companion/契約への切替に再起動が必要か | 既存daemon無変更。保持pipeだけでは新世代を証明できない。停止/交換は別途承認が必要 |
| 公開範囲 | private loopback brokerとMCP public listenerの分離、proxy拒否 | 未登録のhandlerだけ。public/Cloudflare MCP拒否を解除しない |

初回の一画面で、対象・操作・期間・同一条件の自動更新をまとめて確認する設計を維持する。正常更新で再承認・画面再読込を求めない。新対象、新操作、新client、未証明の再起動、取消/秘密流出等の例外は停止して確認する。取消はrepo/送信済み本文/実行中Piの削除や停止ではない。

MCP HTTP認可の一次仕様はOAuth/PKCE/refreshを扱うが、stdioとは別経路。このlocal brokerは独自の内部契約であり、標準OAuthサーバー完成やDots refresh対応の証拠ではない。[MCP](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)、[OAuth refresh保護](https://www.rfc-editor.org/info/rfc9700/#section-4.14)。
