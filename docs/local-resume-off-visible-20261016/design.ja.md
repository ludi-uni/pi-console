# OFF表示と権限機能の分離

LocalOwnerは認証済みの枠内で新しいLocalResumeMcpを常に表示する。実権限は認証statusのresumeAvailable===trueのみで選び、false/未指定/不正値ではOFF専用componentを表示する。従来LocalFolderMcpへの暗黙のフォールバックはやめる。既存の別用途設定・本人登録・認証の境界は変更しない。

OFF側はネットワーク要求、sessionStorage、接続ID生成、資格・grant・接続の生成処理を持たない。親フォルダ・操作・期限をメモリ内の下書きとして入力し、実確認と共通の要約表示で内容を確認できる。下書き・未保存・未接続・機能OFFを常に明示。承認・接続開始・同意チェックはdisabledでhandlerを持たず、技術詳細にも「現在は保存していない」と記載する。接続IDや成功状態のdummyを実装に混ぜない。存在・安全性未検証のパスを許可済みと扱わない。

表示確認は開始→入力→確認→戻る／閉じて破棄。画面再読込・ログアウトでは下書きが消える。本人状態の再取得でOFFが継続している間は入力とfocusを保持する。有効側componentは独立してmountし、OFFへ変わればunmountする。既存の承認・取消・再送防止・保存結果照合の処理は維持する。

受入: focused SSR回帰をRED→GREEN、専用headless Edgeとloopback dummy owner APIで実LocalOwner/新componentのOFF表示・入力・確認・狭幅・再読込・履歴遷移・logout・権限切替・不正statusを検証。禁止APIをfixtureで拒否・計数し、実資格と実grantは0。CAIVI共有ブラウザーには触れない。通常test一括とOS/native/option2 transportは使わず、明示したpure fake回帰だけを実行する。

既存installed依存だけでtype/buildし、現D差分はUI3ファイルのみを想定。最終実ファイル数/hashから新配布物を固定する。本番apply/restartは行わない。

HTML/CSSは既存のdetails、grid、media、通常input/select/buttonとdisabledを用いる。新規Web APIは導入しない。MDN Baselineの既存確認に加え、今回の実Edgeの広幅・狭幅表示とキーボード操作を検証する。
