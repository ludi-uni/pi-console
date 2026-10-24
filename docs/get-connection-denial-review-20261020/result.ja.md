# get_local_connection拒否の既存証拠レビュー

今回は保存済み結果・証拠とDの既存sourceを読んだだけ。拒否操作の再試行、MCP呼出、HTTP照会、認証/秘密取得、再申請、取消、権限変更、作成、source変更はゼロ。元の封印済み証拠も変更していない。

## 確定できるエラーの詳細

2026-10-20 00:34:31.994–00:34:33.694 UTC（09:34 JST）、実Codex clientの呼出はget_local_connectionの1回だけで終了した。期待接続IDは **fcf3c891-84b6-4b2a-a074-8dd4637aeaa5**。catalogはpi-console-local-resume、version1。記録のfailureは **app_server_rpc_rejected**。

| 層 | 今回わかること |
| --- | --- |
| 実行環境のtool/自動承認review | 拒否されていない。scriptが実行され、catalogを取得し、MCP呼出に進んだ。実行結果はapplication終了code1である。以前のCommandLine照会の自動承認拒否とは別件 |
| Codex app-server RPC | **mcpServer/tool/callに対するJSON-RPC error応答を受信したことは確定**。ラッパーはm.errorがあった時だけapp_server_rpc_rejectedへ変換する |
| app-server側の数値error code/message | **今回の実値は未保存・不明**。ラッパーがm.error全体を捨てたため、保存済み結果から復元できない。raw protocol/stderr内容も保存していない |
| Console MCPのcode（source上） | local-resume-session.mjsは例外を **-32602 / local_resume_or_scope_unavailable**へまとめる。ただし、これが今回返ったという実測記録はない |
| Console HTTPのcode（source上） | local-mcp-http.mjsのclient route処理失敗は403 / local_resume_request_rejected。これも今回のHTTP応答を取得したものではない |

**アプリ/RPC経路のエラーまでは確定しているが、Consoleの認可拒否とCodex app-server内部の拒否を今回の保存記録だけで完全に区別できない。** 実行基盤の承認gateが止めたとは解釈しない。approval/elicitationへの未処理応答をしたことを示すunhandledServerRequestも今回のrecordにはないが、全てのapp-server内許可判定を除外する証拠ではない。

過去の取消確認では、外側-32603と内部-32602/同メッセージを実際に記録している。しかし別の呼出であり、今回のcodeを-32603等と推定して埋めてはいけない。codeまで捨てたのは今回の診断記録の不足である。

## 新しい申請を対象にしていたか

- 新規申請の公開記録はfcf3c891-84b6-4b2a-a074-8dd4637aeaa5、requestId **codex-create-retry-194caadc-6795-4c4f-9c5c-049742e0a648**、作成00:26:54 UTC頃、期限01:26:54 UTC。
- 試験scriptのexpectedIdは同じfcf3c891…で、新規申請のdocs/create-trial-retry-20261020/codex-real-request.jsonを参照している。旧a885e50e…の申請を期待するscriptではない。
- 実Codexで既存pi_console_localの設定を照合し、clientId **codex-local-v1**、Dのlocal-resume-mcp.mjsを使用した。
- **get_local_connectionの引数は仕様上{}であり、connectionId/requestIdを明示送信するAPIではない。** companionがそのclientIdの保護保存状態を使って照合する。今回エラーでIDの返却がなかったため、実際に読み込まれた保存状態のIDを応答で再照合できたわけではない。秘密stateを直接復号して確認する迂回は行っていない。

## 原因候補と、今回除外できる誤解

### 1. 初回claimの短期資格5分が過ぎた可能性

FolderMcp.approveはcontinuationモードでもconnectionUntilを承認処理時刻+300000ms（grant期限との短い方）に設定する。初回claimはlive(c)を呼び、この短期期限を超えていれば失敗する。

client側は、保存済みapproved clientがあればresume/renewを使える。一方、**初回getではprivate claimが成功してからcontinuation proof/renewalを保護保存する**ため、未受取のまま短期資格が切れた場合、その通常更新経路に入れない。

したがって、申請待ち60分・grant7日が残っていても、承認後の初回受取りが5分を過ぎると接続確認で失敗するcode経路が存在する。今回のgetは09:34:32 JST頃なので、承認が09:29:32 JST頃以前ならこの条件に入る。ただし実際の承認時刻/connectionExpiresAtを保存していないため、**今回の実原因との断定は不可**。

接続確認の前に検証scriptの準備を先行したため、この短期受取り時間を消費する進め方だった。新しい権限や新申請でごまかしてよい理由にはならない。

### 2. 保存binding/状態・grant側での別の拒否

同じ公開エラーへ畳み込まれる候補として、client保存状態のSID/owner binding不一致、保護state/backendの読取不可、broker/enrollment binding不一致、grantの取消/状態不成立、private HTTP失敗がある。今回はどのbranchまで到達したかの情報を残していない。秘密の読取・新しいprobeなしにこれ以上絞ることはできない。

### 直接の原因と決めつけてはいけないもの

- **本人browser cookieの10分切れだけ**: clientのrequest/claim/resume/renewはowner cookieを使わない。owner routeだけがownerVerifyを呼ぶ。再ログインだけで初回claim問題が直るという根拠はない。
- **4操作や親pathの指定違い**: 今回はgetの段階で失敗し、listのscope確認やcreateのscope判定へ進んでいない。これを根拠に権限不足と判断して権限追加してはいけない。
- **単に未承認のpending**: record/brokerが正常で申請期限内ならclaimはpendingを返し、getもpending metadataを返せる。今回のRPCエラーを単なる未承認と読み替えない。
- **60分の申請期限切れ**: 新申請期限は10:26:54 JSTで、試験09:34:32 JST時点ではその公開期限を過ぎていない。

## 本人に必要な最小操作

現時点で再申請・承認押し直し・権限追加を求める根拠はない。コード/token/cookieや認証設定の提供も不要。

既存の本人画面がまだ有効なら、**「接続一覧を再取得」1回でfcf3c891…の行のstateと表示される許可期限だけを読む**ことが最小の追加情報になる。親が表示されているかも非秘密情報で確認できる。本人確認が切れていればそこで止め、この段階では再ログインや新申請を依頼しない。

既存view responseにはconnectionExpiresAtという非秘密項目もあるが、現在のUIは主にgrant期限を表示する。cookieを抜いたり別経路でowner APIを呼んだりしてその項目を取得しない。画面情報でも不足する場合は、別途許可されたdummy再現/非秘密error code保存の改善で確認する対象となる。今回はそのprobeやsource変更もしていない。

3操作は依然 **create要求0回・workspace登録なし・Git未実行**。試験app-serverは終了済み。再送していない。

## 参照した既存証拠/source

- docs/create-trial-execution-20261020/codex-read.json、trial.mjs:3,7–11
- docs/create-trial-retry-20261020/codex-real-request.json
- docs/local-revoke-read-20261019/public-result.json（過去codeとの区別用）
- package/local-resume-session.mjs:9–11,24–29
- package/local-resume-mcp.mjs:4–11
- package/local-mcp-client-state.mjs:17–24
- server/folder-mcp.ts:86–113,146–149
- server/local-mcp-http.mjs:12–30
- server/local-mcp-composition.mjs:43–55
