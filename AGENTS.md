# Project instructions

## Browser compatibility

- Web フロントエンドで使用する HTML・CSS・JavaScript・Web API は、MDN Baseline に準拠し、原則として **Baseline Widely available** の機能を選ぶ。
- 機能の採用・変更時は MDN の Baseline ステータスとブラウザー互換性情報を確認する。Baseline は Web プラットフォーム機能の互換性の指標であり、Node.js API やライブラリー API には適用しない。
- **Baseline Newly available** または **Limited availability** の機能が必要な場合は、採用理由を明示し、feature detection とフォールバックまたは progressive enhancement によって未対応ブラウザーでも主要な操作が成立するようにする。
- Baseline への適合だけで動作確認済みとみなさず、変更箇所に応じたブラウザーでの検証を行う。
- 参照: https://developer.mozilla.org/en-US/docs/Glossary/Baseline/Compatibility
