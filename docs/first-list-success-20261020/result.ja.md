# 承認済み接続1件の資格受取・短期更新・一覧取得

**完了。** 接続 **304215fd-0ff6-416f-831c-cd03bd3a35b4** の正規claim、CurrentUserのDPAPI保護保存、必要な短期更新を経て、**許可親一覧を1回**取得した。

| 一覧の実結果 | 値 |
| --- | --- |
| 親 | `c:\users\leade\appdata\local\temp\pi-console-local-mcp-trial-20261019` |
| 操作 | **directory / list / repo / workspace** |
| grant期限 | **2026-10-27T08:55:02.091Z = 2026/10/27 17:55:02.091 JST** |
| 変更 | **親・操作・grant期限は変更なし** |
| 一覧完了 | **2026-10-20T09:43:01.090Z** |

## expired の意味と正規再開

本人が09:25 UTCに返した正規viewのstateはexpiredだった。今回のclaimで確認した非秘密handoffメタデータでは、初回短期資格の期限が **09:00:53.413 UTC**、grant期限は上記の未来日時だった。expiredはこの短期資格期限切れと整合する。

それとは別の初回受取windowは、serverの生期限 **09:47:50.950 UTC**、clientの元期限 **09:47:49.759 UTC**。正規clientは **min(server,client)=09:47:49.759 UTC** を採用し、今回もその短い方を維持した。差は **1191ms**。新しい期限に取り直していない。

claimには既存の初回window、本人承認済み内部state/admission、grant未失効、proof、familyとclock、親のpin等の正規条件が適用される。短期資格が切れていることを無視してRPCせず、正規handoffで継続材料を保護保存した後、通常resumeがcredential_expiredを返し、同じ対象だけをrenewした。

更新後は **epoch2**、短期資格期限 **09:47:55.371 UTC**。この5分の短期資格期限は初回の「受取window」と別で、grant期限内にclampされる。初回受取が元期限内に完了した後の正規継続であり、初回期限や7日grantの延長ではない。

## 実際の操作数

今回成功した実行は **09:42:48.243〜09:43:01.100 UTC**。

| 処理 | 回数 |
| --- | --- |
| 元requestIdの照合 | **1**（元申請の照合。新requestIdなし） |
| claim | **1** |
| get tool | **1** |
| resume | **2**（get内と一覧前の正規再接続） |
| renew | **1**（epoch1→2） |
| list tool / RPC | **1 / 1** |
| 新規申請 / 再承認 / grant延長 | **0 / 0 / 0** |
| repo / directory / workspace作成 | **0** |
| Console / broker再起動、新login | **0** |

claim前のlocal inspectで継続record missing、元の初回record pendingを確認したため、済んだclaimや保存済み継続recordを重複利用していない。過去の停止試行と合わせると元request照合は2回だが、過去試行のclaim/renew/RPCは0。今回が最初で唯一のclaimと一覧である。

各private routeは対象ID/clientIdに固定し、requestは元のrequestIdだけ、RPCはlist_allowed_parents・空argsだけを許可した。返却メタデータのID・grant期限、一覧の親と4操作を秘密値を出さずに照合。通信/書込/response/spawn/新proof生成の許可外試行はすべて **0**。

初回claimの値そのもの、role key / proof / token / renewal / Cookie / DPAPI blob / helper入出力 / raw protocolを記録していない。資格は既存の正規保護モジュールだけが保存した。source、profile/.env、process command line等から秘密を抽出していない。

## 期限ガード修正と停止履歴

最初の自動承認reviewは事前ID guard不在を理由にprocess起動を拒否した。未実行確認後、反映済み実moduleへの16件のnegative testとsource確認を追加し、同一コマンドの1回再申請が許可された。

その実行は、task用ガードがserverの生初回期限と公開client期限の完全一致を誤って要求したため、claim前で停止した。productの既存min契約と不整合だった。停止後の候補は8件の純粋メタデータ検証に成功。

親の「既存承認内で安全に完了できるなら続ける」という追加指示の下、元のclient期限を一切伸ばさず、対象CID・生server期限・effective期限を先に記録する限定再照合を1回だけ行った。実測で1191ms差とCID一致を確認し、既存のmin契約で受理した後だけclaim以降へ進んだ。product sourceの期限条件や認証を変更・迂回していない。前回の不一致の原因となるガード不整合を具体値で解消した。

## 保全と終了

- source **144/144 件不変**。今回の本番source/dist/client設定変更は0。前段で反映済みの4 packageは維持。
- data属性14件のうち、変更は正規の **local-mcp-client-state/state.dpapi、local-mcp-enrollment/state.dpapi、local-mcp-resume/state.dpapi** の3件だけ。初回受取・pending renewal・更新資格・元enrollment終了に必要な正規commit。registryや管理状態等は不変。
- runtimeガードで対象以外のprivate操作を禁止。server側の資格更新も既存の単一family renew経路。保護store内の全familyの秘密値を比較する監査はしていない。
- 受取用companion PID **3496** は **exit0で終了**。SID/DPAPI保護helper **31件すべて正常終了済み**。
- 古い保持process PID **43852 / 38140** は、tool session97968がUnknown processでclose送信できなかったため、正確なPIDだけをhost側で読取確認した。**両PIDは存在しない**。終了時刻・理由は記録がなく不明。古いreceiptのholding_pendingは過去キャッシュで、稼働中とは扱わない。Consoleや他アプリをkillしていない。
- 作業用HTTP listener / named pipeを新設していない。今回の稼働中資格資格値は会話にも成果物にも出していない。

## 適用・利用確認の範囲

成功は、反映済みinstalled entryを読み込んだ **作業用の正規stdio companion** によるもの。既存クライアントの常駐companion/catalogの再読込は未確認のまま。実クライアントのUIまで自動設定・再読込済みとは報告しない。

承認済み資格はWindows本人用保護領域へ保存済みで、作業用process終了はgrant解除や資格忘却を行わない。将来の利用は同じclientId・接続IDによる正規継続経路を使い、短期資格切れを7日grantの失効と混同しない。今回は一覧1回で終了し、自動更新・追加操作・常駐監視を開始していない。

画像/UI操作0、OS専用entry/native試験0、pi-warden/他アプリ/ACL/アカウント/ネットワーク設定操作0、commit/push/publish0。

## 証拠

Temp root: `C:\Users\leade\AppData\Local\Temp\pi-console-first-list-normalized-20261020-f17a`。

`receive-receipt.json` は非秘密の接続/route/epoch/期限/一覧メタデータとhelper終了だけ。`verification.json`、`continuation-scope.json`、試行guard/controller、`normalization-candidate.mjs`、`owned-resources.json` と `seal.json` を保存する。過去の停止試行は `../first-list-attempt-20261020/` に別途保全し、成功結果で上書きしない。
