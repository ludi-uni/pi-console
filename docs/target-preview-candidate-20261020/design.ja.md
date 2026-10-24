# 対象 preview / 復元前 ID 照合の隔離候補

実装前の設計。稼働 D ソースを公開 source のみ base/work に保全コピーし、編集と実行は work に限定する。実 helper、資格 store、native / OS entry、実接続、listener、ログイン、申請は使用しない。

- `inspect_local_connection {expectedConnectionId}` を追加する。正規保護状態モジュールの read-only inspect が許可した ID・期限・材料の有無だけを返す。transport/verifyServer を呼ばない。保存済み grant は server 側の現在の有効・解除状態の証明にせず unknown とする。
- 初回 enrollment の client proof は、server 発行の初回受取 proof や承認済み継続 proof と異なる。保護 enrollment だけから初回受取材料があると推定しない。旧期限、broker 世代、schema を変更しない。
- `get_local_connection` に optional `expectedConnectionId` を追加する。同じ process の pending / connected の既知 ID がある場合だけ引数省略を許可する。再起動後の保存済み接続は明示 ID 必須。不一致・不明・grant 期限切れは helper / transport より前に拒否する。
- 復元関数自身でも保存 ID を照合し、server 身元確認 await 後に再読取・再照合する。別 client や状態差し替えに追従しない。private 応答の ID/client も保存より前に照合する。
- 新 process の get は、ID の分からない初回 request の再送や取消を行わない。初回の元 request 再照合は既存 begin、取消は明示 cancel に分ける。期限切れ初回材料を継続材料へ変換しない。
- 既存 begin は、新 process で保存済み接続を無指定で復元しない。既にこの session が確認した接続だけを再利用できる。
- dummy read-only backend / codec を使い、preview の write/protect/issuer/helper/transport は 0 と検証する。正常な guard 通過後の処理は fake のみで検証する。

手順: focused RED → 最小実装 → 同じ focused GREEN → 影響する既存 pure suite → JS 構文確認 → 意味上の自己レビュー → patch/zip/manifest。通常 aggregate tests は native 等を含むため実行しない。既存ローカル tests のうち pure fixture のみ使用し、transport HTTP / managed-open / native entry はこの候補では実行しない。
