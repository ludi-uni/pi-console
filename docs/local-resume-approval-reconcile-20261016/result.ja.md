# 承認済み配布候補と確認 UI 改訂の照合

結論: board revision1333 / messageId 0885da8b-c9e4-4096-82b4-6cb9cd384381 の「1」として依頼された固定対象は、旧リリース候補の **source23件（更新9・追加14）とdist13件**。最新確認UIを含めた候補は **source24件（更新9・追加15）と再ビルド後のdist** になり、同じファイル集合・同じハッシュの配布物ではない。今回、適用はしていない。

承認内容は今回の依頼に添付された本人 author:owner / body:1 の証拠に基づく。boardの新しい操作・更新は行っていない。

## 固定された承認対象 A

- root: C:/Users/leade/AppData/Local/Temp/pi-console-release-build-20261016-f38c8a72
- 配布物: release-default-off.zip
- SHA256: efc21d31aa5e00aa93534540b9295dc7df5da5b269e48760d227807390a827c4
- manifest: 上記rootのdeployment-manifest.json
- source23の実payload、dist13の実payloadをmanifestのafterSHA256と照合し一致。
- 当時のtscとViteビルド成功の記録を参照。新しいビルドは実行していない。
- 旧seal420件を再照合して全一致。

既存の「1」を当時のsource集合・ハッシュ・dist集合のまま扱う場合、最終対象をこのAに固定できる。確認UIの後続改訂は含まれない。

## 最新確認 UI との関係

root: C:/Users/leade/AppData/Local/Temp/pi-console-local-resume-ui-20261016-c4b82d91

| パス | 承認source23との関係 | 旧候補からの差 |
| --- | --- | --- |
| web/LocalResumeMcp.tsx | 同じパスは含まれるが、新しい内容のハッシュは異なる | 183dfbccec66dd5943f37bf784e96820da9b074c3b201e818dff63db280c5105 → 3b0b831622168835f03c6f5868bb4c4786de781fe281283a9ed79d8f64d22c7a |
| web/local-resume-review.css | source23には含まれない追加パス | 新規 c2df90a913ffeaf7fb506b15be6be221a904330e0e37dcb21a055e4964d17bb8 |

UI改訂の基点ハッシュは承認候補と一致。承認source23のうち22ファイルは最新候補とバイト単位で同一、1ファイルだけ上表の変更。2ファイルが丸ごと承認済みsource範囲に入るわけではない。統合数は23+2から重複1を引いた24件。Dへの配置としては更新9・追加15であり、25件ではない。

最新UI seal381件も全一致。比較対象の旧候補・最新UI候補は一切変更していない。

## ビルドとマニフェスト

実稼働のフロントエンドはserver/index.tsの ../dist/ から配信される。owner.html → web/local-owner-main.tsx → LocalOwner → LocalResumeMcp の構成で、新CSSはLocalResumeMcpからimportされる。

したがって最新source2件だけを旧dist13件に組み合わせると、ソースは新UIでもブラウザーには旧UIのビルドが配信される。最新UIを反映した配布物には以下が必要。

1. 旧リリース候補を保持した別の隔離コピーに、最新UI2件を組み込む。
2. tsc --noEmit と既存Vite設定の本番ビルドを隔離環境で行う。
3. 実際に出力されたdistのファイル数・相対パス・bytes・ハッシュを収集する。**新distが13件のままとは現時点では確定できない**。新しいCSS/JSのハッシュ付きassetやowner.htmlの参照変更が見込まれるが、確定値はビルド後に得る。
4. source24件と新distを一体のdeployment-manifest / archive / archive-verificationに固定する。旧ZIP・旧manifestを同じIDのまま差し替えない。
5. 適用前のD側source/dist・既存dirty・HEADを再照合し、backup/rollback対象を更新する。既存source9と適用直前のdist一式を保全し、元々存在しない追加source15の復旧時削除は適用後ハッシュが一致するものだけに限る。追加CSSもこの記録に含める。

latest-ui-source-manifest.preview.json にsource24件の具体的なパスとハッシュを保存した。これは **SOURCE_PREVIEW_ONLY_NOT_DEPLOYMENT_APPROVAL** であり、distはnull・deployable=false。未実行のビルド結果や配布承認を捏造していない。

## リスクと操作範囲の比較

サーバー・保存・本人認証・資格の発行・grant・期限・再送防止・失効の実装はAと同一。server/index.tsのcreateLocalMcpInstallationはenabled:falseのままで、owner画面もstatus.resumeAvailableで新UIを切り替える条件を維持する。新UIが操作の権限やMCP有効化を増やす変更はない。

UIの状態と通信処理プレフィックスはAと直接比較して一致した。既存証拠のonClick/onChange/disabled/checked 28属性一致、noEmit診断0、関連fake回帰43/43、画面25項目・36操作を参照した。この照合でテストは再実行していない。

最新UIは、要約・日本語名・重要事項の常時表示・技術詳細の折りたたみ・主従ボタン・狭幅レイアウトを変更している。利用者の同意判断に関わる表示面と、生成asset/キャッシュ/HTMLの整合が増分の確認対象になる。旧ビルドの検証だけで新しい本番bundleまで検証済みとは扱わない。

同じ既定OFFで配置するなら、管理下Console1回の停止→配置→起動、接続/cookie切断の可能性、新資格/grantなしという運用面の種類はAと同等。一方、配布するsource集合と生成distの内容は変わるため、**「運用リスクの種類が同等」と「承認済みの配布物そのものが同一」は分ける必要がある**。

## 現在のD側と適用の前提

- source315ファイル、現在dist20ファイルの集合とハッシュ、既存dirty15ファイルのハッシュが旧保存記録と一致した。
- HEAD: 23815ba260320e3fc720ad3288ca89728f99b4f7。
- Aの更新9ファイルのbeforeSHA256は現在Dと一致、追加14パスは未存在。最新追加CSSもDには未配置。
- 実行・queue・orchestratorの現在状態は今回取得していない。以前の「停止中」という返答を現在の停止証拠に流用しない。適用直前のfreshなbusy/所有状態確認は引き続き必要で、busyまたは確認不能なら停止・再起動しない。

## 親が固定できる最終対象

- **既存「1」のファイル数・ハッシュを維持する場合:** Aのsource23/dist13/上記ZIP SHAを固定し、最新UIは別版として保留する。
- **最新UIも反映する場合:** source24（更新9・追加15）を基点に、別隔離本番ビルドと新manifestで配布物Bを作ってから、その実ファイル数・ハッシュを含む対象として明示する。Aのdist13を流用して「最新UI込み」とは説明しない。現在Bのdistと配布物は未作成なので、最終適用対象はまだ固定できない。

この依頼では、どちらの候補も適用していない。build0、test0、公開dummy transport試験0、OS暗号0、stop0、restart0、実資格0、grant0、enablement0。pi-warden、.env/profile、秘密、Startupやネットワーク設定に触れていない。
