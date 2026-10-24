# 実接続アダプタの準備資料（未適用）

独立Tempコピーで、承認済み継続許可の短命資格を更新するbridge・private loopback handler・companion内部clientを実装した。7日/31日/明示noneのowner/client/対象/操作/期間を更新しない。通常更新に再承認や画面再読込を要求しない。constructorは接続・listener・発行・保存を開始しない。実providerがないデフォルト状態はunavailable。

本番daemon/source/dist/config/権限/credentials/security設定は変更していない。実grant/token発行・配置・実接続・配備・commit/pushをしていない。pi-wardenには触れていない。

## レビュー順

1. `connection-checklist.ja.md` で実接続前に必要な対象・操作・権限・秘密設定と未確認項目を確認する。実値や秘密をチャットへ貼らない。
2. `integration-gaps.ja.md` で現行13ファイルとの違いと不足portを確認する。
3. `continuation.ts` / `broker-http.ts` / `continuation-client.mjs` とテストを読む。sourceはZIP内、baselineは現行比較用。
4. 自分の新しいTempへZIPを展開した場合だけ、次のfixtureを実行できる。通常のnpm test/build/startを実行しない。実server/SDK/nativeをimportしない。

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\run-core.mjs' review-core
& 'C:\Program Files\nodejs\node.exe' '.\run-client.mjs' review-client
& 'C:\Program Files\nodejs\node.exe' '.\run-http.mjs'
```

tsxと型検査にはこのPCの既存D node_modulesだけを利用する。HTTP fixtureは新しいliteral127.0.0.1の一時portとfake providersだけ。各fixtureのpid/port/終了を `http-fixtures.jsonl` に記録する。新しい本番endpointを登録しない。実資格を生成/保存するproviderも同梱しない。

この新bridgeは標準HTTP MCP OAuthサーバーでも、installed Dots/nativeとの実接続成功でもない。`console-local-continuation-v1` の能力を確認する契約が必要で、既存のdiscovery version1と同一視しない。実Dots refresh、保護vault、stable client/restart proof、現行runtimeの原子的rotationは未確認/未接続。正常更新のfixture成功と実接続PASSを区別する。

UIを今回は変更していない。前回の一画面UXを維持する内部adapterの準備で、画像・browser操作は0件。directory全般の実file操作は未達のまま。
