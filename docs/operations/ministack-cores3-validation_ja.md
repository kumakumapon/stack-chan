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

hostまたはMODの書込み後、既存のBLEセッションは使えない。テスト画面は切断を検知すると自動で再接続を試みる（最大3回、1秒・2秒・4秒間隔）。ブラウザーがデバイスの許可を保持していれば選択ダイアログは出ない。再接続できない場合は画面の表示に従ってブラウザーを更新し、「接続」を押し直す。`local peer session is closed` や `Heartbeat failed` が表示された場合も、MODを再書込みして `ready` に戻してから接続し直す。

## 接続テスト画面の起動

通常はChromeまたはEdgeで[MiniStack接続テスト（develop版）](https://kumakumapon.github.io/stack-chan/develop/web/ministack/)を開く。本体に`MiniStack: ready`が表示されてから、共有キーを入力して「接続」を押し、デバイス一覧で`STK`を選ぶ。

ローカルでWeb画面を確認する場合は、リポジトリ直下から次を実行し、表示されたURLの`/ministack/`を開く。

```powershell
cd web
npm.cmd run dev -- --host 127.0.0.1
```

Web Bluetoothを使うため、対応ブラウザーでHTTPSのGitHub Pages、またはlocalhostで開く。
## CoreS3 固有の要点

- AXP2101はSDK世代により `readByte`/`writeByte` または `readUint8`/`writeUint8` を提供する。ボード初期化済みの同じインスタンスを捕捉して使い、I2Cを二重初期化しない。
- 首のSCServoはUART1、TX=GPIO6、RX=GPIO7、1 Mbps、ID 1/2を使う。
- 位置指令はSCSCLのposition/time/speed全体を書き込む。CoreS3では公式ファームと同じGoal Time `20` で動作を確認した。
- サーボの書込みACKは一時的に欠落することがある。指令の送信完了を成功とし、ACK欠落だけでMODやBLEセッションを停止しない。状態読取りは応答を待つ。
- ここに挙げた値はコードの1か所（`firmware/host/modules/motion/m5stackchan-servo.ts`）に定数として持たせている。Goal Time は `M5STACKCHAN_SCSCL_GOAL_TIME_MS`。

## 動かないときの切り分け（書込みなし）

首が動かないときは、まず**再書込みをせずに**テスト画面の「サーボ診断を読む」を押す。`servo.diag` は読み取り専用で、動作要求の履歴を消費しない。表示は次の3つを分けて示す。

- **指令**: 最後に送った head.set の目標角
- **実測**: いま servo から読み戻した角度
- **カウンター**: 軸ごとの送信数・応答数・応答なし・送信失敗・目標位置・実測位置、バスの受信フレーム数・破棄バイト数・チェックサム不一致数・エコー数、サーボ電源の状態

読み方は次のとおり。

| 症状 | 読み取れること | 次の手 |
| --- | --- | --- |
| 電源が `未検出` または `OFF` | サーボ電源が入っていない | 電源初期化（AXP2101 / PY32）を疑う |
| 送信 > 0、応答 0、受信フレーム 0 | 指令は出ているがバスから何も返っていない | 配線、UART1/TX6/RX7、1 Mbps、ID 1/2 |
| 応答なしが増える、チェックサム不一致や破棄バイトが多い | 応答は届くが壊れている | ノイズ、半二重、ボーレート |
| 送信も応答もあるのに実測が変わらない | 指令は通っているが首が動いていない | Goal Time、可動範囲、機構の干渉、トルク |

層の特定だけを目的にするなら、[`servo_selftest` MOD](../../firmware/mods/examples/servo_selftest/README_ja.md) を書き込むと固定シーケンスが1回で同じ判定を出す。`npm run mod` はhostの書込みより速い。

## 1サイクルで残す記録

同じ条件で比べられるように、実機検証1回につき次を記録する。

```text
日時:
host commit:            (git rev-parse --short HEAD)
MOD commit:             (同上。MODだけ書き換えた場合も記録する)
書き込んだもの:          host / MOD / 両方
servo_selftest:         [servo-selftest] の1行JSON、または未実行
servo.diag:             指令 / 実測 / 軸カウンター / バスカウンター / 電源
実際の動作:             動いた角度、または動かなかった
判断:                   どの層の問題と見たか、次に試すこと
```

「動かなかった」だけの記録は次のサイクルで再利用できない。指令・応答・実測の3つが揃っていれば、次に確認すべき層が記録から決まる。

## テスト画面の使い方

`head.set` は絶対座標を指定する。同じ目標座標を繰り返しても、すでにその位置にいれば首は動かない。テスト画面の左右ボタンはこの点を避けるため、押すたびに `yawRad` を `-0.12` と `0.12` の間で切り替える。可動範囲を拡げる場合は、機構への干渉を確認したうえで段階的に増やす。

## 開発版Webツール

このforkの`develop`ブランチ由来のWebツールは [GitHub Pagesの開発版](https://kumakumapon.github.io/stack-chan/develop/web/) で公開する。ファームを書き込む前に、テスト対象のブランチとPages URLが対応していることを確認する。