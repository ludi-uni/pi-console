# 設定からのローカル MCP 連携（未適用 source / dummy 検証）

## 初回本人登録

設定 → ローカル MCP → 管理者登録を申請 → Console PC の確認ダイアログ → 設定に戻る。
署名・issuer・AUD・期限を検証済みの Access 利用者が明示クリックしたときだけ申請する。ダイアログで申請ID、検証済み subject、issuer、AUD、期限、Console 世代を読み、自分の申請なら「この本人を登録」を押す。確認ボタンは browser に置かない。登録済みの本人を他の利用者が登録・上書き・解除することはできない。

GUI の前後に、既存 manager の HMAC challenge、PID、起動時刻、port、nonce による現在世代の確認を行う。これは manager の責任。GUI adapter の責任は対話デスクトップでの人の意思確認であり、OS の強固な本人認証や同一SIDの悪意あるプロセスへの防御を意味しない。Pi / SDK / extensions は信頼する前提。

GUI 用には追加 HMAC `ownerProof` で challenge / PID / 起動時刻 / port / nonce を一緒に署名する。既存 proof の契約は変更しない。追加 proof のない旧serverをGUI対応と見なすfallbackはない。

申請は最大2分で失効する。同時申請、期限切れ、取消、内容不一致、GUI利用不能、非対話デスクトップは未登録で終わる。CLI の yes / コード入力への自動 fallback や自動承認は行わない。申請IDは非秘密の照合用として sessionStorage に保存し、戻る・reload・応答喪失時は照合だけを行う。保存中の取消はrollbackを約束せず、結果を照合する。不明な保存結果では管理を閉じ、記録を再読取して照合する。

登録は MCP grant と別。管理者登録だけで credential、broker、親フォルダ grant を作らない。owner の保存内容は subject / issuer / AUD と結果照合 request ID のみで、JWT・キー・cookie は保存しない。毎回の管理操作には新鮮な署名検証済み Access 認証が必要。

## 日常の手順

1. 一度だけ、標準 stdio コマンドを設定できる client に表示された node / companion path / Console PC の固定 literal loopback URL を登録する。製品ごとの import や自動設定は未確認。
2. 設定 → ローカル MCP → ローカル連携を始める。client を開始し、stderr に出る非秘密の接続 ID を画面と照合する。
3. Console PC の親フォルダ、操作、期限を選び、確認 → 許可して接続。用途別3本のキーは内部で分離して生成し、local companion の memory にだけ渡す。人がランダムキーを用意する作業はない。
4. 応答不明時は保存結果を照合する。解除も同じ設定画面。複数clientは接続IDとgrantを分離する。

対応する client は標準 stdio companion を利用する。自動importのない client はコマンドと引数を一度設定する最小fallback。全clientの万能自動連携や Dots clientInfo による認証は約束しない。

非秘密 discovery は固定 Console loopback listener から現在の private broker アドレスだけを返す。credential / 管理codeは返さず、browser / proxy / public Access endpointからの discovery は拒否する。client起動のたびに取得し、owner listener の動的portをclient設定に焼き込まない。broker開始は認証済み owner の明示「始める」だけ。

別端末 Access browser から申請・管理しても、GUI・MCP client・companion は Console PC 上で動く。別端末 localhost は Console PC ではない。MCP transport、request / claim / RPC、credential handoff は public listener や Cloudflare を通さない。

親フォルダ境界は既存 provider の canonical path / reparse / identity / anchored handle に従う。新規directory、必要なgit initを含む新規localrepo、workspace作成登録と列挙だけ。既存dataの削除・上書き、clone、push、公開、任意初期化コマンドは含めない。許可から run/history/final 本文公開を導かず、既存 exact read/control/final 契約は別。Pi 全体の OS sandbox ではない。解除は将来の権限を止め、作成済みrepoや送信済み本文を削除しない。

## 検証・未適用

今回の GUI 増分は所有する隔離copyのみ。test-only GUI adapter、署名済みdummy principal、fake folder provider、memory owner store、loopback HTTP、所有Tempで受け入れる。実Windows GUI、実Access、実client、実owner・key・grant・repoは未実行。D source / dist / Startup / runtime / 実認証設定は変更しない。前段17sourceと証拠70ファイルを別copyとhashで保全する。

通常npm testに含まれるnative / ACL / SDK / process / 実dataケースは実行しない。専用純粋harnessは書込・native load・child_processを禁止した状態で選択した受入だけを実行する。GUIの実Windows表示確認とdistributionは次の個別承認工程。

## 一次仕様・browser互換性

- [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports): newline JSON-RPC、stdoutはRPC、stderrは非秘密の案内。対応clientの自動設定を意味しない。
- [Cloudflare JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/): JWTの署名検証を省略しない。
- [WinForms ShowDialog](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.form.showdialog?view=windowsdesktop-9.0)、[AcceptButton](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.form.acceptbutton?view=windowsdesktop-9.0): 対話モードのdialog結果を判定し、閉じる・Escape・Enterは取消。実表示は未検証。外部データは固定scriptのstdin JSONで渡し、shell式・argv・URLに連結しない。
- MDNの [fetch](https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch)、[randomUUID](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)、[sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage)、[details](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details)、[setTimeout](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout) は Baseline Widely available。randomUUIDはfeature detectionし、未対応なら申請を停止して対応browserを案内する。detailsのname groupingは使用しない。pollは照合だけで、自動再申請しない。
