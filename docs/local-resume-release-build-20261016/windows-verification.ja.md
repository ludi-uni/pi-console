# Windows実確認の範囲と未確認箇所

今回行ったのはリリースbuildのみ。旧74件はpublic dummy/fakeの受入であり、本番Windows E2E成功の件数ではない。今回、追加のWindows SID/DPAPI呼出し、実client、実資格、実grant、本番server起動は0。

| 層 | 確認できていること | 実Windowsで未確認なこと |
| --- | --- | --- |
| DPAPI helper本文 | 以前の本人承認済み公開dummy受入1回。Protect1/Unprotect3、PS4、Node2、4.33秒。読戻し・別Node読戻し・改変拒否、2ファイル削除、PID終了を確認。本文SHA256は adf312317fe4e45cd631ab6af4d4ec20de2da8c5f7c72466cff6725710c16387 で今回も同じ。 | 旧受入は小さな公開payloadとfixture entropy。新store全体、実資格、大容量、実アカウント切替を試験したものではない。 |
| 新local-mcp-windows transport | 固定system PS、static script、private stdin/stdout、10秒timeout＋終了確認待ち2秒、固定error、出力上限。fake runnerでdefault拒否・正規応答を確認。 | 新transportの実spawn・最小env（SystemRoot/WINDIR）・実stderr/exit・timeout/終了確認。旧harnessは別transportで、同一の本番portとしてのOS受入ではない。 |
| SID/本人・端末binding | SID、installation ID、登録本人recordのbinding変更をfakeで拒否。登録本人のrevoked/不明も拒否する配線。 | WindowsIdentity.GetCurrent().User.Valueという新SID scriptの実呼出し。実SID形式・権限・実登録recordとの一致。installation IDはコピー可能な識別子であり、TPMや物理端末の非移植証明ではない。 |
| JSON storeとcompanion proof | 実Windows上のNode Temp I/Oをpublic dummy codecで実行。最終8所有root、別Nodeでのserver/client読戻し、revoke後再起動、失敗lockを確認。 | そのI/Oへ実DPAPIを組み合わせたwhole-store E2E、既存dataDirのACL/reparse実状態、停電耐久。Windowsのmode 0600をACL保証と扱わない。同一本人の悪意あるprocessのOS隔離は対象外。 |
| UI/stdio | 74件のfake/pure/Temp/loopback、専用headless Edgeの画面5枚。MCP stdio lifecycleはfake transportで確認。 | 実client製品、実profile、実cookie/実SDKと新保存をつないだ一連のWindows E2E。画面試験はfake本人確認の独立component fixtureであり、本番本人窓ではない。 |
| リリースbuild | 329ファイルの同一候補コピーでtsc全設定とVite production buildが成功。index/owner両entry、静的成果物13件。 | build成功はserver起動・OS crypto・client接続を意味しない。これらを起動していない。 |

## 今回の既定OFF適用と、後の有効化を分ける

今回のsource候補はenabled:falseで、authorizedOS:trueも指定しない。OFFのsource/dist反映の前提として、追加DPAPI試験や実client接続を要求しない。反映時には既存managerの所有確認・起動health確認を行い、起動確認できなければ復旧する。新経路を実用へ有効化する前には、少なくとも下記の新Windows portの限定確認が残る。activation-previewは今回の適用対象外。

## 有効化前の限定実確認案（未実行・未承認）

- 対象は新createWindowsProtection/runWindowsHelperそのもの。固定の公開dummy JSONと公開用途entropyだけを用い、現在のWindows本人SIDを1回だけ読み、値をチャット/URL/argv/logへ出さずに内部整合確認する。role credential生成、grant作成、profile読取はしない。
- 上限: SID読取1回、Protect1、Unprotect3、Node2、PS5、所有Tempの2ファイル各8KiBまで、全体60秒、helper10秒（終了確認待ち最大2秒も全体内）、自動再試験0。
- roundtrip、別Nodeによる同じdummyの読戻し、改変拒否を照合。spawn失敗/timeoutと期待した拒否exitを区別し、失敗を改変拒否の成功に数えない。
- 実行前に入口・対象source・上限をhashで固定し、fake preflightを行う。PID/所有root/file identity/終了・削除を記録。未知file/差替え/終了未確認は保全し、不完了とする。
- 旧1回の承認を再利用せず、この別範囲の明示承認後だけ実施する。ネット接続、実client、MCP有効化、本番restart/source/config変更、native folder binding試験、ACL/account設定変更を含めない。

この限定案だけでもwhole-store/本番Windows E2E全体の成功とは呼ばない。後の新規連携は本人が実scope・保存先・期限を選ぶ別操作であり、今回の反映承認に含めない。
