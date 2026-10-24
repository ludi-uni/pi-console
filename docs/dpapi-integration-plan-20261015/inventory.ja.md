# 現行の資格と保存形式（ソースだけの分類）

実profile、.env、server-token、鍵ファイル、grant、履歴本文は開いていない。以下はソースが扱える種類であり、実際の存在・値・件数・期限・有効状態の確認結果ではない。

| 種類 | 現行ソース上の所在・形式 | 今回の統合方針 |
| --- | --- | --- |
| launcher管理token | package/server-manager.mjs の server-token、48桁hexの平文。起動時に生成し環境でserverへ渡す。server-state.jsonはPID/port/startedAt等。 | MCP資格とは別。今回のDPAPI移行に含めず、起動・所有確認を維持する。実ファイルは読まない。 |
| 本人bootstrap code／管理cookie | local-owner-bootstrap.ts。codeは2分、cookieは10分、サーバー側sessionはメモリ上のdigest。 | 永続化・再起動復元しない。設定変更時の既存本人確認を維持する。 |
| 手動3キーprofile | local-owner-profile.ts。trusted-local-credentials.json、version1/enabled:false/revision、read/control/final/expiresAt、request ID/hash/revision。平文JSON、上限32KB、3キーは独立、保存時期限最大24時間。 | 既存を保持。自動変換、消去、期限延長、有効化をしない。新方式は別ファイル。 |
| 旧readonly/control共有鍵 | readonly-mcp-auth.ts、index.ts。readonlyは環境または readonly-mcp.key、controlは環境。64桁hex。native認証時はreadonly鍵ファイルを読まない。 | 別用途の既存経路として扱い、新issuerの鍵との重複を拒否。新しい自動鍵をこれらへ書き戻さない。 |
| trusted-local exact control grant | local-mcp-grants.ts。local-mcp-grants.json、version1/revision/grant/requests。target、期限、credentialEpoch等の非資格メタデータ。起動ごとにepochが変わる。 | フォルダ許可から復元しない。従来のexact target承認を維持。 |
| workspace read/control・exact final | workspace-permissions.ts。workspace-permissions.jsonのversion1/2、revision、workspace/session generation、finalPublication/finalRequests。final-owner-composition.tsのepochも起動単位。 | 新storeへ移さず、本文公開やPi実行を暗黙に有効化しない。 |
| 現行folder接続 | folder-mcp.tsのMap。connection proof digest、token digest、用途別role、parent identity、operations、期限、結果・操作receipt。 | 現状は再起動で消える。本人が新しく承認したfamilyだけをDPAPI storeで復元する実装が必要。 |
| 現行stdio companion | package/local-folder-mcp.mjs。proof/token等をメモリで保持、終了で消失。clientInfoによる認証はない。 | 再起動継続には専用client-state保存が必要。既存clientにこの機能があるとは約束しない。 |
| Pi control接続 | pi-control-activation.ts。proof/tokenとreview/outcomeはメモリ、内部read/control/final鍵は起動時生成、別exact grant経路。 | folder family復元と独立。新しく自動復元しない。 |
| remote本人登録 | settings-owner.ts。settings-owner.jsonはsubject/issuer/audienceとregistered/revoked/request IDの非秘密メタデータ。Access JWTは要求時に検証。 | 登録済み本人の権限を新storeのfamilyと照合する。JWTやcookieを保存しない。既存登録をローカル本人へ勝手に転用しない。 |
| tunnel入力 | settings-tunnel.ts。短命な入力・接続状態、結果はcredentialSaved:false。 | 新DPAPI保存に含めない。ネット設定やtunnel leaseの変更なし。 |
| 既存再開fixture | 隔離local-protected-store.ts/local-resume-fixture.ts。owner、承認、bundle、epoch/replay、取消、操作journalを一括保護。public vector、fixture directory、fixture owner制約付き。 | 制約を外してそのまま出荷しない。production schema/issuer/path/owner/client portを分けて実装し、dummy境界を残す。 |

index.tsは手動profileを読めてもtrustedLocalConfig.enabled=false。local-folder-composition.tsも保存grant・資格の生成やlistener有効化を行わない。今回のDPAPI helper受入成功だけでは、これらが本番へ配線されたことにならない。

保存先の二重解釈に注意する。launcherはconsoleDataDir（PI_CONSOLE_DATA_DIR、またはPI_CODING_AGENT_DIR配下）、直接server起動はPI_CONSOLE_DATA_DIRがなければcwd/.pi-console。環境値そのものは今回読んでいない。将来適用時は、既存launcherが解決した絶対dataDirを一度だけ渡し、両者の一致を非秘密メタデータで確認する。profileの発見を目的にhome全域を探索しない。
