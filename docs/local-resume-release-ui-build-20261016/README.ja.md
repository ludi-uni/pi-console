# 最新確認 UI を含む既定 OFF の隔離配布候補

source24件（更新9・追加15）とdist14件を同じ入力から固定した候補。sourceとdistを一組として扱い、旧source23/dist13候補と混在させない。本番未適用。

## 基点と差

旧候補: C:/Users/leade/AppData/Local/Temp/pi-console-release-build-20261016-f38c8a72/release-default-off.zip

旧ZIP SHA256: efc21d31aa5e00aa93534540b9295dc7df5da5b269e48760d227807390a827c4

旧候補とsource22件が同一。web/LocalResumeMcp.tsxが改訂され、web/local-resume-review.cssを追加した。サーバーとpackageの認可・保存・失効・本人認証・既定OFFは同じ。UIの状態／通信プレフィックスとイベント／ガード28属性が一致する。

旧dist13との比較は同一11件、owner.html変更1件、新owner JS/CSSの追加2件、旧owner JSの候補からの除外1件。詳細はcandidate-delta.json。候補間の除外はD内assetを削除する指示ではなく、deployment-manifestのretainExistingDistを保持する。

## build と検証

既存インストール依存だけでtsc --noEmit → Vite 7.3.6 build成功。キャッシュ・envDir・TEMP・出力を所有Temp内に固定し、.env/profileを読まず、npm install/lifecycle hookを実行していない。依存参照junctionは削除済み。

純粋なintegration.test.mjsの37/37が成功。memory backend + fake provider + 公開決定的dummy値のみで、loopback listener・transport試験・OS暗号・native試験・実資格・実grantは0。確認UI改訂版の既存25項目/36操作/6画像はハッシュ一致の既存証拠として参照し、今回はブラウザーとHTTPを起動していない。

owner.htmlの全asset参照がこのdist14件に存在し、生成owner JSに新要約、生成owner CSSに専用スタイルが含まれることを静的に検証した。本番での表示や新しいWindows transportを試験済みとはしていない。

## 保全と復旧計画

D source315、dist20、既存dirty15、HEAD 23815ba260320e3fc720ad3288ca89728f99b4f7が旧記録と一致。旧リリースseal420、UI候補seal381、照合seal7を全検証し保持した。新build/tcs/viteと回帰の捕捉した5PIDは終了し、listenerは0。

旧承認案と同じbackup/rollback方法が成立する。backupは既存source9と現dist20。新候補で元々未存在のsource15とdist2は、復旧時に適用後hash一致を確認したもののみ削除対象。未知の変更は残す。旧状態/token/lockを戻してmanager所有確認を偽装しない。詳細はrollback-plan.json。

停止・再起動・配置前にはfreshなPi実行/queue/orchestratorのidle確認とmanager所有確認が必要。今回はそれらの実稼働状態を取得しておらず、停止・再起動・反映・新資格/grant/有効化・ネット設定変更は0。option2の公開dummy transport試験も行っていない。pi-wardenには触れていない。

## 配布内容

- source/ 以下24件
- dist/ 以下14件
- deployment-manifest.json: 配置のbefore/afterハッシュと既存asset保持対象
- dist-manifest.json: 今回のbuild出力のみ
- build-result.json / regression.json: 実行結果
- preservation.json / process-observation.json: 保全と終了の証拠
- candidate-delta.json / rollback-plan.json: 旧案との差と復旧対象
- approval-text.ja.md: 追加CSSを含む最終範囲の確認文案
- bundle-manifest.json: 全payloadのハッシュ（自身以外）

source24の具体的なパス:

- server/folder-mcp.ts (update)
- server/index.ts (update)
- server/local-folder-composition.ts (update)
- server/local-owner-bootstrap.ts (update)
- server/settings-mcp.ts (update)
- server/trusted-local-mcp.ts (update)
- package/server-manager.mjs (update)
- package/server-manager.d.mts (update)
- web/LocalOwner.tsx (update)
- server/local-mcp-composition.mjs (add)
- server/local-mcp-dpapi-helper.mjs (add)
- server/local-mcp-file-backend.mjs (add)
- server/local-mcp-http.mjs (add)
- server/local-mcp-identity.mjs (add)
- server/local-mcp-installation.mjs (add)
- server/local-mcp-installation.d.mts (add)
- server/local-mcp-state.mjs (add)
- server/local-mcp-windows.mjs (add)
- package/local-mcp-client-state.mjs (add)
- package/local-resume-mcp.mjs (add)
- package/local-resume-session.mjs (add)
- package/managed-resume-broker.mjs (add)
- web/LocalResumeMcp.tsx (add)
- web/local-resume-review.css (add)

deployment-manifest SHA256: ace3e540eecfa3cf858264fd43afdc9ae79e331574885c9d0991e67696033c5f
