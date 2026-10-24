# 期限拡張のdummy受入結果

2026-10-14。新しいTemp試作のみ。操作許可の1週間（7日）、1か月（31日）、明示した期限なしをUI・policy guard・strict保存形式に実装した。有限の接続資格と転送期限は別に扱い、480分でoperation grantを切り詰めない。本人によるこの新版のUX受入は未実施。

| 検証 | 結果 |
| --- | --- |
| 純粋・fake provider受入 | 83/83成功（既存domain53、expiry15、lifecycle10、view-state5） |
| 型検査 | 29入力、diagnostics 0、noEmit |
| 既存画面 | 9/9成功、95操作、21画像、pageErrors 0 |
| 追加期限画面・修正後 | 5/5成功、53操作、8画像、pageErrors 0 |
| 表示観察 | narrow 390とdesktop 1280、期限なし確認・31日への変更・再起動後の入力保持を画像で確認 |
| preview entry | 自己確認exit 0、HTTP/provider終了await済み |
| fixture | HTTP 25個全終了、store fixture 4個全終了・除去、browser終了await済み |
| 保全 | 旧試作413、旧archive725、D source315のhash一致、旧docs・git変更を維持 |

初回UI実行は14件中13成功で、同一案内文2個によるstrict locator失敗だった。locatorを修正して追加5件を再実行した。その画像から、本人再確認後も古い案内が残る問題を修正し、追加5件、純粋83件、型検査を最終再実行した。既存9件は先行実行の証拠を保持し、全14件を同時に最終再実行したとは記載しない。65秒・28状態取得中のIME/選択/focus/scroll保持、応答喪失と二重実行防止の既存受入も保持する。

追加受入は、期限なし追加確認、8時間経過後のoperation grant維持と資格失効、同一scope明示再確認、7日から31日への明示変更、下書き編集・取消時に期限不変、save/load、有限旧schema移行、null拒否、解除保存、clock rollback非復活、再起動と新sessionへの非転用、遅延状態取得中の入力保持、31日期限境界を扱う。

実credential生成/保存/配布、実grant、実MCP/client/Pi/SDK、実repo、OS/native試験、本番stop/restart、source/dist適用、commit/push/publishは全て0。pi-wardenには触れていない。

directory全般操作の目標は未達。今回もmetadata、新規directory、固定空repo構造のmemory操作だけ。既存file本文操作・rename/delete・任意processは未対応。この試作は実owner/client認証や本番engineの永続期限対応を代替しない。無期限操作許可の実運用有効化と本番反映は今回実施していない。
