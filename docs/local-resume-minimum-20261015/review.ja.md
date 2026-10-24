# ローカル復元の自己review

対象は新local-protection/local-protected-store/local-resume-fixtureと、FolderMcp.restoreContinuation/operationJournal、integration fixtureのinject hook。外部正本や新serviceへ拡張しない。

修正/確認:
- 中: crypto seal失敗、directory integrity失敗、lock競合が通常のread/write catch外になる経路を閉じた。観測時onFaultでruntimeを停止し、plaintext fallbackをしない。
- 中: 復元で操作receiptを失うと作成要求が再実行され得たため、intentを副作用前に保護保存し、partial/unknown/completeを復元する。3つのmemory action試験で完了・部分失敗・action後のjournal喪失を確認。
- 中: 新boot世代を自己申告evidenceや旧世代固定文字列に依存させず、保存client proofとtrustedな新世代（fixture値）からsenderを構成。元approval・期限は変更しない。
- 型検査のrevoke結果connectionId欠落1件を修正。初回corruption試験は外側Bridgeがsender_unverifiedへsanitizeする既存契約に期待を合わせ、内部storeの固定errorとclosedを別々に確認した。

受入は既存92＋新44件。全store復元で解除が戻るnegative controlも合格に含む。暗号保護・実client・実OS principalの完成を示す数ではない。

限定fixture契約内の未修正必須指摘なし。実運用のblockerは実CurrentUser adapter、production credential/容量/保存先/既存profile移行、managed singletonとprivate client handoffの実受入。本番readyはfalse。全store rollback/同権限悪意process/OSadminの耐性は要求に含めず、外部leaseを再導入しない。
