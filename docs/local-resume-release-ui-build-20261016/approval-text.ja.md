# 最新 UI を含む最終範囲の確認文案（まだ未適用）

D:/Develop/pi-console へ、新候補のsource24件（既存更新9・追加15）とdist14件を、ローカル再開機能は既定OFFのまま反映する範囲です。既存23/13候補とは別の配布物です。追加するsourceには web/local-resume-review.css が含まれ、web/LocalResumeMcp.tsx も確認画面改訂版のハッシュに変わっています。

最終deployment-manifest SHA256: ace3e540eecfa3cf858264fd43afdc9ae79e331574885c9d0991e67696033c5f

実施する場合は直前にPi実行・queue・orchestratorの停止とmanager所有をfreshに確認し、busyまたは確認不能なら止めます。対象は所有Console server・その管理下worker/source・broker/SSE/MCP接続・管理下dialog/tunnel helperで、managed stop → 配置 → start を1回行う範囲です。接続cookieの切断やexact control/finalのinstance/epoch変更の可能性は旧案と同じです。他アプリ、ブラウザー、独立したPi processの停止は含めません。

既存source9件と現dist20件を直前にmanifest/hash付きで保全し、health確認失敗時はそのsnapshotへ復旧します。元々未存在の追加source15件と新dist asset2件は、適用後ハッシュが一致するものだけを復旧時の削除対象にし、不明な変更は保存します。既存静的assetを配置時に削除しません。

HEAD、既存dirty、Startup、dataDir設定、.env/profile/既存grant/networkは維持します。manager起動時のserver-state/server-token/log/lockの通常更新は従来の管理動作であり、古いtoken/stateは復旧しません。新MCP資格・grant・有効化・移行・実client接続やoption2の公開dummy transport試験は含みません。

この文案と候補の固定のみを行い、停止・再起動・配置はまだ実行していません。
