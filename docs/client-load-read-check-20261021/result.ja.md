# Codex側MCP読み込み状態の読み取り確認

2026-10-21 05:17 UTC。対象pi-console。今回の許可は非資格操作の読み取り確認のみ。再起動や正しい会話の選択が完了したとは仮定していない。

## 判定

**pi_console_localが通常デスクトップクライアントに反映された証拠は、今回取得できなかった。未反映・起動失敗と断定する証拠もない。**

|確認対象|取得結果|解釈|
|---|---|---|
|D:\Develop\pi-console\.codex\config.toml|存在。SHA256 c947f8e0ac351f8ccaba47892a864b4976ea8c605234b7a79e8e6b63e55ccecd。既存所有記録と一致|保存済みentry pi_console_local/clientId codex-local-v1の設定ファイルは維持されている。実効設定の証明ではない|
|今回の作業に提示されたtool metadata|pi_console_echo_testの16 toolあり。pi_console_local名のtool、inspect_local_connection名のtoolは0|この委譲作業に対象catalogが提示されていない。旧echo testは別の登録なので代用しない。desktop全体のload失敗という意味ではない|
|実効設定|config/readに相当する正規toolが今回の利用可能toolにない|project設定の採用・別layer上書き・実効enabled/disabled等は不明。global profileやアプリ内部状態を迂回読取していない|
|ロード済みserver status、起動エラー|mcpServerStatus/listに相当する正規toolがない|対象entryの認識有無・起動中/失敗・起動エラー本文は取得不能。エラーなしとは言えない|
|現在のデスクトップ表示|通常テキスト作業では利用可能な画面読取toolがない。capture_screen_contextはvoice限定なので未使用|現在の選択会話、MCP一覧、再起動完了は見ていない。親が報告したスクリーンショット上の「フィオ」と区別する|

## この作業の正確な会話と場所

正規list_threads/read_threadにより、今回の作業会話は **ローカルMCP接続とフォルダ権限を改善** と特定。thread IDは **01a128d3-ece0-7284-820c-c2bd718030a3**。直前turnの最終報告が前回のclient-reload-official-research-20261020と一致し、現在turnもinProgressであるため、名前の推測ではない。

sidebar登録上は **Tasks（sectionId chats）**。pinなし、projectId null。取得した未pin一覧では5番目だが順序は変化し得る。hostIdは **durable**、APIが返すcwdは `/tmp/codex-cloud-agent-978802f47890-a06c59e3c32843d29a03f9fb4e746166/app_servers/thread_service/workspace/D:\Develop\pi-console`。Windows作業コマンドのcwdと、会話の所属host/projectを同一視しない。このAPI記録は現在画面上で選択されていることの証明でもない。

別に、list_projectsはローカルproject **pi-console**（projectId db68c5fd-7112-4fc4-9e46-a7897b0520bc、hostId local、path D:\Develop\pi-console）の存在を返した。**この作業会話はそのprojectに所属していない。** 「Dのプロジェクト内のいつもの作業会話」と案内する根拠はない。会話を移動・新規作成・表示切替していない。

## 次に必要な確認

不足しているのはdesktop側の読み取り可能な **対象entryの認識状態と起動結果**。親側でデスクトップのMCP設定/接続一覧を表示し、**pi_console_localという名前・有効状態・接続/起動エラー表示**だけを確認するのが次の具体的な確認。command/env/credential欄を開いたり秘密値を提示したりする必要はない。対象tool名を表示できる場合はinspect_local_connectionの名前までとし、実行しない。

この作業会話を表示する必要がある場合は上記の確定したtitle/thread IDを使えるが、同じ会話を開くことだけでlocal project設定が適用されるとは案内しない。表示場所はTasksであり、存在未確認の名前や「Dのプロジェクト」の中をユーザーに探させない。

entryが見えない場合と、見えて起動エラーがある場合とでは次の判断が違う。その表示を得る前に設定変更・再起動・新しいクライアント起動を重ねない。今回の許可ではいずれも実行していない。別app-server起動、未公開IPC、内部DB、ログ・資格ファイル探索による代替確認もしていない。

## 実施範囲

正規APIのlist_threads成功1回、read_thread1回、list_projects1回、既存の非秘密configファイルhash2回（初回確認と記録後の一致確認）。最初のlist_threads(limit60)はAPI入力上限50により未実行で拒否され、50に修正して1回取得した。自動承認審査の拒否ではない。

pi-console実MCP tool call・inspect・資格claim/復元/短期更新/再発行/保護保存・追加親一覧・設定変更・Console/Codex/PC再起動・プロセス終了・UI操作・画像・testはすべて0。変更は今回の調査記録2ファイルのみ。source/dist/既存未コミット変更・過去証拠・pi-wardenには触れていない。
