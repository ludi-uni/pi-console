# DPAPI事前照合失敗の原因とv2未実行案

**原因は、こちらが未実行案を保存した時のJavaScript文字列置換の実装不備。事前照合は正しく拒否していた。** 後から資料が変更されたと判断する根拠はなく、現在のv1ファイルの内容は当時の不適切な生成処理で完全再現できた。

## 具体的な相違

v1 childの24行目で、意図した正規表現末尾は次だった。

```text
$r.errorType=if($t -match '^[A-Za-z0-9_.]{1,160}$'){$t}else{'UnexpectedExceptionType'}
```

しかし保存ファイルでは `$'` の位置から、元helperの後半 `if($p){[Array]::Clear...}`、JSON出力、exit判定が入り込み、30行になっていた。正しいv2/期待文字列は28行。破損はchild・埋込みparentとも169 bytes分だった。

生成器が `child.replace(before, replacement)` と置換文字列をそのまま渡していたため、JavaScriptが `$'` を「matchより後の元文字列」に展開した。PowerShellの正規表現に含まれる文字を、意図せずJavaScript置換記法として処理してしまった。

同じ不備を含む生成処理から、保存済みv1 childとparentの**両方の内容が完全一致で再現**した。期待文字列を手入力し直して照合を緩める必要はない。

## 最小修正

[生成処理の未実行修正](authoring-fix.unexecuted.txt)は、置換内容をliteralで返すcallbackにするだけ。

```text
child = child.replace(before, () => replacement);
parent = original.replace(originalChild, () => fixedChild);
```

child生成とparentへの埋込みの**両方**に適用する。片方だけ直すと、残った置換で `$'` が再び展開され得る。今回、修正済みのchild/parentを新しいv2資料として保存し、loaderの参照先だけをv2へ変えた。[最小差分](minimal-repair.unexecuted.patch)

暗号処理・CurrentUser scope・公開dummy・helper/API回数・cleanupは追加変更していない。新しいhelperは起動せず、ファイルをプログラムとしてinvokeしていない。

## hash・版の対応

| 版 / file | bytes | SHA-256 |
| --- | ---: | --- |
| 元の実行parent | 9950 | `e4c69c7e3081e392c27d58baffcbe84c63a1267d8670f978c0b0b5f58a783c97` |
| 元の実行child | 1165 | `da34b0d5aa43c0ea255657247fbea036026c028d394093278a724a85a56f4e9e` |
| v1 壊れた提案child | 1849 | `a733b63c954007d626ea2b38d74f857b7a8ae4972911447e9aba8cd49b8a4281` |
| v2 修正child | 1680 | `cd7dc7872af9fb7b2f685e9f30fe4be08f20eb11b693aa21951e6126ba2061a3` |
| v1 壊れた提案parent | 10817 | `d601d643ff782fb54f7728b209e8f529d08d2692f9f37d86ce5d87a358e0a087` |
| v2 修正parent | 10648 | `a12667eba66d24d0a0c8c22c347f7c02a0189f862698651fc4a45c525e7d6719` |
| v1 事前照合loaderのsource保存 | 4504 | `b0bafb5ae101abd5ed2cfa0e1ca9a2336b8ff02933b8e251b8008e2de3cba087` |
| v2 事前照合loader | 4512 | `e9a50ec00ed6d5dc9dc61654e8c21cf26b56f309267ec00d9d40cd9575c2e81d` |

元の実行templateとloaderは会話内に保持された文字列から保存したsource snapshot。snapshot fileは末尾LFを一つ持つ。実行当時のEncodedCommandでruntime置換されたcipher hashを復元したものではない。既存v1ファイルは上書きしていない。

## 実行しない確認で得た証拠

[静的確認](static-preflight-verification.json)で、実際のファイルを読取り、loaderと同じCRLF/LF・末尾改行の正規化および.NETのliteral String.Replaceによる比較を行った。

- v2 childとloader内の期待文字列：一致。
- v2 parentと期待生成結果：一致。
- 診断環境の `Parser.ParseInput` のみ：v1 childは構文エラー4件、v2 child・parent・loaderは各0件。
- v2 parentの文字列上のcall site：Protect1、Unprotect3、child Start1。実際には呼んでいない。

構文parseはsourceを実行しない。Windows PowerShell子processを立ち上げて検証した結果でもない。特に、親がparseできるだけではhere-string中のchild構文は保証されないので、child自体も別にparseした。

文字列置換の再現とhash/版の全記録は [対応表JSON](version-hash-correspondence.json)。今回の事前照合失敗はこの証拠で原因確定。一方、最初のDPAPI実試験でH/alias衝突が起きたかは例外詳細が不足しており、歴史的原因の未確定という扱いを維持する。

## 次回に使う最小の未実行案

対象は [v2 loader](preflight-loader.v2.unexecuted.source.txt)、[v2 parent](proposed-command.v2.unexecuted.source.txt)、[v2 child](child-proposed.v2.unexecuted.source.txt)。次に実試験が許可される場合は、このhashに一致するv2を参照し、今回通過を確認した事前照合を同じhelper process内で通してから、新規所有rootで一回だけ実施する。rootのplaceholderを新しい非秘密run IDに置き換える。

sourceの保存内容による事前照合拒否は解消を確認したが、OS/権限/DPAPI実行時の成功まで保証したものではない。次の実受入も最大10分・helper2・Protect1/Unprotect3・blob2各64KiB、失敗時停止・所有物cleanupを維持する。承認済み回数を自動でリセットせず、今回はその試験を開始していない。

今回は通常の資料ファイル読取、checksum、文字列比較、構文parseと資料保存のみ。試験helper起動0、Protect/Unprotect0、blob作成/読取/削除0、ネットワーク0、実credential・本番code/config変更0。既存v1資料・ユーザー編集を上書きしていない。
