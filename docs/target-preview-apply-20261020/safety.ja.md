# 実施前確認

承認対象は package 4 ファイルの適用と fcf の秘密非表示 preview 1 回。既存 client の再読込 API はないため、同じ installed entry を作業専用 stdio companion で新規読込する。既存 client 常駐 process の置換とは区別する。

候補 inspect は session の verifyServer 分岐より前に return し、client/enrollment の `.inspect` は ProtectedJsonStore.read のみ。transaction / protect / issuer / resume / renew / claim / request / close / cancel を呼ばない。main 構築は Windows helper を起動せず、inspect 時だけ通常の SID と DPAPI unprotect が必要になる。これは実状態の正規読取経路で、OS/native 専用試験ではない。helper の入力・出力・SID・DPAPI blob を記録しない。

実行中は preload で Node の通信、ファイル書込、entropy 生成を禁止する。child spawn は既存 Windows 保護モジュールの SID/DPAPI 固定 script のみ許可し、PID/終了だけを記録する。DPAPI helper には protect と unprotect の静的分岐があるが、今回の保護状態 read は unprotect だけを呼ぶことを source で確認した。

controller は initialize / initialized / tools-list で version 2 と inspect カタログを確認後、inspect を 1 回だけ送る。受取期限や応答が不明なら再送しない。結果は固定 whitelist に合うメタデータだけを保存。stderr/raw stdout は保存しない。stdin EOF で dispose し、作業専用 companion と読取 helper の終了を確認する。Console 管理 helper / broker / HTTP は呼ばない。
