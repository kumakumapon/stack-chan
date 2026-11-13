# プログラムのビルドと書き込み

[English](./flashing-firmware.md)

## ｽﾀｯｸﾁｬﾝのプログラム構成について

### ホストと MOD

![ｽﾀｯｸﾁｬﾝのプログラム構成](./images/host-and-mod.jpg)

ｽﾀｯｸﾁｬﾝのファームウェアは、ｽﾀｯｸﾁｬﾝの基本動作を提供するプログラム（ホスト）とユーザアプリケーション（MOD）から構成されます。
一度ホストを書き込んでしまえば、ユーザアプリケーションのインストールは短時間で終わるため高速な開発が可能です。
最初にホストを書き込み、必要に応じて MOD の書き込みを行います。
MOD がインストールされていない場合、ホストは製品既定動作を実行します。
MOD がインストールされている場合、製品既定動作は実行されず、MOD が `onContextCreated` で runtime context を受け取ります。

### マニフェストファイル

ホストと MOD はそれぞれ、設定用のマニフェストファイル（manifest.json）、JavaScript モジュールのソースコード、画像や音声などのリソースから構成されます。
マニフェストファイルでは、JavaScript モジュールの名前と場所（modules）や、モジュール内から参照できる設定（config）などを含みます。
また、マニフェストファイルは他のマニフェストファイルを含める（include）こともできます。

全ての設定項目は[Moddable の公式ドキュメント（英語）](https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/tools/manifest.md)を参照してください。

## 設定変更

M5StackChan CoreS3のアプリ設定は[`host/app/manifest_m5stackchan_cores3.json`](../host/app/manifest_m5stackchan_cores3.json)が入口です。
独自のローカルmanifestからこのファイルをincludeし、`npm run build -- --manifest [ローカルmanifest]`で指定できます。
Wi-Fiや音声設定はPreferencesからも変更できます。秘密情報はコミットしないでください。
サーボの種類と配線は専用プラットフォームで固定します。実機では`m5stackchan`を使用し、`none`はデスクトップ・WASM用です。旧ドライバーの指定はエラーになります。

| キー              | 説明                                            | 使用可能な値                                |
| ----------------- | ----------------------------------------------- | ------------------------------------------- |
| driver.type       | モータドライバの種類                            | "m5stackchan" (CoreS3), "none" (desktop/WASM)           |
| driver.panId      | パン軸（首の横回転）に使うシリアルサーボの ID   | 1~254                                       |
| driver.tiltId     | チルト軸（首の縦回転）に使うシリアルサーボの ID | 1~254                                       |
| driver.offsetPan  | パン軸のオフセット                              | -90~90                                      |
| driver.offsetTilt | チルト軸のオフセット                            | -90~90                                      |
| tts.type          | [TTS](./text-to-speech_ja.md) の種類            | "local", "voicevox", "remote", "voicevox-web", "elevenlabs", "openai"                         |
| tts.host          | TTS がサーバと通信する場合のホスト名            | "localhost", "ttsserver.local" などの文字列 |
| tts.port          | TTS がサーバと通信する場合のポート番号          | 1~65535                                     |
| tts.volume        | TTS を再生する時の音量                        | 0~1                                         |

また、`"include"`キーの配下にリスト形式で他のマニフェストファイルのパスを指定できます。

## 基本プログラム（ホスト）の書き込み

前述の通りｽﾀｯｸﾁｬﾝのファームウェアは基本プログラム（ホスト）とユーザアプリケーション（MOD）から構成されます。
次のコマンドで、標準構成の M5StackChan CoreS3 ホストをビルドして書き込みます。

_コマンドに`sudo`をつける必要はありません。_

```console
$ npm run flash
```

ビルドだけ確認したい場合は `npm run build` を使います。
`build`、`flash`、`deploy` の各スクリプトは、すべての対応サブプラットフォームでreleaseモードを既定とします。
debugまたはinstrumentモードが必要な場合は、`--mode=debug` または `--mode=instrument` を明示してください。
ビルドしたプログラムと中間生成物は `firmware/dist/bin/` と `firmware/dist/tmp/` 配下に保存されます。
ホストアプリケーション名は `stack-chan-host` です。
`npm run clean` を実行すると、`firmware/dist/` 配下の生成物をすべて削除できます。
`npm run bundle` でも各ターゲットのビルド出力は `firmware/dist/` 配下に保存され、検証済みの成果物は `firmware/dist/bundle-targets/` に集約されます。最終的なディレクトリと ZIP は `firmware/host/app/` 配下に生成されます。

### M5StackChan CoreS3

対応する実機はM5StackChan CoreS3のみです。各コマンドは専用サブプラットフォームと対応するアプリmanifestを選びます。

| 用途 | コマンド |
| --- | --- |
| ビルド | `npm run build` |
| 書き込み | `npm run flash` |
| deploy | `npm run deploy` |
| デバッグ | `npm run debug` / `npm run debug:xsdb` |
| MOD書き込み | `npm run mod -- [modのmanifest]` |
| 配布ZIP生成 | `npm run bundle` |

専用の[プラットフォーム定義](../host/platforms/m5stackchan_cores3/manifest.json)で、`m5stackchan`ドライバーとシリアルTX6 / RX7を選択します。
ドライバーはSCServoプロトコルに加えて専用ゼロ位置・可動域・PY32電源制御を持ち、保存済みの異なる`driver.type`を無視します。
通常CoreS3のSDK定義は内部依存として使用します。他機種の配布を意味しません。
WASMとLinuxは開発・テスト用に維持します。

## デバッグ

次のコマンドで、選択したホストを Moddable のデバッガで起動できます。

```console
$ npm run debug
```

このコマンドはModdableのデバッガ`xsbug`を開き、M5Stackと接続します。

Moddable SDK 9.0.0以降のM5StackChan CoreS3では、debugおよびinstrument buildは、xsbugを起動しない場合も内蔵USB Serial/JTAGのCDCドライバをModdable debugger用に確保します。
同じbuildでStackchan DockやCodex VoiceにCDC接続を使わせることはできません。
USB通信の検証には、通常のreleaseモードの`build`、`flash`、`deploy`コマンドを使用してください。

![xsbug](./images/xsbug.png)

`xsbug`を使うとログの確認やブレークポイントの設定（プログラムの特定行で一時停止する）、ステップ実行（プログラムを1行ずつ実行する）などができます。
`xsbug`の詳しい使い方は[公式ドキュメント（英語）](https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/xs/xsbug.md)を参照してください。

ターミナル上の`xsdb`を使う場合は次のコマンドを実行します。

```console
$ npm run debug:xsdb
```

複数のシリアルデバイスがある場合は、`--port`で対象を指定できます。

```console
$ npm run debug:xsdb -- --port /dev/ttyACM1
```

## （オプション）ユーザアプリケーション（MOD）の書き込み

次のコマンドでユーザアプリケーション（MOD）の書き込みを行います。

_コマンドに`sudo`をつける必要はありません。_

```console
$ npm run mod -- [modのマニフェストファイルのパス]
```

`npm run mod`は`mcrun -t build`でXSアーカイブを生成した後、`esptool`で実機のpartition tableを読み、type `0x40` / subtype `1`の`xs`パーティションへ直接書き込みます。
パーティションのoffsetは実機から取得され、アーカイブの形式、領域サイズ、選択したチップ、Moddable firmware descriptorを確認してから書き込みとverifyを行います。
xsbugの書き込みチャネルを使わないため、ホストはdebug buildとrelease buildのどちらでも構いません。

複数のシリアルデバイスがある場合は、`--port`または`STACKCHAN_PORT`で対象を指定してください。

```console
$ npm run mod -- ./mods/examples/look_around/manifest.json --port /dev/ttyACM1
```

標準のコマンドは、JavaScript module を解決する MOD manifest を対象にします。
ESP32 と lin target では、Moddable toolchain 経由で TypeScript module も扱えます。
WASM host で確認する場合も、`lin` など TypeScript 対応済み target で build した `.xsb` または archive を読み込ませます。

書き込み後は、MOD が製品既定動作の代わりに実行されます。
ボタンや画面操作の意味は、インストールした MOD の実装で決まります。

**例: [`mods/examples/look_around`](../mods/examples/look_around/)をインストールする**

```console
$ npm run mod -- ./mods/examples/look_around/manifest.json

> stack-chan@0.2.1 mod
> node scripts/firmware.mjs mod ./mods/examples/look_around/manifest.json

# xsc mod.xsb
# xsc check.xsb
# xsc mod/config.xsb
# xsl look_around.xsa
[stack-chan] MOD preflight: xs_esp32 9.0.0+stackchan.1, XS 17.8.0, xs=0xfa0000/262144
[stack-chan] MOD installed and verified: .../look_around.xsa
```

## (オプショナル)フラッシュ領域の消去

MODを書き込み後、MODを書き込む前の挙動に戻したい時は、次のコマンドで書き込んだMODを消去することができます。

> [!NOTE]  
> コマンドを実行するとMODの領域だけでなく、フラッシュ領域全体を消去します。  
> Preferenceを使って設定値を書き込んでいる場合、その設定も消去されることに注意してください。  
> また、コマンド実行後は再度ホストの書き込みが必要になります。  

```console
$ npm run erase-flash

> stack-chan@0.2.1 erase-flash
> esptool.py erase_flash

esptool.py v4.8.dev4
Found 2 serial ports
Serial port /dev/cu.usbserial-01F05597
Connecting....
Detecting chip type... Unsupported detection protocol, switching and trying again...
Connecting.........
Detecting chip type... ESP32
Chip is ESP32-D0WDQ6-V3 (revision v3.0)
Features: WiFi, BT, Dual Core, 240MHz, VRef calibration in efuse, Coding Scheme None
Crystal is 40MHz
MAC: 8c:aa:b5:81:6c:1c
Uploading stub...
Running stub...
Stub running...
Erasing flash (this may take a while)...
Chip erase completed successfully in 25.4s
Hard resetting via RTS pin...
```

## 次のステップ

- [mods/README_ja.md](../mods/README_ja.md): 同梱のサンプル MOD の紹介です。
- [API](./api_ja.md): ｽﾀｯｸﾁｬﾝの API ドキュメントです。
