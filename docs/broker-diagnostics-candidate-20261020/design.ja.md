# 診断情報だけの変更

対象はpackage/managed-resume-broker.mjs。managed_resume_unavailable等の既存messageと成功の戻り値を維持し、既存検証を同じ順序で行う。失敗に安全なreason列挙値とHTTP status（整数100–599、なければnull）だけを付ける。IO例外はraw message/cause/code/payloadを取り込まず、段階enumへ置き換える。認証・listener開始・資格処理は変更しない。

安全な診断抽出関数はこのmoduleが生成した例外だけを認識し、未知の例外のproperty/messageを読まない。自動logは追加しない。公開MCP応答は既存generic拒否のまま。HTTP statusとJSON-RPC codeを混同せず、過去の失われた数値を復元したと主張しない。

先にmissing broker回帰をRED確認し、各検証分岐・検証順序・HTTP数値・IO例外/未知errorの秘密非混入・成功互換・検証call回数をdummyで確認する。実helper/HTTP/OS/native/資格処理は呼ばない。本番sourceは未変更のまま候補とpatchを返す。
