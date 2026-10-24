# 既存pi-console管理画面の読取確認：到達状況

**既存ブラウザへ認証状態を保ったまま接続する手段がなく、管理画面の状態・保持期限は未確認。** VMCの画面解放後に読み取りの準備を行ったが、今回実画面を読めたとはしない。認証画面や拒否に遭遇したのではなく、ブラウザに接続する前の技術的な制約で止まった。

## 確認できた事実

- Playwrightの既存managed browser sessionは0。ウィンドウを持つChrome PID22688は存在するが、既存remote debugging port/pipeは設定されていない。通常起動のChromeを再起動したりdebug設定を足したりしていない。別profileや認証コピーも作っていない。
- 同じ既存pi-console-echo-test MCPのget_control_status({})を1回だけ再読取し、再び **404 tunnel_client_not_seen（300秒以上heartbeat未確認）**。DのConsoleから状態/期限を得た結果ではない。別接続へ回避していない。
- DのConsoleはPID30988 / port31717 / version0.5.2 / start2026-10-18T05:24:42.099Zでrunning/managed。配信済みsource9/dist13の全22hashは不変。今回source/dist・認証・接続・grant・期限・security設定を変更していない。

heartbeat未確認というエラーから分かるのは、MCP側がそのtunnel-clientと通信できていないことまで。clientプロセス停止、保持期限切れ、ネットワーク切断などのどれかは、既存管理状態を読めていないため特定していない。**期限切れやローカルプロセス停止と断定しない。** 他トンネルの状態を調べたり停止したりしていない。

## UIで見つかった注意点

「設定→ローカルMCP→既存の接続・権限を管理」は通常の表示導線だが、その中の最初の **「Dotsにつなぐ」** は純粋な表示展開ではない。FioConnection.show()からonStartを呼び、SettingsLocalMcpが/api/settings-local-mcp/startを実行してbrokerを開始する。今回の「接続作成をしない読取」では押していない。

既にDotsの接続panelが開いている場合の「接続状態と対象を再取得」はstatusとtunnel/statusの読取を行う。保持期限表示はleaseUntil、Pi操作期限は別のexpiresAtであり、混同しない。statusには既存の期限/世代チェックもあるため、期限や資格を延長してから読めるようにすることはしない。

## 本人が行う最小の具体的操作

1. 本人の既存Console画面で、通常の **設定→ローカルMCP→既存の接続・権限を管理** まで開く。認証入力や拒否が出たらそこで止める。
2. Dots接続panelが**既に開いていれば**、現在表示の **「転送」状態と「転送の保持期限」** を読む。必要なら読取専用の「接続状態と対象を再取得」を使う。「Pi操作期限」が表示される場合は保持期限とは別に記録する。
3. 最初の「Dotsにつなぐ」しか無い場合は押さず、その状態だけ知らせる。現UIはその初回展開にbroker開始を伴うため、今回の純粋な読取だけでは先へ進まない。

共有が必要なのは状態名と日時だけ。接続key、subject、token、URL query、資格入力画面の内容は不要。今回こちらからキー入力/送信、接続作成、再利用の実行、解除、期限変更をしていない。

既存管理をブラウザから自動で読むことを続ける場合は、現在の認証を保った既存のブラウザ操作経路が必要。今回の指示では新しいdebug/access設定やブラウザrestartを作らないため、本人/親による上記2項目の実見が最も小さい次の一手となる。

## 検証方法の制約

[visual-verification SKILL.md](C:/Users/leade/.codex/skills/visual-verification/SKILL.md)は **“For Web UI or browser interaction, use Playwright instead”** と指定し、browser-level検証の代わりにデスクトップ全体の撮影へ切り替えないよう求めている。既存ChromeにPlaywrightで接続する経路が無いので、別の全画面撮影やDevToolsの保護回避へ進めていない。これは認証拒否を回避するための代替手段を試した結果ではない。

UI操作0、実画面/認証情報capture0、資格作成/入力/受渡し0、接続作成0、grant/保持期限変更0、新規access設定0、restart0、他トンネル停止0、pi-warden作業0。既存Chrome/Consoleとも停止・変更せず、記録のみ作成した。
