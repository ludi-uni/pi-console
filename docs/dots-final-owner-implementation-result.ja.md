# Dots final owner implementation result

## Result

**既定OFFのソース実装とlocal dummy隔離受入が完了。** WorkspacePermissions内の独立final-only UI → 同一CAS保存 → 通常serverと共通のcomposition → pin実binaryによる本文取得/hash一致 → 解除後拒否まで確認した。報告本文の人による貼付はfixture経路では不要。実Dotsサービスは未接続、通常bootstrapは `enabled:false`・専用credential未設定、本番未配布/未適用。

## Evidence

- 最新縦断: `docs/verification/final-owner/acceptance-5/proof.json`。catalogのinputSchema constから許可targetを取得し、実binary `tools/call` 5回で154 UTF-8 bytesを結合。hash `4a858c534b7a75780d63089d46372263e9cf6f0c786e244e6804b09465ade5ae` が保存元・公開本文・client側で一致。解除後の実binary callはisError=true。
- binary SHA256 `1946de55a038313a9b9b2458d05fe1719fa9cf1f20a94dd5f38fc26a98bfdd42` を照合。version情報は同hashの先行確認済み `0.0.15+a390c168ff1b2d14e73a95991c186c6aba3ff5a0`。今回helperでversion commandを再実行したという主張ではない。
- SDK 1.0.2 public SessionManagerのdummy保存、共有evidence collector、composition自身が作るRuntimeManagerのattach/onRecord/journal経路を使用。dummy lifecycle/ACK入力であり、実SDK AgentSession/provider応答ではない。専用Temp・allowlist環境・dummy認証/profile/control plane・dynamic loopbackのみ。
- desktop 1280×900 / mobile 390×844、review/取消/保存、応答喪失の結果照合、保存中section離脱、restart後のreview拒否を確認。mobileでCAS競合、過去期限review、公開期限切れ、実rename失敗による保存拒否・poisonも確認。
- 画像 `acceptance-5/review-{1280,390}.png` と `revoked-{1280,390}.png` をreadで現物確認。対象/データ/keyholders/期限/共有・同一SID警告、確認checkbox、無許可状態を確認。英語UIを検証、日本語文言もsourceに実装。Safari/Firefox/実mobile端末は未検証。
- **新規11 unique PASS**（unit9＋UI縦断1＋UI edge1）。影響回帰72 PASSは別枠（結果read/最終read/既存permission/native36、execution/history/receipt/scope/SDK/queue/既存permission UI36）。先行65 PASS・characterization2 PASSを新規成果に足していない。繰り返し実行も水増ししない。
- `tsc --noEmit` exit0。別出力Vite build 313 modules/1.45秒で成功。出力 `C:\Users\leade\AppData\Local\Temp\dots-final-owner-build-P8c8co\dist`、既存dist書込なし。従来500 KiB超warningは残る。
- readによるworker/prompt/queue/provider/外部Events開始0。fixture UI/metadataに秘密・prompt/raw本文・epoch表示なし。既知final/status/control secret除外を単体確認。同じkeyの異なるclientInfoは同principalとして読める。誤key/旧status key/旧key・旧scope/別target/expiry/generation/epoch/dispose/未構成/Access不明を拒否。
- 所有binary/browser/HTTP/Vite fixturesは終了し、dummyデータ/profile/SessionManager保存Tempは削除済み。OS-wide egress監査をしたという主張はない。ビルド出力は別出力artifactとして保持。

## Implementation

`server/final-owner-composition.ts` / `shared/final-owner.ts` / `web/FinalOwner.tsx` を追加。既存store/schema/core/MCP/通常server/UIへ小さく結線し、credential loader・registry・broker・OS隔離・他の公開機能は追加していない。詳細契約: `docs/dots-final-owner-implementation-contract.ja.md`。今回着手時点baselineとの差分: `docs/dots-final-owner-implementation-diff.patch`。

保存単位は既存WorkspacePermissionsのversion 2 atomic snapshot。exact run一件、final_answer、absolute expiry、activation UUID epochとbounded保存結果を同じCAS/lockに置く。旧version 1はfinalなしで読み、自動書込なし。base permission編集はfinal追加公開をclear。保存要求の照合はcommit結果を見るだけ。保存中離脱はundoでなく、セッション保存されたrequest UUIDから再読取する。

通常bootstrapの同じfactoryからproducer/journal/adapterを作り、明示offならproducerなし。Access有効/不明・専用認証不明はblocked、旧key/keylessへfallbackしない。owner APIのpublic/Access gate順序・native管理条件は維持。controlIsolationVerified=false・制御/更新拒否は不変更。

## Corrections

隔離再試験で以下を修正した。初期失敗を成功に書き換えず、acceptance-1～4の途中画像は残した。最終証拠はacceptance-5。

- 初期UIのpassive session read同士が同じpermission lockで競合。session/result readだけ最大3回のbounded retry、保存等の自動再送なし。
- pin startupが共通protected-resource metadataで旧readonly handlerの401を受けた。method/path/statusのみのfixture traceで確認し、明示final modeではそのmetadata absence aliasをfinal auth handlerが先に担当する順序に修正。旧namespaced readonly endpointは独立し、credential/native gateを緩和しない。
- checkboxの表示を既存permission-choice styleへ合わせ、再画像確認。
- 並列Vite fixtureの24678競合warningと、UI assertion直後のfixture snapshot lock競合。UI edge観測はbounded read、以後の回帰はtest-concurrency=1。実保存・CASのretryにはしていない。
- React ref/fixture型annotationの型検査エラーを修正。最後の型検査成功を記録。

## Owner operation

**隔離fixture/将来別承認された有効構成での手順**（稼働環境ではまだ無効）:

1. 「設定 → Dots ワークスペース権限 → 最終回答textの追加公開」。既存read checkboxとは別の欄。
2. base許可内の観測済みexact run一件と絶対期限を選択（最大24時間）。未観測/ACK不明等は候補なし。
3. 「最終回答公開をレビュー」で対象、データ=保存確認済みforeground最終textのみ、宛先=専用read-key holders、期限、解除される旧範囲、共有/本人非限定の警告を確認。
4. 確認checkbox後「レビュー済みfinal範囲を保存」。応答喪失/離脱時は「公開状態 / 保存結果を再読取」。自動再送しない。
5. 解除は「最終回答公開の解除をレビュー」から確認・保存。送信済みbytesの回収はしない。キー自体を失効させたとは表示しない。

今の通常serverは機能無効表示となる。ユーザーに実キー/URL/callback/報告本文入力は求めない。

## Remaining boundary

実Dots側のcatalog/tool自動利用と本文表示、既存接続への専用credential供給、実grant/配布反映は未接続・別承認。実運用前の本人判断は **exactrun / 公開最終text / 宛先=keyholders（共有先も同権限） / 絶対expiryと解除 / 配布反映**。専用キーの実設定・配布は今回していない。

local入口はOS本人認証ではない。同一SIDのworker/owner管理資源変更リスクは未解消で、実運用は保留。Access owner対応もblockedのまま。保存失敗時のtombstone診断・request結果64件capacityの扱い、journalの旧generation/restart hydrationは自動化していない。不確定な許可を復活させない。

着手前257ファイル中250はbyte一致、7だけ許可変更。7件の着手前bytesは `dots-final-owner-implementation-originals.json` にgzip-base64で保全し、全件decompress→SHA256一致確認。diffのWindows逆適用はCRLF変換/混在によりbyte照合不一致だったため、patchだけから元bytes復元できるとは扱わない。元bytesの保全を正とする。reverse検査は所有Temp内のみで、worktreeへの逆適用/resetなし。baseline/reverse-check/今回の既存UI regression画像Tempは削除済み。staged=[]。

先行報告・design・65/2証拠を保全。実履歴/data/秘密を取得せず、実permission/credential/plugin/接続、production stop/restart/install/deploy、ACL/OS/account/network、Events、commit/push/npm公開を行っていない。新subagentなし、モデルはopenai-codex/gpt-6.1-sol。
