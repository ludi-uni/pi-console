# 初回claim修正候補 — 実装・隔離dummy受入完了、未適用

対象はpi-consoleだけ。候補は `C:\Users\leade\AppData\Local\Temp\pi-console-initial-claim-fix-20261020-f2a8\candidate` に保存した。稼働D source/distには適用していない。今回保全したpublic source 138ファイルは全て開始時と同一SHA-256であり、既存未コミット変更を維持している。pi-wardenは調査・変更・試験していない。

## 実装

1. `server/folder-mcp.ts`: continuation初回claimは、正しい初回proof、connected/openな現在runtime、元の固定申請期限内、有効grant、continuation epoch/handoffがある場合、短期access切れだけでprivate handoffを拒否しない。操作tokenのlive検証は変更していない。legacy非continuationは従来通り。復元runtimeはpendingUntil=0なので初回申請を復活できない。
2. `server/local-mcp-composition.mjs`: 保護family読取をawaitした後、手渡し直前に同じclaim条件を再検証する。読取中に元の60分期限を跨ぐ競合を新しく再現し、拒否するようにした。
3. `package/local-resume-session.mjs`: 初回継続材料を保護stateへ保存した後、既存reconnect/resume/renewを通す。有効な短期資格を得た後にconnectedを返す。更新requestIdの保護保存と既存receipt照合を再利用する。

公開tool・state schema・親/操作scope・本人確認・5分access・7日grant・revoke契約は変更していない。新しいcredential生成方式や別grantも追加していない。

## 検証

- 修正前の遅延初回claim回帰: **0/1 pass**。短期5分後の初回getがgeneric拒否となった。
- 最小2ファイル修正後: **1/1 pass**。
- await中に元の60分申請期限を跨ぐ追加回帰: **26/27 pass**、想定通り「拒否されない」ことでRED。
- compositionに手渡し直前再検証を追加後: **27/27 pass**。
- 選定済み既存local-resume 79件 + 新規27件の最終受入: **106/106 pass、失敗0**。`acceptance-final.tap`。
- 変更したmjs 2ファイルのNode構文検査成功。型/署名/import/schemaを変えない局所制御変更なので全体typecheck/buildは選定せず、影響TSはtsx経由の回帰で実行した。通常npm testはOS/native項目を含むため未実行。

追加27件は、5分直前/正確な境界/直後、60分直前/正確な境界、await中の期限跨ぎ、grant失効、wrong proof/client、SID/installation/owner変更、broker generation不一致、parent差替え、revoke競合、二重get、初回/renew応答喪失、保存commit前後の不確実性、client再起動、取消、複数client、scope外path/本文・Pi tool拒否、server復元時の初回proof拒否、legacy成功経路を扱う。親と4操作と7日期限は変わらず、期限切れtokenではRPCが通らないことも確認した。

全て公開固定dummyベクトル・memory backend・fake provider。既存HTTP回帰だけ所有するliteral127.0.0.1の一時fixtureを使用した。最終fixture PID 32416、port 50757、`allClosed:true`、Node試験runner終了確認済み。OS暗号呼出0、native試験0。初回sandbox実行はloopback接続EACCESで104/105となったが、同じ所有dummy fixtureだけを許可する実行で解消し、最終106件成功した。実ConsoleへのHTTP/API呼出はない。

## レビューと限界

認証・所有・期限・競合・scope・秘密露出の自己レビューを実施し、残る必須指摘なし。期限跨ぎはレビューで見つけ、RED/GREEN証拠を追加して修正した。

connectedは応答生成時点の状態であり、直後のrevokeや時間経過を固定する保証ではない。renew応答後にrevokeが競合しても、実操作は現在のgrant/token条件で拒否され、後続getから復活しない。秘密はprivate handoff/保護stateの内側に留まり、公開MCP結果はmetadataのみ。

今回再現・修正したのはsource上の初回bootstrap不具合。保存済み実失敗の正確な内側error code/実承認時刻/短期資格期限が欠けるため、過去の実失敗原因がこれだけだったと確定していない。実DPAPI・native provider・実client・実データ操作の受入は行っていない。

## 適用と実運用操作

`candidate.patch` は実装3ファイルと新規回帰1ファイル。`candidate-manifest.json` に適用前/候補SHA-256、`preservation.json` にD source照合を保存した。候補ZIPも同梱する。適用する際はまず元source SHAが一致することを確認する。試験再現には上記Tempルートのrun-tests.mjsを使う（docs内の同名ファイルは証拠コピー）。その対象は隔離workとDの既存tsx loaderである。patchの適用可否は別の隔離baseline copyに対してgit apply --checkで確認している。

**実source適用・dist配布・stop/restart・実資格の生成/保護保存/配布・実grant変更・実client再接続・実フォルダ/repo/workspace作成は全て0回。** 本番適用と実受入は別途明示承認が必要。再起動でbroker generationが変わるので、現在のfcf接続を元の初回申請のまま再起動越しに救済できるとは約束しない。今回は追加ログイン/再申請/承認も求めていない。

UI変更なし。画像0枚、人に依頼した操作0回。キーをURL/argv/log/公開endpoint/チャットへ載せる処理は追加していない。commit/push/publishなし。
