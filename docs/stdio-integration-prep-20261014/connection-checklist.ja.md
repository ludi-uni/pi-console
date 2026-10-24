# 初回実接続までの残件

推奨経路は既存 stdio companion を保った内部更新。公開 tool に refresh を追加せず、本人確認後の親 folder / operations / grant 選択を保持する。対応 client の初回連携は「開始 → 本人 browser 確認 → 親と操作と期限 → private bootstrap → metadata 確認」。通常の更新は人の再ログイン・キー作成を要求しない。

今回できたもの: actual Folder class の独立コピーへの opt-in rotation、private discovery、trusted companion factory、内部 serial/background client の接続、dummy での epoch / scope / receipt / revoke の結線。設定欄を増やすだけの実装ではない。

実接続前に必要なもの:

1. 使用中 client の固定 binary と公開 source / release の対応確認。現在 UNKNOWN。CLI / binary / daemon を実行していない。
2. client identity と再起動 lineage を検証できる provider。clientInfo や固定文字列を本番認証にしない。無証明の restart は拒否する。
3. 本人 policy を authoritative に保存し、初回用途別 bundle を配布する issuer / bootstrap と OS protected vault。今回は memory fake のため未対応。人が 3 本のキーを作る fallback は導入しない。
4. durable epoch / receipt / clock と runtime atomic activation の実 provider。失敗時 invalidation の保証まで確認する。
5. native Folder provider の volume/file identity と pinned handle、全 ancestor reparse 拒否、create-only git init / workspace registration。今回の fake metadata 証明から native 安全性を導かない。
6. 既存 daemon を維持した companion child の安全な更新/再起動を実 source と一致する形で確認。現在 UNKNOWN。同じ Tunnel ID の daemon を重複起動しない。
7. 上記と owner UI / server composition を接続し、選定された client の metadata-only 試験を本人の実接続承認後に行う。production source/dist/config は今回未変更。

不足機能を持つ client に自動更新が動くと約束しない。最小 fallback は既存の bounded stdio 経路で一つの接続 handle を使い、期限切れを明示して停止すること。再承認を繰り返す経路は今回の滑らかな UX の達成とは数えない。実 provider / child 更新の前提が満たされるまで capability を unavailable に保つ。

一次仕様: [MCP stdio transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)、[MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)、[Tunnel client source](https://github.com/openai/tunnel-client)、[configuration](https://github.com/openai/tunnel-client/blob/master/docs/configuration.md)、[connectors](https://github.com/openai/tunnel-client/blob/master/docs/connectors.md)、[secure MCP tunnels](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)。stdio の資格情報は環境から取得する契約で、HTTP OAuth を stdio にそのまま適用するものではない。公開仕様から実 binary の restart behavior や 8h 強制期限は推測しない。
