# 本人へ提示する文案（現在は依頼文案のみ・未実行）

D:\Develop\pi-console に、下記source23ファイル（既存9・追加14）と、同じ隔離コピーからbuildした静的dist13ファイルを、**新しいローカル再開機能は既定OFFのまま**反映してよいですか。

直前にPi実行・queue・orchestratorが停止中であることを確認し、既存managerで所有が一致したConsole serverだけを managed stop → 配置 → start の順で一回入れ替えます。対象はConsoleのNode server、その管理下のsession worker/source、owner/local broker・SSE/MCP接続と、管理下dialog/tunnel helperです。ブラウザー自体や他アプリ・別のPi processを止める操作はしません。接続・本人cookieは切れ、実行中の作業があれば中断し得ます。exact control/final等もinstance/epochが変わり再接続・再承認が必要になり得るため、停止を確認できなければ反映しません。

既存9 sourceと現在のdist一式をmanifest/hash付きで保全し、起動health確認に失敗したらそのsnapshotへ戻します。追加ファイルの除去は、元々存在せず、適用後hashが一致するものだけに限定します。未知の変更は上書き/削除しません。旧static assetも検証完了まで保持します。既存の未commit変更を消さず、HEAD/Startup entry/dataDir設定/.env/profile/既存grant/ネット設定は変更しません。

managed再起動に伴うserver-state、server-token、server.log、server.lockの通常更新は含みます。server-tokenは従来managerが起動ごとに更新する管理用資格で、新MCP資格ではありません。これらの古いstate/tokenをbackupから戻して所有確認を偽装しません。

activation-previewは適用せず、新しいSID/DPAPI経路を実行しません。新MCP資格・新grant・新保存先の作成、旧profile移行、実client接続は含めません。新規連携の有効化と、本人が親フォルダ・操作・期限・表示された保存先を選んで始める操作は別にします。

## 対象source23ファイル

既存9:

- server/folder-mcp.ts
- server/index.ts
- server/local-folder-composition.ts
- server/local-owner-bootstrap.ts
- server/settings-mcp.ts
- server/trusted-local-mcp.ts
- package/server-manager.mjs
- package/server-manager.d.mts
- web/LocalOwner.tsx

追加14:

- server/local-mcp-composition.mjs
- server/local-mcp-dpapi-helper.mjs
- server/local-mcp-file-backend.mjs
- server/local-mcp-http.mjs
- server/local-mcp-identity.mjs
- server/local-mcp-installation.mjs
- server/local-mcp-installation.d.mts
- server/local-mcp-state.mjs
- server/local-mcp-windows.mjs
- package/local-mcp-client-state.mjs
- package/local-resume-mcp.mjs
- package/local-resume-session.mjs
- package/managed-resume-broker.mjs
- web/LocalResumeMcp.tsx

sourceとdistの正確なbefore/after SHA256はdeployment-manifest.json、復旧用の現行dist範囲はcurrent-dist-manifest.json、build生成範囲はdist-manifest.jsonで固定します。現在の具体PID・job状態は取得しておらず、実行直前のmanager所有確認と本人の停止確認を省略しません。
