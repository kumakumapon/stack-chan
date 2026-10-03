# MiniStack・Hermes Desktop接続の廃止

2026-10-03の方針変更により、stack-chan側のMiniStack専用接続とHermes Desktop専用ブリッジを削除しました。
方針と完了条件: [issue #57](https://github.com/kumakumapon/stack-chan/issues/57)。

## 削除した機能

- MiniStack専用MOD、共有鍵生成ツール、専用プロトコルのテスト、Web接続テスト画面。
- Hermes Desktopのloopback認証・JSON-RPC・STT/TTS adapter、専用起動エントリとランチャー。
- Desktopブリッジ専用のWindows音声処理、BLE設定補助、スモークツール。

共通Local Peer API、BLE通信基盤、汎用Conversation Gateway、Echo/OpenAIと別プロトコルのHermes HTTP backendは引き続き利用できます。
調査中に修正した共通音声・サーボの不具合修正と回帰テストも維持します。
Release impactはmajorです。専用接続機能を利用していた環境では移行が必要です。

## 導入済みのMiniStack MOD

ソースを更新しても、実機へ既に書き込んだMODは削除されません。
旧MODのDrawerにある「Stop MiniStack」、またはタッチの長押しでセッションを停止し、PC側のMiniStack接続プロセスも終了してください。
再起動すると旧MODが再び動くため、継続して使わない場合はホストの復元か別のMODへの置き換えが必要です。

ホストの製品既定動作へ戻す手順は[フラッシュ領域の消去](../../firmware/docs/flashing-firmware_ja.md#オプショナルフラッシュ領域の消去)を参照してください。
全消去には設定とMODが失われるため、必要な設定を控えてから実施し、対応機種のホストを書き込み直します。
CoreS3の場合は`firmware/`から`npm run erase-flash`、続けて`npm run flash:m5stackchan_cores3`を使用します。
設定を保って別のMODを使う場合は、互換性のあるMODを選び、[MOD書き込み手順](../../firmware/docs/flashing-firmware_ja.md)に従って旧MODを置き換えてください。
このPRでは実機への書き込みや設定消去は実行しません。

## 導入済みのHermes Desktopブリッジ

1. 旧Gatewayランチャーを終了します。
2. 本体の起動設定で`conversation.backend=none`、`conversation.autoStart=0`を設定し、意図しない再接続を防ぎます。
3. 保存済みのendpointやtokenはこの変更で自動消去されません。汎用Gatewayへ移行する場合は、そのGatewayに合わせて接続先・認証・マイクの設定を明示的に設定し直します。

Hermes Desktop本体、MiniStack側リポジトリ、PCの認証情報・設定・ファイアウォール規則は変更しません。

## 以前の生成物

Gitの更新は無視対象の生成物を削除しません。旧checkoutを再利用する場合は、残っている生成物も整理してください。

- `gateway/dist/hermes-desktop-main.js`と同名の`.js.map`・`.d.ts`。
- `gateway/dist/agent/hermes-desktop.js`、`hermes-desktop.test.js`と、それぞれ同名の`.js.map`・`.d.ts`。
- `gateway/dist/audio/windows-tts.js`と同名の`.js.map`・`.d.ts`。
- `web/dist/ministack/`。通常の`web/`での`npm run build`でも出力ディレクトリは更新されます。
- 旧MiniStackの共有鍵を含む`firmware/mods/examples/ministack/config.local.js`と生成済みarchive。archiveは配布しないでください。

Gateway出力をまとめて作り直す場合は、必要な`gateway/dist/runtime/`を安全な場所へ退避してから`gateway/dist/`を削除し、`gateway/`で`npm run build`を実行します。
`dist/runtime/device-token`は既存Gatewayの認証に使われるため、保持するか、明示的に認証を更新するかを先に決めてください。
以前のファームウェア生成物は`firmware/`の`npm run clean`で削除できます。

## 調査記録

[MiniStack実機検証メモ](./ministack-cores3-validation_ja.md)と[Hermes Desktop調査記録](./hermes-cores3-investigation.md)は過去の記録として残します。
そこにある旧接続・再開手順は現行版では使用できません。
