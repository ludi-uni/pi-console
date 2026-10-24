# Dots AgentSession isolated verification result

## Result

実SDK 1.0.2 AgentSessionを固定応答・認証不要のin-process providerで駆動し、**通常sdk-worker producer → RuntimeManager.promptの受付ACK → SDKの自然な保存/settled → journal → 同じfinal-owner composition → read adapter → 既存pin binary** の経路を確認した。新規縦断test 1 PASS（正常一件・保存前・中断・解除のassertions）、影響回帰23 PASS、型検査exit0。製品ソース変更0、default OFF不変更。

実Dotsサービス・外部model/provider・モデル品質は未試験。本番許可ではない。同一SID管理資源の権限境界リスクは未解消。

## Evidence

`docs/dots-agent-session-proof-3.json`:

- real SDK AgentSession constructorのinstance確認。通常 `package/sdk-worker.mjs` をそのままimportし、既存テスト用worker seamを使用。
- 実 `RuntimeManager.create()/prompt()` でsession生成、Console run ID付与、SDK preflight応答、Console ACK更新を実行。test内にpreparePrompt/accepted/ingest/appendMessage/evidence.finishの手入力なし（onRecord観測は既存handlerへ原recordをそのまま転送するだけ）。
- SDK生成JSONLのassistant stopReason=stop、provider=fixed-local、本文をreadback。journal storage=saved、deliveryConfirmed=true、foregroundStatus=completed、本文一致。owner session inventoryが同一run一件を選択できることを確認。
- dummyの独立owner review/save後、実binary catalogからexact targetを発見。tools/call 3回で82 UTF-8 bytes取得。SDK保存本文とclient結合本文のSHA256: `2ffbae286634cd1cb28551ff6a43c96ad106c17f1f52dcaa99b5ffdbd8b89ad4`。
- pin SHA256: `1946de55a038313a9b9b2458d05fe1719fa9cf1f20a94dd5f38fc26a98bfdd42`。既存pin helperを再利用、download/installなし。解除後の同target callはisError=true。
- 正常runのprovider stream待機中、ACKは確認済みでもjournalにsaved本文なし、owner候補なし、adapter拒否。release後は実AgentSession自身がmessage_end/保存/agent_settledを行う。これはstream終端前の保存前確認であり、message_endと同期JSONL書込の極短い間を外部HTTPで捕捉したという主張ではない。
- 2回目は未完streamを `RuntimeManager.stop()` のclear_queue/abortで中断。自然なSDK settled後もsaved finalなし、foreground completedではなく、対象候補なし・adapter拒否。自然なaborted messageがSDKへ保存されてもstop finalとして公開しない。
- provider requests=2、completed=1、aborted=1、wrongModel=0、blockedNetwork=0。新runのreadやpin取得でprovider追加呼出しなし。aggregate完了・OS idle・実モデル使用の一般保証へ拡張しない。

## Isolation

新規 `tests/helpers/real-final-sdk.mjs` はtest-only facade。実SDKのpublic services生成にModelRuntime/設定/固定modelを注入する。SDK 1.0.2のnative provider登録は `registerNativeProvider()` を使用する。AgentSession、prompt、preflight、persist、イベントは差し替えない。

- 専用Temp内workspace/agent/session/profile。親testと子worker環境をallowlist化し、HOME/USERPROFILE/APPDATA/LOCALAPPDATA/TEMP/TMP/PI_CODING_AGENT_DIR/SESSION_DIRを所有Tempへ指定。外部認証・MainのPI_SESSION・Console稼働設定を渡さない。
- SettingsManager.inMemory、compaction/retry停止、noTools=all、noContextFiles/noSkills/noPromptTemplates/noThemes/noExtensionsでdiscovery抑制。明示の既存Console safety extensionは使用。live plugin/接続変更なし。
- fixed in-process providerはauth resolveで空authを返し、API key/headersを受けたらassert失敗。外部HTTP providerではない。選択modelは固定し、別modelのModelRuntime dispatchをthrowで拒否。
- import前に子プロセス内fetch/HTTP/HTTPS/TCP/TLS/UDP APIを拒否するtest guardを配置し、PI_OFFLINE=1。OS/ACL/network設定変更やOS sandboxではない。ネットワーク要求が発生したらcounter更新＋失敗とし、fallbackしない。今回counter0。SDKのmodel-network refreshも無効。
- pinは従来通り専用profile・固定dummy control plane/read認証・dynamic literal loopbackのみ。31717/31718/31719未使用。実credential取得/生成/配布・実grantなし（test Tempのdummy CAS grantだけ）。

## Verification

実行はNodeのProcessStartInfo環境clear＋必要Windows env allowlist。明示SDK entry/pin pathを渡し、Mainのmodel設定は変更していない。

- focused: `node --import tsx --test --test-concurrency=1 tests/final-agent-session.test.ts`、最終proof-3、1 PASS。
- `tsc --noEmit` exit0。
- `sdk-worker.test.ts` 5、`final-answer.test.ts` 9、`final-owner.test.ts` 9 = 23 PASS。既存SDK smokeも実行されたことを結果数に反映した。回帰fixtureは既存のTemp設定・保存基盤を使用。先行65/2やowner実装の11/72を今回の新規数へ足していない。
- 初回fixtureはlegacy/native provider登録ABI取り違えでstartup拒否。実SDK宣言/実装を確認してtest-only registerNativeProviderへ修正。二回目はfixture HTTP Accept不足で406空bodyをJSON parseして失敗。既存adapterは変更せず必要Acceptを付け、三回目合格。失敗を製品不具合修正として扱わない。
- 前回result/contract/verification/acceptance-5を含む着手前306ファイルをSHA256保全し、終了時byte一致確認。初期stagedも変更なし。
- owned SDK worker、pin/control-plane/HTTP終了、dummy SDK保存/profile等の所有Temp削除をproofで確認。失敗試行もfinallyで終了/削除。

## Not executed

UI変更なしのためdesktop/mobile/browser/Baseline/build再試験はせず、acceptance-5の先行画像・証拠をそのまま保全。外部provider、実Dots account/connection、実grant/専用キー、通常bootstrap有効化、本番操作、OS境界/egress監査、Access owner対応、controlIsolationVerified変更、commit/push/公開は未実施。

今回の経路ではSDK保存からadapter/clientまで証拠切断なし。ただしresource/model servicesは隔離testの明示注入で、実ユーザー環境のprovider/settings/pluginsを通したことや本番配布動作を証明しない。残る実Dots接続・専用credentialの実運用供給・同一SID境界問題の扱いは別判断であり、この試験合格から実運用許可を推論しない。
