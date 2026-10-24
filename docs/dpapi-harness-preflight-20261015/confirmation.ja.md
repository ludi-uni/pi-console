# 本人確認用・限定OS dummy受入（未実行）

公開dummyだけでCurrentUser DPAPI adapter単体を1回実行してよいですか。実行対象は下記固定入口とplan hashです。

- Protect最大1、Unprotect最大3（同process読戻し、別Node読戻し、改変拒否）。1 API attemptにつきPS helper1個。
- 所有Tempは C:\Users\leade\AppData\Local\Temp\pi-console-local-resume-os-dummy-<一意ID>。head.dpapi / tampered.dpapi の2 datafile、各最大8192 bytesだけ。source/log/owner markerは試験中追加しない。
- Node最大3（現在のcodeはSupervisor＋readerの2）、PS最大4。各helper10秒、work45秒＋cleanup15秒＝全体60秒。自動再試験0。
- helper起動時にPID/role/時刻を記録。失敗/timeoutは残りを止め、所有handleだけを停止して終了確認。未知のfile/差替え/終了未確認は削除せず保全・報告し、完了扱いしない。
- fresh rootのidentityとrealpathを確認し、2fileの既知identityだけをunlink、空rootだけをrmdir。recursive削除なし。
- payloadは {"schema":1,"purpose":"PiConsole.LocalResume.PublicDummy.v1","value":"public-dummy-no-credential"}。entropyも公開fixture owner/deviceだけ。秘密をargv/logへ出さず、private pipeを用いる。結果出力は回数・成否・PID・削除確認のみ。
- ネットAPI/外部service不要。実profile、issuer、資格情報、実grant、保存先設定、MCP/provider、実client、本番daemonを触らない。OS内部DPAPI動作の隔離/監視や設定変更はしない。

入口: C:\Users\leade\AppData\Local\Temp\pi-console-dpapi-harness-prep-20261015-a275b2e1\acceptance.mjs

入口SHA256: 57d946d051df25855872a792484e638f0d3fb243115208c7e61788398e256f6e

plan hash: eb4a93d9ad4c6672186ae0d6db57aa4aa374ab8a9471985cc2562d95f72d4c3f

## 承認後だけの実行command

以下は確認用の文案であり、今回は実行していない。

```powershell
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\leade\AppData\Local\Temp\pi-console-dpapi-harness-prep-20261015-a275b2e1\acceptance.mjs' --execute-public-dummy --plan-sha 'eb4a93d9ad4c6672186ae0d6db57aa4aa374ab8a9471985cc2562d95f72d4c3f'
```

同じcommandを自動retryしない。source/planが変わればhash一致で拒否する。次の実資格・本番適用の承認には流用しない。
