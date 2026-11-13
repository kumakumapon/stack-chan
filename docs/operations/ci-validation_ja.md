# CI のブラウザー検証と集約結果

`Build Stack-chan Firmware` は WASM、Simulator 用 Pet MOD、Web アプリを
`web-build` で一度だけ作成する。同じ実行・コミットの `web-runtime-<SHA>`
artifact を全ブラウザー検証で使用し、検証側ではビルドし直さない。

`web-browser` は pages、simulator、i18n、pet、focus、memory、rhythm、play-pack、
daily-mini-apps、workshop、companion の 11 スイートを個別に実行する。
`fail-fast: false` により、CATCH を含む pages の失敗後も他のスイートは実行される。
SDK と Emscripten のセットアップはビルド側だけで行い、Gateway は companion だけで作成する。
各スイートの実行上限は 25 分。テストの assertion は従来どおり維持する。

既存のチェック名 `web-visual` と `test` を集約ジョブとして維持する。
ブランチ保護や配布・デプロイの設定は変更しない。

| 集約チェック | 成功に必要な結果 |
| --- | --- |
| `web-visual` | `web-build` と全 `web-browser` が成功 |
| `test` | `changes`、`test-fast`、`web-visual` が成功。ファームウェア関連変更または手動実行時は `biome`、`test-moddable`、`test-smoke` も成功 |

変更検出が明示的に `firmware=false` を返した push / PR の場合だけ、
ファームウェア用 3 ジョブのスキップを許容する。失敗、キャンセル、想定外のスキップ、
不足した結果や変更検出値は集約を失敗させる。集約は依存ジョブの失敗後も実行する。
ワークフロー全体がキャンセルされた場合も成功として扱わない。

## 失敗時の確認

- `web-visual-<suite>-diagnostics` に、そのスイートのログと PNG / JSON を保存する。
- pages の CATCH 検証では launcher / title / running の LCD 画像、URL、
  ランチャー行、Simulator ログ、ブラウザー例外を保存する。画像変化の assertion は削除しない。
- `web-runtime-<SHA>` から同じ WASM / Pet MOD / Web アプリを取得できる。
  `.github/scripts/ci-web-suites.mjs run` はその artifact の `web/dist` を参照し、
  必要な生成ファイルをテスト用ソースパスへ復元する。
- SDK 取得の失敗は `web-build` または Bundle のセットアップとして確認する。
  ブラウザー assertion の失敗とはログ・ジョブが分かれる。

スイート一覧の網羅性と集約の異常系は `node --test .github/scripts/ci-*.test.mjs`
で確認する。ブラウザー検証は実 WASM を利用するが、CoreS3 実機検証を代替しない。
