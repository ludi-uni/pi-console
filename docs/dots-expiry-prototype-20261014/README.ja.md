# 操作許可の期限を選ぶ隔離試作

1週間（7日）、1か月（31日）、期限なしを選べるdummy版です。既定は従来の15分です。稼働中のConsole source/dist、実権限、実credential、実clientは変更していません。前の試作と保全資料も保持しています。

## 短い確認手順

1. ZIPを新しい自分のTempフォルダへ展開し、下のコマンドをそのフォルダで実行します。表示された `http://127.0.0.1:<dummy-port>` を新しいブラウザー画面で開きます。実ConsoleのURLや認証情報は入力しません。
2. 「許可するdirectory配下」を選びます。rootはdummy候補 `D:\Dummy\Allowed` または `D:\Dummy\Other`。登録workspaceがなくても進められます。
3. 「操作と期限」でmetadata照合、新しいdirectory、必要なら固定の空repo構造を選び、操作許可を1週間・31日・期限なしから選びます。
4. 接続を模擬照合し、許可の確認へ進みます。「現在」と「変更後」の操作許可、有限の接続資格、転送保持を確認します。期限なしは追加の明示確認が必要です。
5. 許可とclient確認を模擬します。新規childの作成はメモリーだけです。入力変更だけでは既存許可の期限は変わりません。「操作許可の期限を変更する」から再確認して確定します。
6. 試験用detailsで8時間経過・再起動・generation変更を模擬します。長い操作許可が残っていても接続資格は失効します。同じ対象と操作を本人が再確認するまで操作を再開しません。
7. 「この対象の操作許可を解除する」で新しい操作を拒否します。作成済みrepoや送信済み本文を削除する意味ではありません。

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\launch-preview.mjs'
```

このPCの既存Node/tsx依存を使います。startup、Pi、SDK、native binaryは呼びません。10分後またはCtrl+CでHTTPとproviderを終了し、`review-preview-owner.json` に終了を記録します。dummy policyは展開先の `preview-data/policy.json` にだけ保存され、credentialは保存しません。再レビューは新しい展開先を使ってください。

## 三つの期限

| 項目 | 試作の扱い |
| --- | --- |
| 操作許可 | 7日・31日・明示した期限なし。owner、exact rootまたはsession/generation、操作に結び付けて保存 |
| 接続資格 | 最大8時間、メモリーだけ。再起動で失効。自動refreshや無期限tokenは実装しない |
| 転送保持 | 有限の1時間・8時間・7日・31日を模擬。stdioはTunnel不要 |

1か月は暦月ではなく31×24時間です。現行D sourceの転送選択は1時間・8時間・31日であり、7日転送は今回の試作にだけ追加した選択です。長い転送から長い操作許可を導きません。

期限なしは `{kind:'none'}` と本人の確認記録を明示して保存します。欠落、null、不正値を期限なしへ変換しません。旧有限期限は絶対時刻を保ち、自動延長しません。解除・期限切れ・対象変更は保存され、時計を戻しても復活しません。再起動後の許可は残せますが、接続資格を自動復元したり新sessionへ転用したりしません。

## 今回の限界

prototype専用のpolicy engineとfake providerの検証です。稼働中のFolderMcp/PiControlActivationへ期限永続化を適用した実装ではありません。本人認証・client認証・用途別read/control/final credentialは役割の模擬で、実credentialを生成していません。実MCP clientの接続機能も検証していません。

directory操作はmetadataと新規作成だけです。既存fileの一覧・本文読取・任意write・rename・削除・shell/processは未対応で、画面でもAPIでも拒否します。directory全般操作の目標は未達です。親folder許可は全run/history/final本文共有やOS sandboxを意味しません。詳細は `not-yet-supported.ja.md` と `expiry-design.ja.md`。

自動試験の成功と本人によるUX受入は別です。本人に確認していただく点は、期限の選択が分かりやすいか、現在と変更後を区別できるか、資格失効後の再確認が理解できるか、取消・戻る・中断で入力を保てるかです。
