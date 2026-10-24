# 巻戻し・実runtime再開契約の限定監査

実source/実store/実key/grant/OS暗号/daemonを変更せず、前段階の46試験の限界を確認した。新しい再開判定はmock facts専用であり、接続readyは常にfalse。

## 得られた証拠
- **旧正常blobの復元でfixtureのrevokeが巻戻った。** schema/checksum/binding、同じblob内のepoch/clock/fenceだけでは不足。
- **copied runtimeの新keyが、epoch保存前のawait区間に通った。** 保存はepoch1・prepared、runtimeはepoch2。例外後は解除できるが、process crashや新規admissionの原子性を証明しない。
- approvalはmemory Mapで再起動復元されず、保存bindingとapproval bindingのmapperもない。senderは固定proof/fake検証であり実attestationではない。
- DのFolderMcpにはfixtureの再開用4メソッドがない。read-only source audit6ファイルのsha/lineを記録した。

## 今回追加したもの
restart-contract.tsはanchor missing/unknown、head digest/sequence/binding不一致、revoked/prepared、expiry/clock、approval/peer/runtime不明を拒否するmock契約。headとanchorを両方巻戻した場合に検出できないnegative controlも含む。実anchorは実装・選定していない。

選択60試験＝前段階46＋今回14（再開判定9・negative control等5）。合格は「不足と拒否条件を再現した」意味であり、実rollback耐性の完成ではない。限定型検査は17inputs/noEmit。最終の件数・fixture/process終了はresult.json参照。UI操作/画像0、HTTP/OS crypto/実credential操作0。

## 次に必要な判断
threat-model.ja.mdに脅威モデルとfail closed条件、runtime-contract-delta.ja.mdに不足実装と担当、owner-next-steps.ja.mdに本人操作の範囲を保存した。独立anchorなしなら再起動後は本人再確認のfallback、自動復元を求めるなら独立anchorの契約が必要。どちらもキー3本を人に作らせない。

Codex側には実runtime admission、approval保存/binding対応、sender continuity、vault adapter等の実装残がある。本人の承認だけでそれらが完成するとは扱わない。新たなOS試験・実反映は求めず、ここで止める。

## 再現
所有TempへZIP展開し、既存D node_modulesのtsx/TypeScriptを使用する。全test/native/SDKを起動しない。

    node run-selected.mjs reviewer provider-contract.test.ts provider-integration.test.ts file-provider.test.ts file-integration.test.ts restart-contract.test.ts runtime-delta.test.ts
    node check-restart-types.mjs

labelは未使用名を指定。helperは公開dummy file試験の普通のNodeだけ。実sourceは未適用、pi-wardenは調査・変更・再試験していない。
