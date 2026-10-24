# OFF画面表示版の配信対象（未適用）

本人の2026-10-16 03:32 UTC「いいよ」で許可されたUI/権限分離修正の隔離実装・検証を完了した。

現Dへの更新対象はsource3件:

- web/local-resume-review.css
- web/LocalOwner.tsx
- web/LocalResumeMcp.tsx

加えて同じbuildのdist14件。新asset4件とindex.html/owner.htmlの参照を一体で更新する。共有chunk再分割によりmain JS/hashも変わるが、MainAppのsourceやserver/packageは変えない。基となる新連携実装familyは24sourceのままで、この差分だけが新しい。

バックアップはcurrent source3件とdist22件の25ファイルを実施済み。適用直前にbefore hashを再照合し、ずれていたら上書きしない。新assetを先に配置/hash照合し、HTML2件を最後にatomic置換する。既存asset12件を削除しない。

serverは静的ファイルをGETごとにreadFileするため、今回のフロント配信更新にはmanaged再起動は不要。新しい管理資格・nonce・cookieを作る操作も不要。配信後は既存のローカル本人管理ページを再読込して確認する。通常Console全体の設定画面刷新ではなく、本人管理で認証した後の新連携UI表示である。

新権限機能はOFFのまま。表示確認の下書きを送信・保存せず、実承認・資格・grant・transportを有効化しない。HEAD/既存dirty/Startup/.env/profile/既存grant/networkは維持する。本番配信更新そのものはこの候補では未実行。追加managed再起動も0。

deployment-manifest SHA256: 3b6f9cbcdfa3c0e9d1225648090181179ec756f7967ccd6321ea3e958638ff1f
