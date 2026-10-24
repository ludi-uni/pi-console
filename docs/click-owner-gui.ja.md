# 初回 owner 登録をクリックで完結する増分設計

既存17ファイルと受入証拠は別の所有 root に保全し、この copy に増分を作る。D、実 runtime、認証設定、実 owner / credential / grant は変更しない。Windows GUI は起動せず、test-only adapter の応答だけで受入する。

## 本人の操作

1. 署名検証済み Access 設定画面で「管理者登録を申請」を押す。
2. Console PC のローカル GUI に出る request ID / subject / issuer / AUD / 期限 / Console 世代を読み、「この本人を登録」をクリックする。
3. 設定に戻り、結果を照合してローカル MCP 連携を開始する。

コマンド、yes の入力、code の入力、3本のキー作成を求めない。GUIが使えないときは未登録のまま理由を示し、CLI fallback や自動承認をしない。認証未設定の場合も登録を拒否し、設定変更は別承認。

## 信頼の責務

- Access verifier: 署名・issuer・AUD・期限を検証し branded principal を作る。browser の confirmed は「申請した」という意思表示に限り、登録承認には使わない。
- 既存 manager: 既存 server-state/token と `/api/manage/identity` の HMAC challenge を読み、PID / startedAt / port / nonce が現在の Console と一致することを確認する。read-only の確認のみで起動・停止・code発行は行わない。GUI の前後に検証する。
- trusted GUI adapter: Console と同ユーザーの interactive Windows desktop で明示確認を受ける。固定 PowerShell script に、非秘密の表示情報を stdin JSON で渡す。subject/path を script・argvへ連結せず、stdout は固定 enum に限る。非対話・表示不能・取消は承認にしない。
- server coordinator: request ID / subject / issuer / AUD / expiry / server generation（PID・startedAt・port・nonce）を immutable tuple と SHA-256 digest にし、GUI 結果と再照合する。browser 経由の GUI 承認申告 endpoint は作らない。登録は既存 SettingsOwner.approve の内部 callback を使う。

Pi / SDK / extensions を信頼する前提を維持する。GUI はローカル人間の意思確認であり、OS の強固な本人認証や悪意ある同 SID プロセスへの防御ではない。

## 拒否・再送・同時操作

一度に active dialog は1つ。新IDの同時申請は active を取消し両方未登録にする。1世代で記録32件、全体3 dialog/10分、同 subject は60秒の間隔を設ける。既知 ID の再送で dialog を再開しない。申請の原JWT期限と2分期限の短い方を使う。GUI 待ち中の cancel / expiry / generation変更は abort し、遅れた yes を拒否する。

表示不能・非対話・identity未検証は terminal result を照合できるように保持する。保存開始後の cancel は結果照合に限定し、commit を取消と偽らない。保存の不確実性は fail closed にして既存 receipt / 再起動後の記録照合へ接続する。固定ownerがある場合、別subjectによる登録・上書き・解除を一切拡張しない。

## 検証と次の承認点

pure/mock は fake management HMAC / fake identity / fake GUI結果 / memory owner store を使用する。UI は owned loopback の test-only GUI表示で、Windows表示とは区別する。production index、実 manager config、実 profile は実行・読取しない。native / ACL / OS entry を含む通常 npm test は実行しない。

次の本人承認点は、実Windowsでの初回 GUI表示確認と source/dist配布・再起動の範囲確認。その後の実owner登録・実client接続・実grantはそれぞれ本人の明示操作。今回の dummy は実Windows・実Access・実clientの成功を意味しない。
