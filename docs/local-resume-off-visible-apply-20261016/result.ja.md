# 権限OFFの新画面：静的配信への適用完了

固定候補 source3件・dist14件をDの実配信へ適用した。実キー・grant・transport・権限有効化は0、追加managed再起動0。ConsoleはPID2576、開始時刻2026-10-16T03:04:07.545Zのまま稼働。CAIVIの前面画面や共有ブラウザには触れていない。

## 見る画面と操作

対象は通常Consoleの設定画面ではなく **「Pi Console ローカル本人管理」** の認証後画面。既存の本人管理タブを再読込し、**「ローカルMCP連携」→「画面の流れを確認」** を押す。親フォルダを下書き入力し、**「下書きの確認画面へ」** で **「許可内容の確認（下書き）」** が開く。既定の期間・操作なら、再読込・確認ボタン・親フォルダ入力・下書き確認の4操作。戻るで入力維持、閉じて入力を破棄で取消。再読込で下書きは消える。実フォルダの作成や照合はしない。

本人認証が期限切れなら、新画面は表示されず従来の一回コード入力になる。本人が必要に応じて**D:\Develop\pi-console** から既存の node package/pi-console.mjs owner-login を実行し、明示確認後に本人だけがコードをローカル画面へ入力する。今回はその操作を実行していない。既存の「トンネル連携を選ぶ」「フィオにつなぐ」経路とは別の、上記「ローカルMCP連携」の表示確認である。

**「権限機能はOFFです」** を表示する。実際の開始・同意・許可は無効。接続済み・承認済みの表示やIDを作らない。下書きの内容はConsoleへ送信・保存しない。

## 固定範囲と保全

更新sourceは web/LocalOwner.tsx、web/LocalResumeMcp.tsx、web/local-resume-review.css の3件。dist14件のうち8件は同一内容なので書き換えず、新asset4件を先に配置、source3件更新、参照assetを検査してからHTML2件を最後に原子的置換した。実書込み9件。旧asset12件を保持し、現在dist26件。共有chunkの再分配に伴いindex.htmlとmain/shared JSも候補に含まれるが、MainApp sourceやbackendは変更していない。

適用直前にsource330/dist22、既存dirty15、HEAD、候補seal506・以前seal430/60/9、payload17件、固定ZIPとmanifestを照合した。今回新たにsource3/dist22の25原本を専用Temp backupへ複製しhash照合。以前の同内容backup ZIPも照合済み。適用後も対象17hash一致、対象外source327・既存dirty15・旧asset12・HEAD・tracked statusを保全。server/manager/Startup/.env/profile/networkは今回変更していない。

固定ZIP SHA256: f04a7cc9cc8983ac58195d9c2f888f7ac3229f3a403e633c42420ce49c2e8248

固定manifest SHA256: 3b6f9cbcdfa3c0e9d1225648090181179ec756f7967ccd6321ea3e958638ff1f

## 実配信と表示検証

実際のloopback本人管理HTMLが200で、新owner.htmlのhashと一致（配信時の/local-owner/assets/書換えを正規化）。owner/mainが参照するJS/CSS計6件を実配信からGETし、全hashがmanifest一致、no-store。通常公開側HTMLへの無認証GETは従来どおり403で、制限を迂回していない。main HTMLはディスクhashを確認し、公開側で認証済み表示を確認したとはしていない。

専用headless Edgeで **実配信HTML・実配信asset** を読み、**本人状態と周辺登録statusだけdummy応答** に差し替えた。実Cookie・本人ログインを使わず、実サーバーへの送信は静的GET10回だけ（別HTTP hash検査はGET8回）。それ以外のAPIを遮断。本人認証なしではUI非表示、dummy本人状態ではOFF表示、下書き31日・未保存・未承認・非接続表示、無効承認の強制二重clickでも要求0、戻る・破棄・再読込、390px横はみ出しなしを確認。**16項目成功・12操作・画像5枚**。runtime JS error0、外部origin request0、実認証API0、実キー/grant/transport0。5画像を目視確認した。

画像上部に「HTML・assetは実配信／本人状態だけdummy」を明記。2030年の本人期限や未登録表示はfixture応答で、実ユーザー状態を示さない。**実ユーザーの認証済みタブは未確認**。実本人確認を代理したり、既存Cookieを読み出したりしていない。ここは残る確認範囲として明確に区別する。

固定候補自体の事前検証は回帰42/42、UI34項目32操作7枚、type/build成功。今回payloadを変えていないので再build/通常のOS副作用testは行っていない。今回の表示検証と混同しない。

## 終了と復旧

検証用HTTP server追加0。専用ブラウザconsole-off-apply-d8e4b731をcloseし、捕捉した8PIDすべて終了確認。共有ブラウザのattachなし、CAIVI前面操作なし。最後の管理状態確認は 2026-10-16T04:10:27.412Z、PID2576でmanaged/running。

適用失敗0、rollback実行0。復旧時はbackup source3/dist22を用い、未知の変更を拒否して今回のsource3/HTML2のみ元hashへ戻す。旧HTMLは最後。新asset4は開いたタブ参照を保つため即時削除しない。元々存在せず適用hash一致の所有assetだけが将来の削除対象で、未知の変更を上書きしない。固定rollback-plan.jsonと今回のbackup-manifest.jsonを参照する。

事前検査scriptの末尾改行・dist相対path正規化、およびCLIのPowerShell引数を修正した。いずれも本番変更前/ブラウザ起動前の検証側問題。CLI更新通知には従わずinstall/updateなし。

権限有効化・実キー/grant・transport・追加再起動・pi-warden作業・OS/native試験・commit/push/publish・Library保存はいずれも0。残るのは必要なら本人が既存タブを再読込して見る確認だけで、権限有効化ではない。
