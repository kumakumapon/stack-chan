# MiniStack と M5StackChan CoreS3 の実機検証メモ

MiniStack Local Peer Phase 0 を M5StackChan CoreS3 で検証した結果と、接続・首制御が失敗したときの復旧手順をまとめる。

## 確認済みの動作

- BLEで `STK` を選択してMiniStackへ接続できる。
- 表情の変更を実行できる。
- テスト画面の「首を左右に小さく動かす」で、左右へ交互に首を動かせる。

## 書込みと接続の順序

1. hostファームウェアを書き込む。
2. MiniStack MODを書き込む。
3. 本体に `MiniStack: ready` が表示されることを確認する。
4. ブラウザーを更新し、再度「接続」を押して `STK` を選択する。

hostまたはMODの書込み後、既存のBLEセッションは使えない。ブラウザーを更新して再接続する。`local peer session is closed` や `Heartbeat failed` が表示された場合も、MODを再書込みして `ready` に戻してから接続し直す。

## CoreS3 固有の要点

- AXP2101はSDK世代により `readByte`/`writeByte` または `readUint8`/`writeUint8` を提供する。ボード初期化済みの同じインスタンスを捕捉して使い、I2Cを二重初期化しない。
- 首のSCServoはUART1、TX=GPIO6、RX=GPIO7、1 Mbps、ID 1/2を使う。
- 位置指令はSCSCLのposition/time/speed全体を書き込む。CoreS3では公式ファームと同じGoal Time `20` で動作を確認した。
- サーボの書込みACKは一時的に欠落することがある。指令の送信完了を成功とし、ACK欠落だけでMODやBLEセッションを停止しない。状態読取りは応答を待つ。

## テスト画面の使い方

`head.set` は絶対座標を指定する。同じ目標座標を繰り返しても、すでにその位置にいれば首は動かない。テスト画面の左右ボタンはこの点を避けるため、押すたびに `yawRad` を `-0.12` と `0.12` の間で切り替える。可動範囲を拡げる場合は、機構への干渉を確認したうえで段階的に増やす。

## 開発版Webツール

このforkの`develop`ブランチ由来のWebツールは [GitHub Pagesの開発版](https://kumakumapon.github.io/stack-chan/develop/web/) で公開する。ファームを書き込む前に、テスト対象のブランチとPages URLが対応していることを確認する。