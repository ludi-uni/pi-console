# 別helperの復号前失敗：静的診断

**確定したのは「復号APIに達する前のhelper失敗」。正確な例外原因はログ不足で未確定。** 試験を再実行せず、既存の実行結果と、この会話の保存領域に残っていた実行command sourceだけを使った。Ludi Systematic Debuggingのうち再現・実機確認は今回の禁止範囲なので行っていない。

## 確定している証拠

- owner16184の同process往復は成功。Protect1回、Unprotect1回、326-byteの所有blob1個を作成した。
- child35752はexit1。親はchildのJSONをparseし、PIDとcounter形式の検査を通過してから `CHILD_READ_FAILED` を返している。総Unprotect1回は親の成功分だけなので、childのcounterは0だった。
- `child-original.source.txt:11` でcounterを1にし、`:12` でUnprotectする。したがって失敗区間は`:6` のassembly load、`:8` のfile検査、`:9` のread、`:10` のcipher hash検査まで。
- 親は通常の失敗結果を受信して終了しており、通信切断で暗号処理の成否が失われた状態ではない。既存の01:38:56 UTC観測では両PID不在、rootは空、vault directory/blobは不在。

元の実測値は [trial-evidence.json](trial-evidence.json)。現在の状態を再取得した記録ではなく、既存tool結果の保存である。

## 有力候補と未確定事項

child sourceの`:4`で `function H` を定義し、`:10`と`:13`で `H` を呼んでいる。Windows PowerShellの既定alias `h` はGet-Historyであり、大文字小文字を区別しないcommand解決でaliasがfunctionより優先される。この名前衝突は復号前のhash検査を失敗させる有力候補で、試験コード上の問題として修正案を用意する。

ただし、失敗したchild自身のalias表、例外型、HResult、失敗stageを保存していない。assembly loadやfile readなど、それより前の失敗を排除する証拠もない。したがって名前衝突を**今回の根因と確定したとは言わない**。追加helperやGet-Command/Get-Aliasによる実機確認も行っていない。

既存childはcatchで全例外を `CHILD_DUMMY_READ_FAILED` にまとめ、親はそれをさらに `CHILD_READ_FAILED` に丸めた。stderrも破棄した。終了済みprocessのメモリにしかなかった詳細は復元できない。DPAPIの別process復号権限が拒否された、Windows vaultが使えない、という結論はこの証拠から出せない。

## 最小の未実行修正案

[差分](minimal-change.unexecuted.patch) は次だけを変更する。

1. child hash functionと2呼出しを `Get-FixtureByteHash` に変更し、短いalias名を使わない。
2. childに固定stage、基底例外の型名・HResultを追加し、親の非秘密結果にも残す。例外本文・stack・環境・ciphertext/復号値は出さない。
3. 次回が別承認の場合に限る新しい所有rootをplaceholderにする。既存rootや元blobを復活させない。

環境・DPAPI scope・暗号化/復号回数・helper起動箇所・cleanup・retry動作は変更していない。追加の推測修正を重ねず、まず次回の固定stageで仮説を識別できるようにする。未実行sourceは `.txt` で保存し、実行用 `.ps1` や本番codeへ適用していない。

- [元のparent command](executed-command.source.txt) と [元child](child-original.source.txt)
- [提案parent](proposed-command.unexecuted.source.txt) と [提案child](child-proposed.unexecuted.source.txt)
- [文字列による静的確認](static-review.json)：Protect call site1、Unprotect call site3、helper起動箇所増分0。PowerShell parserや実機試験のPASSではない。

保存したsourceは親が実行したcommand templateそのもの。child内のpath/hash placeholderは当時runtimeで置換されており、置換後のEncodedCommand全体は保存されていない。ここから当時の実cipher hashや例外詳細を推測で補わない。

再試験を要する範囲は [次の一回の提案](retry-scope.ja.md) に分離した。今回はhelper追加0、Protect/Unprotect追加0、vault作成/読取/削除0、ネットワーク0。本番・実credential・他保管データ・pi-wardenに触れていない。
