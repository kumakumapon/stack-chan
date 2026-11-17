# リポジトリの品質チェックと依存更新

## CIとローカルの入口

| 対象 | チェック | CI |
| --- | --- | --- |
| Firmware | `npm test`、`npm run test:python`、`npm run check:architecture`、Biome | `build.yml`の`test-fast` / `biome` |
| Web | `npm run format`、型チェック、Node / React / ブラウザーテスト、`npm audit --audit-level=high` | `build.yml` |
| Gateway | `npm run check`、`npm run typecheck`、`npm test`、`npm run test:python`、`npm audit --audit-level=high` | `gateway.yml` |

コマンドは各ディレクトリで実行する。Firmwareの依存監査も`test-fast`で実行する。
Firmwareの`scripts/lib/*.test.mjs`はglobで検出し、新しいテストを手書き一覧へ追加する必要はない。
Pythonの2スイートは標準ライブラリだけで実行できる。音声モデルの取得、外部AI API、実機USBは使用しない。
既存の[CI集約方針](ci-validation_ja.md)は維持する。
依存とActionsの整合性テストは`web/repository-dependencies.test.mjs`に置き、
YAML parserをインストール済みのWeb Nodeテストで実行する。
配布物の最終組み立てジョブは追加のnpm依存なしでworkflowスクリプトのテストを実行できる。

Webは既存のPrettier設定を`format` / `format:fix`とCIで共用する。
生成物・vendor・npm生成のlockfileは`.prettierignore`に明記し、所有するソース・設定は検査する。
GatewayのBiomeは`src`に加えて`scripts`とルートのJSON / YAML設定を対象にする。
Pythonの整形・静的解析はBiomeの対象外で、現状は上記の動作テストを使う。

`firmware`で`npm run install-hook`を実行すると、ルートのlefthookが
変更のあるfirmware / gateway / webをpre-commitで検査する。
各対象の`npm ci`を先に実行する。GatewayとWebはパッケージ全体を検査するため、
部分的にstageした変更も含めて作業ツリーを整えてからcommitする。

## バージョン方針

- 直接npm依存は、実際に検証したlockfileの解決済みバージョンをexactで指定する。
  SDKと連動する`@moddable/typings`は手動更新を維持する。
- TypeScriptはfirmware / web / gatewayで7.0.2、Biomeはfirmware / gatewayで2.5.10を基準とする。
  例外として、`firmware/tools/typedoc`はTypeDoc 0.28のpeer対応範囲に合わせて
  TypeScript 6.0.3を分離して使う。アプリのコンパイラは変更しない。
- 外部GitHub ActionsはSHA固定とし、コメントでバージョンを示す。
  同じActionはcomposite actionとworkflowで同じSHAを使う。
- Renovateはfirmware / web / gatewayを別グループにし、lockfile更新も分離する。
  通常npm更新の7日待機、major更新のDashboard承認、自動マージ無効を維持する。

2026-11-17の公開Issue検索ではDependency Dashboardは見つからなかった。
設定に`dependencyDashboard: true`を明示したが、これはRenovate Appのインストール・稼働を保証しない。
管理者はAppのリポジトリアクセスと実行ログを確認し、初回実行後にDashboard / 更新PRが作成されることを確認する。
Appの管理設定は本PRのコード変更の対象外。

監査追加時にFirmwareツール用の推移依存（gRPC、XML parser、brace-expansion、Markdown parser）を更新し、
High / Criticalは0件にした。2026-11-17時点でModerateが6件残る
（glob / rimraf / google-gaxとTypeDoc / plugin / minimatch）。
`--audit-level=high`は維持し、残りは上流の対応版と互換性を確認して別途更新する。
`npm audit fix --force`によるTypeDocのmajorダウングレードは行わない。

## 次回リリースでの整理

`.changeset/`はリリース凍結時にまとめてレビュー・消費する履歴であり、現在の対応機能一覧ではない。
`ministack-event-stream.md`、`hermes-desktop-investigation.md`などの追加記録と
`retire-ministack-hermes-desktop.md`の廃止記録を照合し、削除済みの機能を新機能として案内しない。
相殺した理由と対象をリリースノートに記録してから消費する。履歴だけを先に削除しない。
[リリース手順](release-flow_ja.md)も参照する。

ルートの`REVIEW_firmware-rearch_ja.md`は対応分類済みの過去レビューとして保存する。
現在の実装と実機残件は[実装状況](../IMPLEMENTATION_STATUS_ja.md)とGitHub Issuesを参照する。
`firmware/package.json`のrepository / bugs / homepageは、このforkの`kumakumapon/stack-chan`を案内する。
