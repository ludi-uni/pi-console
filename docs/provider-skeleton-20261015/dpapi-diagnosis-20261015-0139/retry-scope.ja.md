# 修正案を確認するための次の一回（未承認・未実行）

元の受入は終了・片付け済み。helper上限2個を消費しており、残った復号回数枠を使って続行しない。元blobも削除済みなので、次に再試験するなら**新しい一回への明示承認**が必要。

推奨する範囲は、未実行差分の短名解消とstage/例外型記録だけを入れた、同じ公開dummy受入一回。

| 項目 | 次の一回の上限 |
| --- | --- |
| 対象 | `PiConsole.PublicDummy.DpapiAcceptance.v1`、既存の公開固定dummyのみ |
| 方法 | DPAPI CurrentUser、追加entropy null。専用helperのhash関数を `Get-FixtureByteHash` にする |
| 時間・process | 開始から最大10分、専用helper最大2個。同じ本人Windows user。所有PID・開始時刻・終了を記録 |
| API回数 | Protect最大1回、Unprotect最大3回（親往復、別helper再読取、改竄copy拒否）。呼出し前にcounterを増やし、上限を越えない |
| 保存 | 新規の所有Temp `pi-console-dpapi-dummy-<new-run-id>\vault` に `roundtrip.dpapi` と `tampered.dpapi` の最大2ファイル、各64KiB以下。helper source/結果のための追加試験fileは作らず、sourceは既存資料、結果はtool outputで保持 |
| cleanup | その回にCreateNewで作成したblobだけをpath/hash確認して削除し、空のvault directoryを削除。変更・残存が不明なら他fileを掃除せず報告 |
| 失敗時 | 固定stage・例外型・HResult・API counterを報告し停止。例外本文やstderr全文、argv/env、保護dataはlogへ出さない。追加helperや別のscopeで再試行しない |
| 除外 | 実credential・他vault・profile/.env列挙、ネットワーク要求、別account/昇格/ACL・設定変更、daemon・MCP・Pi・本番適用は0 |

既存実行環境が受け付けたshell名は `powershell`。フルpathをtoolのshell指定に渡す初回準備は実行前に拒否されていたので、それを繰り返さない。childの固定Windows PowerShell path自体は元試験から変更しない。

この再試験を承認された場合の追加上限はhelper2 / Protect1 / Unprotect3 / blob2。前回の実測helper2 / Protect1 / Unprotect1と合算すると、2回全体で最大helper4 / Protect2 / Unprotect4となる。前回の承認をこの追加分に流用しない。

同process成功は既に得られているが、別helper再読取と改竄拒否が残るため、修正効果を確認するには新しい公開blobからの一回が必要。今回この提案は実行していない。
