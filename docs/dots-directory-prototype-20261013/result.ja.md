# Dots連携 directory対象試作 — 未適用・本人レビュー待ち

登録workspace／許可directory配下を明確に選び、対象・対応操作・期限→接続照合→許可確認→状態／解除を操作できる隔離dummy試作を保存した。**directory modeは現状作成系のみ。「許可directory以下を操作」全般は未達。**

提供できるものは、許可rootと作成結果のmetadata、新規root直下directory、固定の空local repo構造。workspace登録もIDも不要で、workspace:falseを強制する。既存file一覧／本文read／任意write・上書き、rename/delete、任意shell/processは画面disabledとAPI拒否を維持する。file操作を追加するhandle/identity/hardlink/overwrite/partial契約と、process実行の制約はnot-yet-supported.ja.mdで別々に整理し、実装を追加していない。

## 実装場所と境界

source・bundle・試験は所有Temp pi-console-dots-directory-prototype-20261013-56c68a4d内。Dの純粋契約14ファイルを同一hashでbaselineへコピーし、FolderMcp／Windows source provider／PiControlActivation／Preparationをin-memory portとfake serviceで呼ぶ。OS filesystem／native／Git／SDKを呼ぶための機能は持たない。directoryはUI filter/cwdでなく既存scope APIのoperation/expiry/rootとsource handle/volume/file identityの検査で拒否する設計だが、mock成功を実Windowsの証明とは扱わない。

workspace modeは既存exact session/generationを保つ。directory modeの権限判定からworkspace項目を外した。Dots名称、一般stdioの同じ対象／操作の模擬、snapshot/draft分離、背景取得の非busy化、focus/selection/scroll保持、古い応答・instanceの確認失効、中断再開、nonce結果照合を含む。実clientのsecure import／App bindingや実連携を保証しない。

## 最終検証

- 独立domain 53/53成功。root外・相対/..・case衝突・UNC/device/ADS・不明volume・junction/reparse・親identity差し替え・mock TOCTOU・expiry/revoke・partial・複数client・重複nonce・workspaceなし・exact generation。
- view-state 5/5成功。draft保持、seq/revision/epoch破棄、編集時確認失効、auth/revision/instance変化。
- 型検査24入力、診断0、noEmit。Node/React/Playwrightの依存は現在Dのものをreadonly参照。
- dummy UI 9ケース成功、95高水準操作、21画像、pageErrors0。1280px／390px、65秒／28回取得中の入力・選択位置・focus・scroll・compositionイベント保持、old review、中断再開／reload、応答喪失と一回作成、empty workspace/stdio、generation失効、切断／期限／解除、partial/invalid root。
- 起動wrapper self-check：wrapper5156／entry9312、exit0。2.5秒でHTTP/providerの正常終了をawait。強制signal0。通常の10分レビュー起動は未実施。
- 二回のUI受入18fixtureとentry1fixture、計19のdummy HTTP/providerが終了し、memory handle0。freshブラウザーもclose await済み。

REDは未実装module欠落、途中のstrict DTO不一致や試験期待の修正、旧UI成功画像は保持した。最終値に途中の件数を加算しない。レビューは自己レビュー。本人のUX受入を試験件数で代用しない。詳細は各JSON、ui-evidence/、review.ja.md、compatibility.ja.md。

## 保全・適用状態

旧114files／725展開hash・旧ZIP・旧再計画文書、公開D source315filesと既存Git変更を再照合して維持する。今回のD追加は新規docs成果物だけで、source/distへは適用していない。本番stop/restart、新実credential／grant、実MCP/client、実SDK/Pi/native、repo実データ作成、OS設定変更、他Tunnel操作、pi-warden接触、commit/push/publishは0。secret/profile/.envを取得・保存していない。

## 本人のレビュー

READMEの6操作と21画像で、二つの対象、workspace不要、root・操作・期限の一連確認、未対応表示、背景更新・中断再開が意図に合うか見る。操作する場合は配布ZIPを新しい所有Tempへ展開してlaunch-preview.mjsを実行し、出力されたdummy localhost URLへ進む。実Console URLや本物のkeyは使わない。10分またはCtrl+Cで終了する。

正式適用／新permissionの有効化は別確認。今回の未達部分を許可済み・実装済みとして次の実運用へ進めない。
