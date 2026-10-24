# 実装の自己レビュー

独立reviewerは起動していません。今回の変更は新しい隔離prototype内だけです。

- grantを有限の絶対期限または明示したnoneに型分離した。owner・対象・操作・none確認時刻を保存し、欠落/null/異常値は拒否する。従来有限期限はそのまま移行する。
- operation policy、メモリー上の有限資格、有限転送を別guardで扱う。noneからrole増加、本文公開、対象追加、無期限credentialを導かない。
- 保存の直列化、clock floor、期限切れ・解除・対象変更のラッチ、再起動での資格喪失を確認した。save/loadと旧schema、期限境界、clock rollback、scope違い、複数client、応答喪失、重複requestをdummyで確認した。
- 確定前のdraft変更は既存grantを変更しない。none確認は下書き編集、状態変更、中断で取り消す。本人の再確認後に古い本人確認案内が残る表示を画像で発見し、修正してUI受入を再実行した。
- Windowsの境界判定はコピーしたproviderとfake portのdummy試験。native handleや実OSの競合耐性を証明していない。新しいfile操作や任意processを許可していない。

実運用に移すには、現行engineとの永続化契約、実owner/client認証、credential管理、実providerとMCP互換性の適用設計が必要。今回の試作を本番適用済み、またはdirectory全般操作の完成と扱わない。
