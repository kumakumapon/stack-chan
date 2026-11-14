# 旧機種の対応終了と容量課題の扱い

2026-11-14 JST 整理。

## 現在の対象

対応・ビルド・配布・実機リリース検証の対象は **M5StackChan CoreS3
(`m5stackchan_cores3`) のみ**です。WASMとLinuxは開発・自動テスト用です。

[PR #90](https://github.com/kumakumapon/stack-chan/pull/90)で対象を統一し、
[PR #91](https://github.com/kumakumapon/stack-chan/pull/91)で旧機種の実装・ドライバーを整理しました。
初代4 MB M5Stack、Core2、通常のCoreS3、Stack-chan RT、タカオ版Core2 + SG90向けの
機能選別、容量削減、ビルド、配布、実機受け入れは終了しています。
SDKが提供するCoreS3の基盤定義は、M5StackChan CoreS3の依存として使用します。

## Issue #64 の終了理由

[#64](https://github.com/kumakumapon/stack-chan/issues/64)は初代M5Stackのfactory領域に
追加容量を確保する課題でした。対応対象から初代M5Stackを外したため、旧機種向けの追加削減と
実機描画確認は実施予定なしとして終了します。旧機種の容量問題を解決・実機検証したという扱いにはしません。

Issue本文・コメントの容量値、6機種のCI、過去のリリースノートと検証ログは、当時の記録として残します。
旧機種の残量を現行ファームウェアの余裕と比較したり、過去の6機種検証を現行の受け入れ条件にしたりしません。

## CoreS3で継続する容量監視

ファームウェアがfactory領域を超えた場合はビルドを失敗させます。
XSキーは生成済み`mc.xs.c`の`mxKeysCount`を測定し、8,192個の上限に対して
最低256個の空きを要求します。追加機能を入れる際も、この条件で確認します。

基準値はdevelop `bc8f3a99198c19557ba00de6ca0f225348a9dc06`の
[Bundle CI](https://github.com/kumakumapon/stack-chan/actions/runs/43498290001/job/132137064719)
で確認した値です。

| 指標 | 使用量 | 上限 | 空き |
| --- | ---: | ---: | ---: |
| factoryファームウェア | 6,657,056 bytes | 16,318,464 bytes | 9,661,408 bytes |
| XSキー | 7,886 | 8,192 | 306（最低256） |

最新値はBundle CIの`Release build (m5stackchan_cores3)`のsummaryと
`firmware-size-m5stackchan_cores3` artifactを参照してください。
ローカルでは`firmware/`でreleaseビルド後に実行します。

```sh
npm run build:release:m5stackchan_cores3
node scripts/report-firmware-size.mjs m5stackchan_cores3
```

## 実機確認の残件

[#63](https://github.com/kumakumapon/stack-chan/issues/63)のタッチ・保存復元・電断耐性・
教材送信・Petとの共存確認は、M5StackChan CoreS3を対象として継続します。
同Issueにある初代M5Stackの圧縮後描画確認は、対応終了した機種の過去の計画として扱います。
頭タッチやPetの活動共有の残件は[#49](https://github.com/kumakumapon/stack-chan/issues/49)も参照してください。

容量チェック・CI・Simulatorの成功は実機合格を意味しません。
実機確認は後続作業として残し、[実機リリース検証](./release-device-test_ja.md)の
候補SHAとFW／MOD版、各項目の結果を記録します。
