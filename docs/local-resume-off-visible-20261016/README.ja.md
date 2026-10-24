# OFFでも新しい確認UIを表示する候補

本番未適用。現在Dとの差分はsource3更新とdist14の一組。現Consoleのserver/package/権限境界は変更しない。

## 見える場所と操作

既存のローカル本人管理で認証した後に、新しいローカルMCP連携が常に見える。権限機能OFFは明示され、実際の開始と承認はdisabled。画面の流れを確認→親フォルダ・期間・操作の下書き→未保存の確認画面→戻る／閉じて破棄という、ローカルメモリ内の確認だけができる。再読込で下書きは消え、Consoleへ送信・保存しない。接続済み・承認済み・保存成功や接続IDを作らない。

available===trueの場合だけ既存のActive componentを使う。OFF側には通信・storage・crypto・timerがなく、既存pending receiptも上書きしない。本人認証の境界は従来どおり。

## 検証

focused SSRは旧版2pass/3failのREDから、最終5/5のGREEN。関連pure integration37件と合わせて42/42成功。Activeの状態/通信プレフィックスとイベント/ガード28属性一致。tsc --noEmitとVite 7.3.6 build成功、14静的ファイル。既存installed依存のみ、install/hook/実env/profile読取0。

実LocalOwner/新UIを専用headless Edgeとloopback fake owner APIで検証し、最終34項目・32操作、7画像。OFFのまま再読込・履歴遷移・本人認証切れ・不正capability・true→false・入力focus・下書き破棄・disabledボタン強制clickを検証。OFF側の新連携要求0、資格/許可/transportの変更要求0。有効branch回帰に使ったfake resume/viewのreadだけが1回で、実MCP接続ではない。実owner/session/profile/clientを使用していない。

fixture訂正の経緯（CLI runnerのURL global、既存ボタン名2か所、累積counterのrun窓、非同期切替待ち）は各error logに保存。文言調整前にも1回34項目を完了し、最終文言でも再実行して完了した。意味的regionを追加した初回buildと文言調整前buildのログも保持。製品のbackendを推測修正していない。

## 配信と復旧

変更source3件のbefore/afterとdist14件のhashをdeployment-manifest.jsonに固定。family-source-manifest.jsonは全24件の参照用で、配置対象を拡大するものではない。

distは現候補に対して同一8、HTML変更2、新asset4。共有chunk再分割でindex JSも変化するので、ownerだけのassetコピーにしない。HTML2件から参照するassetが全てこのbuildに含まれることを確認した。

managed再起動不要: server/index.tsとlocal-owner-bootstrap.tsがGETごとにdistをreadFileするため、静的配信更新で反映する。newassetを先に配置し、HTMLを最後にatomic置換する。既存asset12件保持。本人cookieの通常期限切れを除きserver再起動による切断を発生させる必要はない。

backup/current source3 + dist22 =25件を保全。復旧はsource3とdist22を戻し、旧HTMLを最後に復元。新asset4はopen tabが参照する可能性があるため直ちに削除する必要はない。削除する場合も元々未存在かつ適用hash一致の所有物だけを、安全な参照確認後に扱う。未知の変更は保持する。rollback-plan.json参照。

## 適用状態

本番source330/dist22/既存dirty15/HEADと旧seal430/60/9が不変。Startup、設定、資格、grant、ネットワークに変更なし。検証用HTTP・専用browser・捕捉15PIDは終了確認。実Console PID2576は稼働のまま。CAIVI共有ブラウザーへのattachや実機画面操作0。OS crypto/native/option2 transport0。本番配置0、追加managed再起動0、公開/commit/push/Library保存0。

今回の表示分離は実権限の有効化とは別。providerや実資格transportの運用条件を確認済みとはしない。
