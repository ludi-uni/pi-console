# owner view の HTTP403・読取のみの切り分け

## 診断証拠

親がユーザー画像を目視確認し、コード貼付・実行成功、`POST /local-owner/resume/view` の **HTTP403 Forbidden** と、続く `Owner metadata unavailable; do not issue new credentials or retry automatically.` を確認した。こちらは画像pixelsを読んでいない。

この証拠から、今回は貼付保護で実行前に止まったケースではなく、POSTが拒否された段階と分かる。403のresponse bodyはまだ不明。**本人ログアウトや期限切れの断定はしない。**

## 現行endpointの403条件

| 応答error | 条件 | Cookie失効と断定できるか |
| --- | --- | --- |
| `local_owner_boundary_rejected` | 外側brokerのnative境界違反。disposed/非listening、local/remote addressやbroker port不一致、Host不一致/重複、proxy/forwarded系header | できない。本人cookie検証より前 |
| `local_resume_boundary_rejected` | POST以外、literal127・port・Host・Content-Typeの条件違反、proxy header、route不一致、Origin不一致/欠如/重複、Sec-Fetch-Siteがsame-originでない/欠如/重複 | できない。Origin等のCSRF境界を含む |
| `local_resume_request_rejected` | ownerVerify不成立、service生成やviewの例外、body読取/JSONエラー、viewへの余分なbody field、処理後owner再確認失敗など、try節内の例外全般 | cookie期限切れを含むが、それだけではない |

根拠: `server/local-owner-bootstrap.ts:51`〜`:74`、`:101`、`server/local-mcp-http.mjs:9`〜`:29`。

`native` の具体条件は、method POST、local/remote addressとも `127.0.0.1`、local portが現在broker port、Host1件がliteral127とportに完全一致、Content-Type1件がapplication/json、cf-/x-forwarded-/forwarded/via/x-real-ipがないこと。viewはowner routeなのでOrigin1件が同じHTTP origin、Sec-Fetch-Site1件がsame-originであることも必要。

独自CSRF tokenを手入力する方式ではなく、同origin/browser境界の検証を使っている。確認のためにheaderを偽装したりCookie値をコピーしたりしない。

### ownerVerifyが不成立になる条件

`server/local-owner-bootstrap.ts:53`〜`:66`:

- nativeな同origin POST条件に合わない。
- Cookie headerが1件でない。
- 現在broker epochのcookie名が1個だけ見つからない、または値の形式が不正。
- session digestに対応するserver内sessionがない。
- sessionのexpiresAtを過ぎた、digest比較に一致しない。

明示logoutもsessionを削除する。別ブラウザや失効cookie、古いbroker epoch等も失敗要因で、403だけでそのどれかは決められない。cookie値は読まない。

### 期限と返却statusの違い

owner認証は **auth/claimから10分固定**（600000ms、Max-Age600）。view・approveで延長する処理はない。期限切れsessionを検証時に除去するが、承認済みfolder grantの解除はしない。

**resume viewは外側auth/statusのsession確認より先にdelegateされる**（bootstrap `:101`）。そのためcookie失効時はresume側catchの **403** になり、通常のauth/statusの **401 local_owner_login_required** と異なる。403だから期限切れではない、とは判断できない。

最後に本人承認したという報告は08:56 UTC、今回の拒否報告は09:17 UTC。**その間に再本人確認をしていなければ、10分期限切れは時系列に合う有力候補**。ただし追加の本人操作有無は未確認なので、ログアウト原因と確定しない。

`service()`例外（owner/provider/保護store等の読取不成立）や処理中の認証期限経過も、同じrequest_rejectedになる。アプリdisabledは通常503 local_resume_disabledで、今回の403とは別の分岐。

## 今ある画面だけで確認する最小手順

1. **再実行しない。** 既に失敗したNetwork項目 `/local-owner/resume/view` の **Response** を開き、JSONにあれば **error文字列だけ**確認する。Headers/Cookies、トークン、requestの秘密材料、全ログをコピーしない。JSON errorがなければ「JSONのerrorなし」という情報だけでよい。
2. 本人画面の既存表示で「本人確認の期限」「本人確認の期限が切れています」、またはコード入力画面になっているかを見る。新コード入力やログイン操作はまだしない。
3. この情報を合わせ、境界拒否か、認証/内部読取拒否かを切り分ける。`request_rejected`と期限切れ表示がそろえば期限切れ候補が強くなるが、内部例外まで自動的に除外しない。

現在の通常一覧UIはoperationsを表示しないため、認証が失効したままその4項目だけを正規に読み出す抜け道はない。view失敗scriptはlogout APIを呼んでおらず、scriptが明示ログアウトを実行したとは扱わない。

## 正規復帰の最小範囲（未実行・別許可後）

- **期限切れが確認された場合:** 本人が正規owner-loginで新しい短期コードを受け、自分のローカル画面で入力し、「本人認証の状態を再取得」で既存owner sessionを確認する。その後で同じ接続IDのview読取だけを1回行う。コードはchat/URLへ送らない。
- **境界拒否だった場合:** 正規の同PC owner画面・正しいoriginであることを確認する。Cookie/headerのコピー・書換え、保護無効化や認証回避はしない。
- 新しいMCP申請・grant再承認・grant期限変更・Console再起動は、owner cookieの期限切れを直す手順に含めない。
- 現在は再ログイン・再試行とも未許可なので、こちらは実行しない。正規の「本人認証の状態を再取得」はauth/statusの読取操作だが、今回はその追加リクエストも行っていない。
- 本人認証のやり直しで、元の初回申請期限 **2026-10-20T09:47:49.759Z（18:47:49.759 JST）** やgrant期限を延長しない。

## 今回の実施範囲

既存sourceの読取とこの報告の保存のみ。HTTP/MCP再送・status再取得・Cookie/profile/資格値読取・新login・claim・保存・更新・復元・実接続・新規申請・再承認・再起動・実装適用は0。本人ブラウザの貼付保護を回避する手順は案内しない。source/dist/client設定、過去の封印済み証拠、holderの期限を変更していない。
