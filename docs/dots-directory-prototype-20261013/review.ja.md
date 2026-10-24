# Scoped自己レビュー

対象は隔離prototypeのdomain adapter、画面状態、HTTP fixture、起動entryと独立試験。現行D sourceにはdiffを適用していない。Ludi Code Reviewに従い、契約・安全境界・concurrency・部分失敗・scope逸脱を確認した。独立agent／外部reviewerを使用したとは主張しない。

修正済みの必須項目：

- prototype-domain.tsのprivate claimがrequest object全体を渡していたため、既存strict DTO検査に拒否された。connectionId/proofだけに限定し、source契約を緩めずGREENを確認。
- Prototype.tsxの作成nonceがjournalとoperationで別だった。応答喪失後の照合を妨げるため同一requestIdへ統一。UIで応答喪失＋double click＋同じ結果照合、一回作成を確認。
- 有効scopeを別rootへ黙って置換する経路を拒否し、既存scopeの再利用／明示revoke後の再確認を独立試験した。
- directory target fingerprintからworkspace/session/generationを除外。登録やIDなしの要求を実際に通し、無関係なworkspace値で権限判定が変わらないことを確認。
- 背景取得を操作busyから分離し、superseded sequence・低revision・古い画面epochを破棄。instance変化は確認を失効させ、入力を保つ。警告領域の高さを固定し、background owner失効でもscrollを保持。

対応範囲のdummy運用を妨げる未修正の必須指摘はない。大きな検証限界：実Windows port/share mode/TOCTOU、実Git認識、実本人認証、実App/client、既存file read/write/rename/delete/processは未検証／未対応。directory一般操作の目標は未達。認証とprivate handoffはmockなので、fixtureをproduction APIとして使わない。本人UX受入はまだ行っていない。

UIのcompositionイベント保持を、実OS IMEの完全な受入とは言わない。長いmobile画面や説明の量は本人レビューで判断する任意のUX改善事項で、今回追加実装を広げない。
