# Startup identity addendum

## Result

本人の説明は「自動起動か /pi-console」。この二つだけを調査した。**Startupのpackage候補は0.6.0、Pi管理npmのextension候補は0.4.3で、server sourceは一致しない。現稼働identityと実効Accessは未確定。** 前回preflightの停止条件を解除しない。

## Observed

- 現cwd `D:\Develop\pi-console`、モデル `openai-codex/gpt-6.1-sol`。
- 本人のStartup folderに `Pi Console.lnk` が存在。COMから取得したのはTargetPath/WorkingDirectoryだけ（Saveなし、Arguments/Description/raw dumpなし）。
  - TargetPath: `C:\Program Files\nodejs\node.exe`
  - WorkingDirectory: `C:\Users\leade\.pi\agent\pi-console\reviewed-releases\0.6.0\node_modules\@ludi-uni\pi-console\`
  - CommonStartupの同名shortcutは無し。登録の存在は今回の起動実行・現在の有効policyの証明ではない。
- 通常agent directory候補 `C:\Users\leade\.pi\agent` のpersonal extensions directoryは空。今回cwdの `.pi/extensions` は無し。別cwd・settings経由のpackage・一時extension指定は未確認。
- `C:\Users\leade\.pi\agent\npm\node_modules\@ludi-uni\pi-console` は存在、manifest version **0.4.3**、`pi.extensions=["./extensions/pi-console.mjs"]`。これはpackageの宣言であり、有効な実登録・ロード済みpathの証明ではない。
- 上記Startup WorkingDirectoryのmanifest versionは **0.6.0**。いずれもdirectory自体のmetadataは通常Directory、LinkType/Targetなし（全ancestorのreparse検証まではしていない）。AppData/Roaming/npm側の同名packageは無し。
- `127.0.0.1:31717` listener PID **68540** は再観測した。ただしcommand line・state/token・live APIを取得していないため、どのprefixから起動したPIDかは結び付かない。

## Candidates

`P6` = `C:\Users\leade\.pi\agent\pi-console\reviewed-releases\0.6.0\node_modules\@ludi-uni\pi-console`

`P4` = `C:\Users\leade\.pi\agent\npm\node_modules\@ludi-uni\pi-console`

`R` = `D:\Develop\pi-console`

| 入口 | prefix / code上のentry | 確度 |
|---|---|---|
| 自動起動 | shortcut WDはP6。reviewed prefixは `...\reviewed-releases\0.6.0`。標準登録templateなら `P6\package\startup.mjs` → `P6\package\server-manager.mjs` → `P6\server\index.ts` | WD/package候補を実測。TargetPath=nodeだけではJS entryは特定できない。実Argumentsを読まないため標準templateとの一致は未確認 |
| /pi-console | npm候補は `P4\extensions\pi-console.mjs` → 相対importの `P4\package\server-manager.mjs` → `P4\server\index.ts`。P6やRをlocal packageとして登録する候補もある | manifestにP4のextension宣言がある。実settings/filter/ロード元は未確認。P4を実登録元とは断定しない |

SDKの `docs/packages.md` はpersonal package宣言をsettings.json、project宣言をtrusted `.pi/settings.json` とし、manifestのextension pathはpackage root相対と説明する。installed packageの存在だけではロード状態が分からない。今回settings/実argvは読まず、ここで登録調査を停止した。

## Source identity

公開manifest/launch codeとserver entryの限定SHA256比較（配布archive全体や実processのbuild証明ではない）:

| root / version | package.json SHA256 | server/index.ts SHA256 |
|---|---|---|
| P6 / 0.6.0 | `39863691ff79010c176df6c78a1f7cd5fbea1a1a5272b1a62150e24b6b94d747` | `b2d733a5aa072efe32392a253a43452ef9af0e8341924910bc6b307a1674d283` |
| P4 / 0.4.3 | `2447509ea5f4a58cef376465d9a20ef1ab3ec41dd87c7c49520b5e1f13746cd4` | `ae2c072ce718de4ffbe727228389dc04373b29c9ca068a3cf3dbc4714158678e` |
| R / 0.5.1 | `cc491481bbe148862e7703f5d0453075fa234e189620e1eab0fc36fc49fddf5d` | `0bfc202e87f6ecd05c1e769630b4bc76528874ee5e991fff69d83433dc30be93` |

三者の `extensions/pi-console.mjs`、`package/startup.mjs`、`package/startup-manager.mjs`、`package/server-manager.mjs` は各々byte/hash一致。manager hashは `85dbc78fcd148277cacfd08998267095bc9a2f4176c278b773b383a09189125a`。コードが同じでも `import.meta.url` のpackage rootが違うため新規spawn先が変わる。server entryは三者不一致。

P6/P4とも `server/final-owner-composition.ts` は存在せず、indexの公開コードは直接RuntimeManagerを作る。P6は旧control/integrationのimportを持つ歴史的系統。**0.6.0という版番号がRより大きくても、今回のfinal-owner実装を含むことにはならない。** P6が歴史的Events archiveと全file一致するという検証は今回していない。Rのfinal-owner/default OFFとacceptance-5/AgentSession proof-3は変更していない。

## Still unknown

1. **実 /pi-console ロード元:** 本人がPiのresource表示等で確認したpi-consoleの有効source/path一項目だけが必要。settings全文・他resource・起動引数一覧は不要。npm P4かlocal P6/Rかで新規spawn候補が異なる。
2. **Startupの実script entry:** 本人が秘密を出さず確認できるなら、script pathだけ、または標準startup templateと同じかを説明してもらう。Arguments自体を取得・貼付する必要はない。この情報だけでもPIDとの対応は確定しない。
3. **既存PIDの配布元:** 信頼できる既存非秘密起動metadataでPID 68540とentry/buildを結ぶ証拠が必要。なければ未確定を維持する。managerはstable dataの既存serverを再利用するので、今のshortcut/extension sourceが現在PIDのsourceとは限らない。versionだけもsource hash証明ではない。
4. **Access:** P6/P4の公開indexにも `accessConfig(process.env)` があるが、実env/.envを読んでいないため有効状態は不明。前回のセッション環境3項目の存在を稼働状態に昇格しない。

根拠は各rootのpackage manifest、`extensions/pi-console.mjs`、`package/startup-manager.mjs:35-47`（標準template）、`package/server-manager.mjs:24,160-190`（module-relative entry/再利用）、`server/index.ts` のimports/runtime作成。前回の安全境界・最小対処案は変えず、新status API/実装は作らない。

## Preservation

今回新しい追記文書・metadata証拠だけ。着手前316ファイルをSHA256保全。既存成果物、default OFF、未commit sourceは変更なし。secret/config/history/profile/log/shortcut Arguments/process command line/status CLIは取得・実行なし。接続・grant・OS/ACL変更・install/build/試験/停止再起動なし。Tempや子processを作らずcleanup対象なし。
