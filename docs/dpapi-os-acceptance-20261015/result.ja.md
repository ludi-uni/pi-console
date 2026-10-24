# 限定OS公開ダミー受入結果

2026-10-15 23:10 UTC、本人承認済みの固定入口を1回だけ実行し成功。harness内所要4,330ms、supervisor終了code 0、自動再試験0。

入口: C:\Users\leade\AppData\Local\Temp\pi-console-dpapi-harness-prep-20261015-a275b2e1\acceptance.mjs

入口SHA256: 57d946d051df25855872a792484e638f0d3fb243115208c7e61788398e256f6e

Plan hash: eb4a93d9ad4c6672186ae0d6db57aa4aa374ab8a9471985cc2562d95f72d4c3f

実行前に入口/plan/core6件と準備seal32件の一致を確認。変更や再作成をせず、その入口を実行した。

Protect1、Unprotect3、Node2（supervisor/reader）、PowerShell helper4。各helper10秒/全体60秒の上限内。公開payload・公開fixture entropyのみをprivate pipeで渡した。同process読戻し、別Nodeでの読戻し、改変ciphertext拒否の3条件を確認した。

所有Temp: C:\Users\leade\AppData\Local\Temp\pi-console-local-resume-os-dummy-dZCeHe

head.dpapi / tampered.dpapi は各326 bytes、既知identityを確認して削除し、空rootを削除。後続確認でもroot不存在。追加datafile、再帰削除、timeout、強制停止なし。

PID: supervisor 17744、reader 25652、PS 28572 / 21448 / 35624 / 3336。全child closeを記録し、呼出し元がsupervisor終了を確認。後続のPID限定照会で6件すべて不存在を確認した。command lineや全processの列挙はしていない。

保全: D source315件、tracked dirty15件、旧seal911件と準備seal32件、既存delivery38件のhash一致。無関係git status不変。新規docsへの証拠保存のみで、実資格、profile、issuer、grant、MCP/client、daemon、保存先設定、稼働source/distは未変更。画像0枚、UI操作0回。

これはCurrentUser DPAPI helperと限定harnessの公開ダミー受入であり、local store全体のOS試験や本番連携の完了を意味しない。実資格生成・本番適用の承認には流用しない。
