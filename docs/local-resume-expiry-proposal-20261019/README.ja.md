# 期限の区別・未承認状態の確認・申請待ちUX案

2026-10-19。読み取りと提案のみ。再申請、取消、期限/資格設定変更、cookie更新、grant承認、再起動は行っていない。実装は親で具体案を確認した後とする。

## 今回起きたこと

実Codex申請の戻りを受けた時刻は **05:24:14.850 UTC**。現在の申請待ちは5分なので終了はおおむね **05:29:14 UTC**。本人画面の14:29:14と整合する。これは本人cookieの10分とは別の時計である。

本人が操作できる前から申請待ちが進み、Codex側の準備や会話の往復でも本人cookieの時間を使った。単に全期限をまとめて伸ばすのでなく、作成順と表示も直す必要がある。

## 現在の期限と開始時点

| 対象 | 現在値 | 開始時点と性質 |
| --- | --- | --- |
| owner-login一回用code | 2分 | CLIの明示yes後、管理APIがcodeを発行した時点。browserが見えた時点ではない。入力成功で消費。本人の再操作なしに再発行しない |
| 本人browser cookie | 10分 | serverがcodeを受理して本人ログインが成功した時点。`auth/status`や操作で自動延長されない。現在のcookie値/有効性は取り出していない |
| serverの未承認申請 | **5分** | `begin_local_connection`がserverのrequestへ到達してpendingを作った時点。親フォルダや権限は未付与。再取得/再送で期限を延ばさない |
| clientの承認前復旧情報 | **5分** | request送信より前に保護保存するbegin時点。server側より数秒早く終わることがある。server/client両方が有効でなければ復旧しない |
| 最終確認review | 最大5分 | 「許可内容を確認」で確認画面を生成した時点。現在は申請待ちの残りとの短い方。本人のfreshな認証も別途必要 |
| grantの7日 | 7日 | 現実装の期間計算の起点は「許可内容を確認」のreview開始時刻。**最終承認して初めて権限が有効**になる。最終承認ボタン時刻から7日に再計算する実装ではない。今回は実grantがない |
| 内部の短期アクセス資格 | 5分 | 承認時/更新時。承認済みgrantの有効期限内でのみ更新。申請待ちや本人cookieとは別。今回の変更対象にしない |

根拠: `package/connection-expiry.mjs:2`、`server/folder-mcp.ts:98-142`、`package/local-mcp-enrollment.mjs:4-13`、`server/local-owner-bootstrap.ts:111-131,244-252`、`server/local-mcp-composition.mjs:3,47-48`。

## expired申請にgrantがないこと

接続ID `86b3d68d-ff63-440c-8f41-d2dbb17fcf81`。

05:36 UTCの正規管理identityは同じPID7476・起動時刻で、保存先も既存のまま。非秘密のfilesystem metadataで以下を確認した。

- `local-mcp-resume/state.dpapi` とserver保存directoryは不存在。
- serverの未解決 `.lock` も不存在。
- 承認後のclient state `local-mcp-client-state/state.dpapi` も不存在。
- 承認前要求の `local-mcp-enrollment/state.dpapi` だけが存在。内容は開いていない。
- 専用試行フォルダは同じ所有identityで空。今回のCodex設定もhash不変。

現実装は本人承認時にserver storeへgrantを保存できなければadmissionを開かない。保存state不存在・lock不存在と、本人画面のexpired/親未承認の報告から、**今回の申請にgrantは作成されていない**ことを確認した。cookieや暗号化資格を取り出した確認ではない。

## 比較する案

| 案 | 利点 | 影響 |
| --- | --- | --- |
| 新方式の申請待ちを固定30分 | 5分より余裕があり、未承認要求が有効な時間を抑えられる | 会話/離席を挟むと再び不足し得る。長く待った後は本人再ログインが必要 |
| **新方式の申請待ちを固定60分（推奨）** | 会話やPCへの移動を含めて一度の申請を照合できる。再申請の往復を減らす | 未承認のprivate proof/待機slotがより長く有効。期限の表示と明示取消、既存の件数上限・本人最終承認を維持する |
| 本人の準備完了後だけ申請を作る | 操作可能になる前に短い時間を消費しない | これだけでは実際の操作中に時間切れになる問題は残るため、上の案と併用する |

推奨は **60分固定＋作成順の変更**。これは製品向けの提案で、MCP標準が60分を要求するという意味ではない。確認やpollで延びるsliding expiryにはしない。

## 推奨案の対象と除外

- 新方式のserver pendingとclient承認前復旧情報だけを、**新規作成分から60分**にする。
- 本人cookie10分、owner-login code2分、review最大5分、grant7日、短期アクセス資格5分、既存renewal復旧窓は維持。
- 本人認証を自動延長しない。離席してcookieが切れたら、本人が明示的にowner-loginをやり直す。同じ未承認申請を使える間は再申請しない。
- 親/操作/期限の最終確認と明示承認を維持。待機が長くなっても権限は0のまま。requestの保持件数上限、clientId+requestId+private proofの照合、世代変更拒否も維持。
- 現在のexpired申請や既存保護記録を**復活・延長しない**。将来の新申請には、旧expired記録の明示的な終了と新しいrequestIdが必要。今回はその操作もしていない。
- 7日の起点を最終承認時刻へ変えることは別の期限契約変更になるため含めない。確認画面に示した終了日時を保持する。

## 操作可能になる前に失効させない順序

1. 先にCodex設定の読込、実CLI/APIの対応確認、initialize/tools/listを終える。これらはowner cookieや申請を作らずにできる。今回確認したapp-server手順を再利用し、本人ログイン後にschema調査等を始めない。
2. 本人がPCで操作できるタイミングを確認してから申請を1回だけ作り、接続ID・明示的な「申請待ち期限」と手順をすぐ渡す。保存や報告作業で案内を後回しにしない。
3. **現在のようにbrokerが既に開いている再試行**では、申請作成後、本人が操作直前に必要ならowner-loginをやり直す。10分を入力・確認に使える。自動再認証はしない。
4. 初回のcold状態でbrokerが閉じている場合、現実装では最初のowner-loginが必要。Codex下準備だけを先に済ませ、本人ログイン直後に用意済みの申請処理を実行する。broker未起動でもbeginできると約束しない。独立したbroker準備APIの新設は今回の最小案に含めない。
5. 本人画面では期限を「申請待ち」「本人確認」「確認画面」「許可」と別名で表示。本人確認が切れた場合は承認POST前に止め、手動再ログインへ案内する。確認画面が切れた場合は本人の操作でreviewを作り直す。自動承認や自動延長はしない。

## 必要な最小実装

1. **専用pending policy**を追加。`CONFIRMATION_WAIT_MS`自体を60分に変更しない。この共有値は旧folder companion、Pi control、SettingsTunnel等でも使われており、一括変更は対象外の期限まで伸ばす。
2. `FolderMcp`にtrusted constructorのpending待ち時間オプションを設け、既定は既存5分。`createLocalMcpComposition`だけが専用60分を渡す。HTTP/MCPから待ち時間を選択させない。`reviewUntil`は既存5分のまま、pending残時間で上限を取る。
3. `package/local-mcp-enrollment.mjs`は新規記録を60分にする。旧5分記録もその元のexpiresAtのまま読めるvalidationにし、暗黙の変換や延長をしない。serverとclientの両方を揃えないと片方で5分終了する。
4. `package/local-resume-session.mjs`のpending結果に非秘密の `requestExpiresAt` を含め、案内側が送信時刻から期限を推測しなくてよいようにする。
5. `LocalOwner`/`LocalResumeMcp`で本人expiresAtを値として渡して表示し、承認前に期限切れを案内。cookie値は読まない。status取得で延長しない。確認前の非秘密draftを不必要に捨てない。commit応答喪失のpending receiptは、認証エラーだからという理由で消さず既存照合を維持する。
6. 行の現在の共通時刻表示を「申請待ち終了」「許可終了」に分け、本人確認10分と混同しない。案内も上の順序へ変更。

おおむねpolicy定義/型宣言、FolderMcp、composition、enrollment、session、本人UI/案内と関連試験の変更になる。実Windows helper・OS isolation・ACL/アカウント/network・旧トンネルの変更は不要。実装後は型検査・隔離build・dummy回帰を行い、本番反映には別途管理再起動が必要。

## 必要な受入

- 新方式は5分後もpending、60分ちょうどで失効。旧方式は5分のまま。
- 同じrequestIdの再送/再取得でexpiresAtを延ばさず、重複を作らない。
- 旧5分のexpired記録を新policyで読むだけでは復活・新しいproof生成・grant作成が起きない。
- 本人cookieが10分で切れたらpendingが残っていても承認できない。本人の新しい明示ログイン後だけ、残った同じ申請を確認できる。
- pending60分でもreviewは5分で終わり、codeは2分のまま。grant期限を変更しない。
- 二重押下、取消、応答喪失、再起動/世代変更、複数client、scope外拒否と照合契約を維持。

## 親で確認する具体案

**「新方式の未承認申請とclient復旧情報だけを新規分から固定60分へ変更し、code2分・本人cookie10分・review5分・grant7日は維持する。Codex下準備を先に終え、本人が操作できる時点で申請する。期限表示と手動再ログイン案内を整える。既存expired申請は復活させない」**

まずこの案を確認してから実装する。実際の旧申請終了・新規申請、反映/restartはその後の具体手順として別途示す。現段階では読み取り以外の操作は行っていない。

証拠root: `C:\Users\leade\AppData\Local\Temp\pi-console-resume-expiry-review-20261019-d82c410f`。
