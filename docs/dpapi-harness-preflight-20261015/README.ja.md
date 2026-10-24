# 限定OS dummy harness — source-only準備完了

実OS受入は未実行。confirmation.ja.mdが本人確認文案と正確な入口、execution-plan.jsonが上限・source hashの正本。固定入口は既定で拒否し、明示commandとplan hash一致時だけ1回動作する。

fake-preflight.json: 上限6チェック＋9独立fake scenarioが成功。通常caseはNode2/仮PS4/2file、Protect1/Unprotect3。実PS/実DPAPI/実資格0。timeout/失敗でも全childを終了、各所有rootを削除。繰返しfake scenarioはOS自動再試験ではない。

sourceを差し替えずに node preflight.mjs で再確認できる。実行入口 acceptance.mjs に --execute-public-dummy を渡す操作は本人の別承認後のみ。今回は source/manifest/fake確認/保全だけ。既存source315/dirty15と旧seal911を照合する。本番issuer・保存先・client・設定は操作しない。

Entry SHA256: 57d946d051df25855872a792484e638f0d3fb243115208c7e61788398e256f6e

Plan hash: eb4a93d9ad4c6672186ae0d6db57aa4aa374ab8a9471985cc2562d95f72d4c3f
