# servo_selftest

首サーボの自己診断MOD。**1回の書込みで、電源・通信・フレーミング・実動作のどの層で失敗しているかを判定する**。

実機で「首が動かない」とき、原因の候補は複数ある。仮説ごとに書込みと再接続をやり直すと1サイクル数分かかるため、まずこのMODを書き込んで層を特定する。`npm run mod` はhostの書込みより速い。

## 使い方

`firmware/` で次を実行する。

```text
npm run mod -- mods/examples/servo_selftest/manifest.json
```

起動すると自動で1回実行する。ドロワーの「Servo self-test」ボタンで再実行できる。

- 画面: 判定結果の1行サマリー（例 `Servo NG motion: moved 0 rad, reads 3/3`）
- シリアル: `[servo-selftest] {...}` の1行JSON（全ステップと診断カウンター）

## 判定

| 判定 | 意味 | 次に見るところ |
| --- | --- | --- |
| `ok` | 指令・応答・実動作がすべて確認できた | - |
| `NG power` | サーボ電源が有効になっていない、またはIOエキスパンダーに到達できない | 電源初期化（CoreS3はAXP2101とPY32） |
| `NG link` | バスから1フレームも復号できていない | 配線、UART番号とピン、ボーレート、サーボID |
| `NG framing` | フレームは届くが応答が欠落または壊れている | ノイズ、半二重の切り替え、チェックサム不一致の件数 |
| `NG motion` | 指令は受理され応答も返るのに首が動かない | Goal Time、目標位置の可動範囲、機構の干渉、トルク |

`NG motion` は #12 で実際に起きた失敗にあたる。位置指令自体は正しく、Goal Timeが長すぎて静止摩擦を超えなかった。指令が通っているかどうかだけを見ても判別できないため、このMODは毎回**実測位置を読み戻して**判定する。

## 出力の見かた

1行JSONの主なフィールド。

- `layer`: 上表の判定
- `movedRad`: 実測 yaw の最大値と最小値の差。`0` は物理的に動いていない
- `measurements`: 目標値と実測値の組
- `steps`: 各ステップの成否（`power` / `torque` / `move ...` / `read ...`）
- `servo`: ドライバーの診断カウンター（送信数、応答数、タイムアウト、バスの破棄バイト数など）

## 仕組み

公開APIの `robot.motion`（`setTorque` / `setPose` / `getRotation` / `getDriverDiagnostics`）だけを使う。ドライバー内部には触れないため、SCServo以外のドライバーでも同じ判定が動く。

判定ロジックとシーケンスは `selftest.js` にあり、Node のテストで検証している。

```text
node --test firmware/mods/examples/servo_selftest/selftest.test.mjs
```
