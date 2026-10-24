# 公開dummyのみのOS保護受入：承認案

**提案段階。まだ保護・保存・復号・削除を実行していない。** 次に推奨する一段階は、Windows DPAPI の CurrentUser で公開dummyを一回だけ往復させ、別helperでの再読取と改竄拒否を確認する限定受入。Credential Managerへの登録・列挙は行わない。

| 項目 | 限定する内容 |
| --- | --- |
| 想定保護方式 | 既存Windows/.NETの `ProtectedData.Protect/Unprotect`、`DataProtectionScope.CurrentUser`。追加entropyはnull。LocalMachine・独自暗号・平文fallbackは使わない |
| 論理対象名 | `PiConsole.PublicDummy.DpapiAcceptance.v1`。OS credential entry名ではなく専用fixtureのlabel |
| 保存先 | 新規の所有Temp `C:\Users\leade\AppData\Local\Temp\pi-console-dpapi-dummy-<runId>\vault\roundtrip.dpapi` と `tampered.dpapi`。runIdは非秘密の一意ID。今回このdirectoryを作らない |
| 保護する情報 | 公開固定文字列 `PI_CONSOLE_PUBLIC_DUMMY_V1` とfixture schema/labelのみ。read/control/final/renewal key、token、owner情報、実epoch/grantは含めない |
| 最大実施範囲 | 1個の所有root、1回・最大10分、同じ本人Windows user、専用helper最大2個。Protect最大1回、Unprotect最大3回（同process往復・別helper再読取・改竄copy拒否）。blobは2個まで、各64KiB以下。失敗/不明で範囲を広げず停止 |
| 接続先・設定 | helperによるネットワーク要求0、MCP/daemon/Pi接続0。追加install、昇格、別account、ACL/OS/security設定変更なし。既存profile/.env/credential内容をagent側で列挙・読取しない |
| 削除対象 | 当該rootの所有manifestでhashとpathを確認した `roundtrip.dpapi` と `tampered.dpapi` の2個、および空になった専用vault directoryだけ。既存vault/DPAPI master key/他Tempを削除しない。helper・manifest・非秘密結果はレビュー用に保全 |
| 復旧・停止 | 復号不能・改竄受理・不明な保存結果ならPASSにせず停止。平文保存へ切り替えない。削除確認不能なら対象pathと状態を報告し、他fileを掃除して帳尻を合わせない |
| 本人の操作 | この限定受入への明示承認1回のみ。キー入力・browserログイン・再起動は不要。承認後も、本番連携の有効化へ進まない |

実施前に、専用helperの差分・固定引数・所有manifest・既存OS APIの利用可否をこの範囲で確認する。APIが使えなければ追加softwareや権限を取得せず停止する。helperは個別PID/開始時刻と終了を記録し、秘密をargv/URL/logへ出さない。実credentialを生成・読取・保存・削除する許可とは明確に分ける。

CurrentUserのデータは同じWindows user contextが復号する方式であり、clientやアプリごとの本人識別にはならない。[Microsoft仕様](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.dataprotectionscope)。DPAPIはWindowsが管理する本人のlogon contextと鍵管理を内部利用する。その内部管理に副作用が一切ないとは約束せず、agentがOS保管鍵を列挙・変更・削除する操作は含めない。[CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)

この小さい受入が通っても、durable epoch/CAS/fencing、disk rollback防止、revokeとのatomicity、実sender attestation、credential bootstrap、実接続の承認まで完了したとは扱わない。目的は実OS保護プリミティブの可否を確認することであり、前段memory fixtureを実vaultとして有効化することではない。
