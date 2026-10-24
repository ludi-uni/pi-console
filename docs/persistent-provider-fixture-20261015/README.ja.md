# 保存provider: 隔離dummy実装・未適用

D:\Develop\pi-console のsource315ファイル・tracked dirty15ファイルを新たに保全し、旧provider seal1,216ファイルと一致確認。HEAD 23815ba260320e3fc720ad3288ca89728f99b4f7 / 0.5.2。稼働source/dist/Startup/設定は変更していない。

実装はこのZIP内の file-fixture-store.ts と provider-skeleton.ts のfixture差分。owner/client/resource/scope/generation、key receipt、epoch、使用済hash、revoke、clockFloor、writer fenceを単一dummy envelopeに保存する。wx排他lock下のCAS、write/fsync/rename、読戻し、保存結果不明時のfail closedを、既存のcopied Folder/renewal fixtureへ接続した。writer IDのUUIDは公開の非秘密fence識別子でありcredential生成ではない。

## 確認結果
- 選択した46試験が成功（既存26+新規20）。別Node読戻し、2 Node同時CAS、期限・scope/ownerbinding、replay/revoke、pre-rename失敗、rename後応答喪失、pending所有競合、公開値以外拒否を含む。
- strictな限定型検査14inputs、診断0、noEmit。最初のREDは未実装module、途中の競合失敗と型診断も記録を保持。
- UI変更・操作0、画像0、HTTP listener0、Pi/SDK/native entry0、実credential/grant操作0。UIの前段階の画面確認とは別受入。
- 成功済DPAPI受入を dpapi-reused-evidence.json に転記して再利用。今回OS crypto API実行0。file codecは可逆mockで暗号ではない。

## 再現手順
ZIPを新しい所有Temp directoryへ展開。既存 D:\Develop\pi-console\node_modules のtsx/TypeScriptを用いる。インストール・全test・OS専用test・本番buildは実行しない。

    node run-selected.mjs reviewer provider-contract.test.ts provider-integration.test.ts file-provider.test.ts file-integration.test.ts
    node check-types.mjs

実行labelは未使用名を使う。node pathは実環境の C:\Program Files\nodejs\node.exe。Node helperは公開dummy directory名とrevisionだけをargvへ受け取り、鍵値は渡さない。file-fixtures下は各fixtureがowner記録と生成/削除eventを保存し、既知fileだけを削除。lockが残った場合は自動奪取せず拒否する。

## 適用できない理由
realConnectionReady=false。mock codec、保護された外部rollback anchor、Windows crash/power-lossとnative reparse安全性、実vault adapter、approval/runtime/client全体の再開契約が未解決。このZIPを実用providerとして配布/適用してはならない。別Node試験はkey/epoch読戻しであり、実daemon再開ではない。

詳細は plan.ja.md、review.ja.md、required-approvals.ja.md、最終試験/所有記録を参照。pi-wardenへの読取・変更・試験は行っていない。
