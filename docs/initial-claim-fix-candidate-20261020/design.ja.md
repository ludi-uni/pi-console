# 初回claimの最小修正（未適用候補）

本人が承認したgrant、元の初回申請期限、現在のruntime bindingが有効なら、短期accessが切れていても初回proofの保有者に継続材料をprivate handoffする。実操作のlive検証は変えない。clientは継続材料を保護保存した後、既存resume/renewで有効な短期資格を得てからconnectedを返す。

変更はserver/folder-mcp.ts、server/local-mcp-composition.mjs、package/local-resume-session.mjsの3箇所。compositionでは保護family読取のawait後にも同じ初回claim検証を行い、待機中に元の申請期限を跨ぐ競合を拒否する。公開tool、保護state schema、親・操作scope、5分access、元の60分申請、7日grant、revokeは変更しない。legacy非continuationは従来のlive条件を維持する。再起動で復元された接続から元の初回申請を復活させない。

検証手順: 遅延初回handoffの回帰を先にRED確認→最小修正→同じ回帰をGREEN確認→期限前後・取消/失効・継続資格保存/更新の応答喪失・scope/identity・重複getをmemory/fake providerで検証→選定済みlocal-resume回帰確認。通常npm testはOS/native項目を含むので実行しない。

運用手順（今回は実施しない）: 候補差分を確認→別途明示承認された適用→既存Startup環境で必要なruntime更新→新しいgenerationの申請/本人確認が必要か判断。現接続を再起動越しに救済できるとは約束しない。

今回の操作は隔離Temp内のpublic source copyとdummyのみ。実資格生成/DPAPI保存/実client接続、grant変更、データ作成、稼働source/dist反映、stop/startは行わない。UI変更なし、画像・人の操作なし。
