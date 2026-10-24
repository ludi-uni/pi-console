# 外部MCP共通gate・別隔離パッケージ契約

## Scope

Console側の準備のみ。OS隔離・実隔離setup・昇格・実credential・本番接続は実装/実行していない。既存回帰で実行してしまったTemp dummy key setup/ACL操作の逸脱は結果報告を参照。Pi内部のMCP client/toolは対象外。通常のローカルConsole経路は維持し、隔離済みと表示しない。別パッケージの実bindingは未接続であり、通常bootstrapはadapterなしの `adapter_unavailable`。依存名やインストール検査を捏造しない。

## Gate

`ExternalMcpGate` は起動時OFF、readyを保存しない。本人管理者が初回setupを承認したことを**別パッケージが保護されたreceiptから検証**し、installation/policy世代と一致すること、および現在のOS検証がinstallation/instance/policy世代に一致することを要求する。Consoleのcheckboxは外部公開への同意にすぎず、setup承認や本人認証・OS検証の代わりではない。

必須検証面: administrator-only setup、低権限worker、restricted launch/stop、管理store/API保護、管理/owner/read secret非継承、子孫保護、別runner保護。どれか未検証・失敗・不明なら拒否。Consoleを管理者として起動するだけでは満たせない。

`inspect(binding, AbortSignal)` は毎回の有効化・再検査・新規外部要求・restricted connection開始で実検証を実行する。2秒で結果が出なければunknown、遅い成功は採用しない。checkedAtは5秒以内、leaseは最大60秒。clock後退/期限切れも無効化する。enableは現在revisionに対する明示CAS操作。再検査はOFFへ戻し、成功しても自動enableしない。receipt変更も再確認を要求する。

失効callback・disable・期限切れ・restartは新規外部MCP/admissionを拒否し、古いticketを無効化する。失効だけでは既存worker/子孫をkillせず、scopeを保存・解除・再grantしない。再enableもscope付与ではない。既存scope/key/expiry/最終回答のsaved+ACK+completed条件は独立に必要。

## Surface matrix

| 面 | 共通gate | 既存条件 / 残す制限 |
|---|---|---|
| `/mcp/readonly` initialize/list/call、固定read scope | 新規受付＋応答公開直前 | 専用認証、scope、native/proxy条件、既存read実装を維持 |
| `/mcp/dots` legacy status/progress | 同上 | 既存read認証・workspace scope・owner permissionを維持 |
| `/mcp/dots` control系 | 同上＋RuntimeManager admission/dispatch fence | dedicated control key、scope、expiry、receipt/CAS、`controlIsolationVerified()` は依然false |
| `/mcp/dots` final-only composition | 同上 | final opt-in、専用keyholder認証、exact target、独立grant/expiry、journal/既存release fence、Access拒否を維持 |
| `/.well-known/oauth-protected-resource` とnamespaced alias | 同上 | 従来の認証とmetadata不在応答を維持 |
| `/mcp`、`/mcp/*` の旧/未知endpoint・mode・method | 全て共通mountで終端 | OFF時503、ready fixtureでも未実装経路404。通常Console/APIへfallbackしない |
| 新規restricted connection `.start()` | 毎回inspect＋launch直前＋結果引渡し直前 | plain `spawn`/owner-worker fallbackなし |
| ローカル `/api/external-mcp/{status,recheck,enable,disable}` | 診断・明示操作のみ | 通常Host/Origin/Access gateの後、既存 `permissionOwnerRequest()`。POST JSON、strict fields、revision CAS。setup/receipt/checks/ready入力を受理しない |
| 既存owner grant API、通常ローカルUI/API | 独立したローカル経路 | 既存owner/Access条件を維持。これらの成功は外部MCP許可や隔離認定ではない |

共通HTTP mountは各adapterの既存guard/permission/release fenceを削除せず追加する。非stream応答を最大2MiBまでbufferし、送信直前にticketを再検査、失効時は本文/元headerを捨て503を返す。今後streaming transportを追加するならchunkごとの専用fenceが必要であり、現buffer経路に無条件追加しない。OFF時は既存adapterを実行せず拒否する。

## Adapter

`server/isolation-adapter.ts` はAPI契約だけ。trusted bootstrapで監査済みcode-bound adapterを供給する将来の接続点であり、env/config/header/bodyや任意module pathから発見・importしない。`server/index.ts` は実adapterを供給しない。test-only readyは `tests/helpers/isolation-adapter.fixture.ts` に限定し、production importなし。

別パッケージが負う責任:
- 本人管理者setup、receipt真正性/取消/世代、OS subject/token・ACL・code/store・全Console管理API・ネットワーク保護を実検証する。保存booleanでは不可。
- SDK/extension load**前**から低権限実行域へ入れ、子孫/local MCP/background/別runnerを含める。server側KIT runnerも対象。JS hooks/QuickJS/JobだけをOS sandboxと呼ばない。
- 管理secretのenv/file/handle非継承を保証する。必要なworker用provider authがworker自身から見える問題とは分ける。
- 不明になった時点で `onInvalidated` を通知し、launchの同一policy/instance/receiptとOS境界を原子的に再検証する。
- `launch(request, authorize)` は protected policyから実行root/環境を解決し、Consoleの `authorize()` をOS admission直前に呼ぶ。認可と原子的なrestricted launchの間にawaitを挟まない。別process brokerなら同等の保護されたhandshake/順序保証が必要。キャッシュしたIDやbooleanで後からspawnしてはならない。
- `stop(exact owned handle)` は明示操作のみ。launch中の失効/不明結果では自動killせず、返却済みhandleを保持してdiagnosticsで管理者へ知らせる。停止/子孫終了の実保証は別パッケージ側の責任。

現PiProcess/RuntimeManagerのowner実行をこのadapterへ付け替えたわけではない。restricted connection bridgeにはplain fallbackがなく、将来の実配線・restricted worker protocol/別runner routingは別承認の実装が必要。現controlはfalseのまま。

## Limitations

static native owner header/localhost条件はOS本人認証ではない。現行管理API・store・同SID・secret問題は今回解決していない。将来パッケージはこれらの**実保護を確認できなければreadyを返せない**。今回のOS未実装状態でも、通常外部MCPは閉じる。OS境界/本人setup受入/実接続/全子孫終了をfixture PASSから推論しない。

UIは未導入/未対応、setup必要、検査失敗/不明/期限切れ、再読込・再検査を示す。setup buttonは実行不可。操作中/結果未確認/期限切れは保守的にOFF表示し、操作は自動再送しない。表示遅延のready snapshotがあってもserver CAS・admissionが拒否する。

## Compatibility

MDNで `Window.fetch()` と `Window.setTimeout()` の Baseline Widely available とChrome/Edge/Firefox/Safari互換表示を確認。標準checkboxを使用し、新しいWeb platform APIは追加しない。Node側AbortController/Proxy/Object.hasOwn等やReact/Playwrightのlibrary APIにBaselineを適用しない。実ブラウザー確認は既存Chromiumのみ、Firefox/WebKitは未実行。
- https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch
- https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/checkbox
