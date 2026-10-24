# Windows folder provider の配置境界

2026-10-11: 承認済みprobeなしDLLをDへ明示配置済みです。providerのdescriptorはこの配置でreadyにしましたが、MCP listener・実grant・用途key・client接続は有効化していません。本人のowner browser承認が必要です。

通常は windows-folder.provider.json の enabled=false で provider を使用できません。ファイルが存在しない場合も同じです。環境変数、HTTP、clientInfo、owner UI から binary path や provider readiness を指定する口はありません。

別途承認した配置だけが、固定の windows-folder.node と descriptor を置きます。loader は Windows x64 / Node v24.22.1 / modules ABI 137 / runtime Node-API 10、contract 2、source SHA、binary SHA と export の完全一致を確認します。C++ は NAPI_VERSION=8 です。Node-APIの一般互換性があっても、このcandidateは未検証runtimeへ自動的に広げません。構成・hash・load・contract の不一致は固定error codeで起動を拒否します。

レビュー対象 C++ source SHA256 は 17400635999615e1bc5fe3d0b9cdaaf85d171e55de79eadd090f5495fcea652e。既存native10条件を通過した core source と同じbytesです。ただし通過したDLLは FOLDER_FIXTURE_PROBES を定義した検証用です。production loader は configureFixture / tryWriter / tryRename / setJunction / removeJunction を含む binding を拒否します。そのDLLを配布しないでください。同一sourceからprobeなしbinaryをbuildし、隔離load/export契約とD稼働プロセスの実ロード元/SHAを確認しました。新binary SHA256: a0176ffe6b3c1b9f8f37f5609ae78cb4ee40c944746b54e4c14fc53b99f71cc6。folder/repo操作・native10条件の再試験はこのbuildで行っていません。

今回の承認済みbuildは同じsource、既存Node v24.19.0 Windows x64 headers/node.lib、MSVC 14.44.35207、SDK 10.0.26100.0を使い、FOLDER_FIXTURE_PROBESを定義せず行いました。実build receiptにcompiler/linker/source/dependency/binaryのSHAとflagsを保存し、probeなしexport contract確認も承認範囲で行いました。未知のbinaryを既存native10の結果だけで本番動作確認済みとは扱いません。

2026-10-22 の Node v24.22.1 固定runtime検証では、この同一のprobeなしbinary（SHA256: a0176ffe6b3c1b9f8f37f5609ae78cb4ee40c944746b54e4c14fc53b99f71cc6）を隔離childでloadし、exact export、candidateOnly=true、policyVersion=2、contract=2、fixtureProbes=false を確認しました。専用NTFS fixtureでvolume GUID/file ID、component-relative no-follow、selected parentのwrite/rename/delete共有拒否、exclusive createと4096 byte上限・flush、junction拒否、identity replacement拒否、closeAll後liveCount=0を確認しました。receiptは production-rollout-2026-10-22/native-node-compat に保存しています。この検証はlistener、grant、owner承認、production restart/deployを有効化しません。

配置時のdescriptorは以下6項目のみです。binarySha256はその承認済みbuild receiptから64文字の小文字hexを入れます。この例はそのまま有効化できる設定ではありません。

```json
{
  "enabled": true,
  "contract": 2,
  "fixtureProbes": false,
  "sourceSha256": "17400635999615e1bc5fe3d0b9cdaaf85d171e55de79eadd090f5495fcea652e",
  "binarySha256": "<承認済みprobeなしbuildのSHA256>",
  "runtime": {"platform":"win32","arch":"x64","node":"v24.22.1","napi":10,"modules":137}
}
```

descriptorとbinaryを含むinstalled codeはPi/SDK/extensionsと同様に信頼する前提です。SHAは配布物の整合確認であり、installed codeを書き換えられる攻撃者の認証手段ではありません。既存Console registryのdirectoryは実在し、許可する親folderの外にある必要があります。drive aliasもphysical volume pathで確認します。不確かなNTFS/volume/identity/reparse/case、registry配置、handle解放失敗は拒否します。

明示構成により既存owner brokerへ managedFolderProvider と WorkspaceStore の登録を結線するだけです。MCP public listener、Cloudflare、legacy read/control/final export、grant、keyを有効化しません。本人のbrowser承認は別です。
