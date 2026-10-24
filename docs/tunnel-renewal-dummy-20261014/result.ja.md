# トンネル連動・短命資格更新のdummy受入

独立モデルと一画面UIを作成した。利用期間はトンネルと操作許可で共通の7日・31日・明示none。初回owner/client/対象/操作/トンネル/初回世代/期限を固定し、同一条件では5分の資格を裏側でrotationする。owner cookieは初回承認と分離した。8時間ごとの本人再確認を要求しない。実credentialや無期限access bearerは生成していない。

- モデル26/26成功。scope/expiry/cookie失効、rotationとreuse、同一requestの応答回収、回収期限・後続rotation、cancel競合・永続化、clock rollback、store破損・保存不確実性、同一条件のdaemon/Console再起動、別client/session等の拒否を検証した。
- 画面11/11成功、54操作・13画像・pageErrors 0。390/1280幅、新しいbrowser context。本人確認1回のまま8時間経過と検証済み再起動後に操作可能、取消や未知世代等で操作不能を確認した。
- 構文検査はJavaScript各moduleとHTML内script。TypeScriptを使用していないため、型検査成功とは記載しない。
- 専用Tempのファイル保存fixtureで取消→再読込後も停止することを確認し、作成と終了・除去を記録した。preview/UI fixtureはメモリーだけで、実Windows/native/providerを検証していない。
- 初回UIは11件中10成功。承認応答のsocket切断でbrowserがPOSTを自動再送したため、意図した照合状態を検証できなかった。fixtureを本文欠落に変更し、11件成功。その後、再読込時の期間選択が既定値と不一致になる表示を修正し、最終11件を再実行して成功した。各失敗ログを保全した。

旧期限試作405、directory試作413、archive725、D source315と旧docs、既存git変更を保全。新しいreview資料/ZIPだけをD docsへ保存する。本番source/dist/config/credential/grant/security設定の変更、stop/restart、実client接続、実repo/Pi/native、commit/push/publishは0。pi-wardenには触れていない。

未確認は実Dotsのrefresh、外部鍵の寿命、実client/daemon継続proof、安全な資格保存、標準HTTP OAuth/PKCEとの統合、実providerと本番engine、本人による新版UX受入。directory全般操作の目標は未達。今回の操作は許可判定とメモリーcounterだけである。
