# トンネルと同じ期間使う、資格自動更新のdummy試作

実データ・実権限・実Dotsに接続しない独立試作です。初回にowner/client/対象/操作/トンネルと期間を固定して承認し、同じ条件の短命資格はcompanionが裏側で更新します。人が3本のキーを用意する手順や8時間ごとの本人確認はありません。

## 最短の確認手順

1. ZIPを新しい自分のTempフォルダへ展開します。そのフォルダで次を実行し、表示された `http://127.0.0.1:<dummy-port>` を新しいbrowser画面で開きます。実Console URLや認証情報を入力しません。
2. 一画面でroot・操作と「トンネルと同じ利用期間」を確認し、7日・31日・明示した期限なしを選んで模擬承認します。期限なしは追加確認が必要です。
3. 試験用detailsの「8時間経過」でcookieを失効させます。本人確認は1回のまま、裏側の更新が増え、模擬操作できることを確認します。
4. 「同一性を証明した再起動」「更新応答を1回失う」で継続と照合を確認します。新しい対象や期間への変更はしません。
5. 「この連携を解除する」で更新と新しい操作を止めます。不明daemon・時計巻き戻し・期限切れ・古いrefresh再利用も停止表示になります。取消は作成物や送信済み本文の削除、実Pi停止を意味しません。

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\launch-preview.mjs'
```

Nodeだけでpreviewを起動します。10分後またはCtrl+CでHTTPとdummy companionを閉じ、`preview-owner.json` に終了を記録します。画面previewの状態はメモリーだけです。保存・再読込と取消永続化は、専用の所有Tempファイルfixtureで検証しました。再レビューには新しい展開先を使ってください。

## 期限と更新

利用期間は7×24時間、31×24時間、または明示型none。トンネルと操作許可は同じ固定期限です。更新や再接続で終了時刻を延長しません。資格は5分で入れ替わるdummyタグで、最大でも固定期限までです。noneを選んでも無期限access bearerは作りません。read/control/finalのタグは別ですが、final本文共有を許可しません。

同じrequest/入力/認証proofでの応答喪失再試行は、2分の回収期間内だけ同じ結果を返します。二重rotationをしません。古いrefreshを別requestで再利用すると系列を停止します。後続rotationや再起動後は古いreceiptから復活しません。取消・期限切れ・clock rollbackは保存されます。保存結果が不明ならそのinstanceは停止し、再読込と同一性確認が必要です。

別client・別session・別target・別操作・別tunnel・証明のないdaemon世代の試行は拒否します。未認証者の文字列だけで正規clientを解除するDoSは避けています。不明なdaemonを監視側が検出した場合は承認済み系列も停止します。同一性proofを再取得した再起動だけ、初回grantを変更せず新しい資格世代へ切り替えます。

## 未確認点

- verifierはfixtureが発行する不透明object、資格は公開dummyタグです。実暗号認証・安全な資格保存・実daemonの再起動証明は実装していません。
- 実Dotsのrefresh対応、外部トンネル鍵の期限、実MCP clientとの相互運用は未確認です。HTTP OAuth/PKCE/refreshの標準サーバーを完成させた試作ではありません。
- directory操作はカウンターでのメモリー模擬だけです。実provider、既存file操作、実repo/Pi、任意process、OS isolationは試していません。directory全般操作の目標は未達です。
- 本人によるこの新版のUX受入は未実施です。Windowsの実native画面ではなく、fresh headless Chromiumで390/1280幅を確認しました。

根拠：[MCP refreshの仕様](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#refresh-tokens)、[OAuth refreshの保護要件](https://www.rfc-editor.org/info/rfc9700/#section-4.14)。今回のlocal receipt照合はprototype契約で、既存clientがこれに対応するとは保証しません。
