# 同じ親・4操作の新規 pending 申請

2026-10-20。**正規の新規申請を1回作成し、受理時 pending を確認した。本人の最終承認・grant有効化・資格受取・復元・実利用接続は実行していない。**

## 本人へ渡せる情報

本人用ローカル画面: **http://127.0.0.1:56113/local-owner/**

**Console PC 本体で開く URL。** GET で HTTP 200 / HTML、Set-Cookie なし、redirect なしを確認した。コード・proof・token・query・fragment を含まず、URL自体に承認権限はない。外部共有や別端末からの承認用リンクではない。本人 cookie が必要で、新しい owner-login は今回実行していない。本人確認が必要な場合は、その本人操作を別途確認する。

| 項目 | 内容 |
| --- | --- |
| **新しい接続 ID** | **`304215fd-0ff6-416f-831c-cd03bd3a35b4`** |
| 画面での接続名 | `MCP stdio companion`。必ず上の ID で照合する |
| 親フォルダ | `C:\Users\leade\AppData\Local\Temp\pi-console-local-mcp-trial-20261019` |
| 操作 | **list / directory / repo / workspace** |
| 許可期限の選択 | **review 作成から7日**。絶対期限はまだ未確定 |
| 初回申請・受取期限 | **2026-10-20 09:47:49.759 UTC = 18:47:49.759 JST** |
| 受理時刻 | **2026-10-20T08:47:50.951Z** |
| 本人 review / 最終承認 | **未実行** |

本人画面で新しい ID を選択し、親・4操作・7日を照合する。「許可内容を確認」で実際の grant 期限が表示される。**最終の「この内容で始める」は別の確認まで押さない。agent は代行しない。**

この API の pending request 自体は client / request / 初回 proof を保持し、parent / operations / period は本人 review で結び付く。この段階で server に同じ scope が承認済みであるとは報告しない。指定 scope の下書きを public-request.json に保持し、本人の選択内容と照合する。

## 期限の区別

新しい初回申請の期限は作成から60分で固定。再表示・再送・companion の保持で延長しない。元 fcf の経過済み期限を流用していない。本人の確認 review は最大5分かつ初回期限内、本人 cookie は10分で、7日 grant の期間とは別。

7日 grant の絶対期限は **本人 review 作成時点+7日**。最終承認時や今回の pending 作成時から取り直すとは扱わない。旧 fcf の本人観察期限を変更・流用していない。

## 今回の実行

1. 同じ親と4操作、7日案を元記録と照合。署名付き read-only broker 情報を1回確認し、既存 PID 41232 / start 2026-10-20T06:33:21.560Z の broker を再利用した。Console / broker の再起動・新規起動はなし。
2. 新 source を読む作業専用 companion を起動。version 2 / inspect catalog を確認した。既存 client 常駐 companion の置換 API はなく、その置換は未実施。
3. 正規 inspect で、`codex-local-v1` の継続 record missing / 材料 absent と、元の初回 record expired / 元期限 2026-10-20T01:26:54.443Z を確認した。別の保存済み接続が出現した場合は停止する条件を設けた。
4. この条件下で正規 cancel を1回実行し、**client の期限切れ local enrollment を終了**。結果 disconnected / ownerGrantRevoked=false。旧 fcf や他接続の grant 解除はしていない。client資格storeへの書込みはguardで禁止した。
5. 新規 begin を1回実行。新しい client 認証 proof の生成・DPAPI保存、server 発行初回 claim proof の private 取得・RAM保持を行った。pending の public metadata だけを記録した。
6. 本人用 URL の静的 GET を1回確認し、専用 companion を有限期限で保持中。最終承認、claim / resume / renew / rpc / list / create は呼んでいない。

requestId: `codex-folder-request-5daa0626-e1fc-482e-bb73-5d99065208db`。これは照合用識別子で、秘密の proof ではない。応答喪失や拒否はなく、新規申請の再試行は0。内部の管理 GET は各 transaction の身元guardで繰り返される正常確認であり、失敗した申請の再送ではない。

## 制限の実証

| 確認 | 結果 |
| --- | --- |
| source | **144/144 件不変** |
| データ属性 | 14件中、変更は **local-mcp-enrollment/state.dpapi のみ** |
| server grant/資格 store・client資格store・registry・管理状態 | 属性不変 |
| enrollment の残存 `.lock` / pending temp | **なし / 0** |
| 新規 private request POST | **1回、HTTP 200** |
| 内部署名 identity GET | **27回**、すべて正常。別途の事前 read-only GET は1回 |
| 本人ページ GET | **1回、HTTP 200**、新 cookie・redirect なし |
| 許可外通信 / 書込 / spawn の試行 | **0 / 0 / 0** |
| SID / DPAPI helper | **16件、すべて exit 0 で終了済み** |
| ガードの隔離dummy | 公開dummy codecで3コミット成功。実資格・OS helperなし |

ガードは書込先を正規 enrollment store の lock / atomic temp / replace に限定し、client資格storeや他の data store を禁止。client/store の実施前 fingerprint を確認し、外部差し替えがあれば拒否する。通信は既存管理 identity GET と pending request POST 1回のみを許可し、approve / claim / resume / renew / rpc / cancel-request / shutdown / 新broker起動を禁止した。本人ページ GET は controller から別に限定実行。

許可された **申請用proofの生成・取得・保護保存**以外に、役割別 read/control/final資格の発行、資格受取/get、既存資格の復元・更新、grant有効化、実利用接続、権限・期限変更、新規login、repo/workspace作成は実行していない。秘密値・DPAPI blob・SID・helper入出力・raw protocol・raw stderr・profile/.env・process command line を保存・出力していない。

## 保持中の process と次の手順

- holder PID **43852** / companion PID **38140**。tool session **97968**。確認時は `holding_pending` で、companion は起動中。
- 保持期限 **2026-10-20T09:47:49.759Z**。期限に stdin EOF で閉じる。保持は期限延長・grant承認・資格受取ではない。HTTP listener / named pipe を新設していない。
- controller の入力は **status / close だけ**。status は受理時の cached public metadata を返し、server 状態の再照会や grant有効化はしない。close は作業用 process の終了で、server grant解除ではない。
- 保持中に自動 get / claim / resume を行わない。将来の接続が別途許可された場合も、現在の guard は受取・復元を許可しない。正規の companion と元 requestId による期限内・同世代の照合手順を使い、勝手に新しい request を作らない。
- `grantActive=false` と pending は **受理時点の観測**。以後の server grant 状態を監視していない。本人が独立に操作した現在状態まで断定しない。

本人による review と最終承認、必要な本人確認、新規資格の受取/get/実接続は追加の実行範囲。scopeを確認した最終ボタンは資格発行・grant保存/有効化を伴うため、今回の申請準備から進めない。

元 fcf の grant 解除、他接続の手動操作、Console再起動、dist/source配布、OS専用entry/native試験、ACL・アカウント・ネットワーク設定、pi-warden、他アプリ、commit/push/publish はなし。画像・UI操作は0。

## 証拠

Temp root: `C:\Users\leade\AppData\Local\Temp\pi-console-request-live-20261020-d24f`。`request-receipt.json` は holder により終了時にも更新される。**この docs の copy は封印時点のsnapshot**で、後から書き換えない。

public-request.json、verification.json、preflight.json、owned-resources.json と seal.json を参照。所有した process と helper PID / 終了状態は記録済み。稼働中 holder を終了済みと扱わない。秘密storeのバックアップや複製はしていない。
