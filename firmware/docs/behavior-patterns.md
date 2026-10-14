# 表情と行動パターン（CoreS3）

標準ファームウェアには表情16種類、短いリアクション24種類、演技12種類、首のモーション16種類があります。既存の表情の数値IDとパターン名は維持しています。

## 本体で試す

- ドロワーの「診断」→「表情」で全16種類を選択します。
- 「遊ぶ」→「リアクション」で24種類の短い仕草を選択します。
- 「遊ぶ」の朝の体操・探検・お祝い・照れながら挨拶・ひらめき・おやすみ・ありがとう・またねで、新しい演技を再生します。

新しい演技8種類は音声を必要としないため、ローカルTTSでも利用できます。演技終了またはキャンセル時には、表情・手・効果・首を元の状態に戻します。会話中は口パクを優先します。

待機時には従来のうなずき・考える・あくびに、好奇心・照れ・ウインク・ほっとする・耳を傾ける・きょろきょろ・伸び・うとうとを加えました。同じ仕草を連続で選びません。静かな時間帯と低電池時は従来どおりあくびに限定します。会話・音声・演技・MOD・一時的な待機抑制が有効な間は自動再生を控えます。

## MOD・会話ツールから使う

```js
robot.reaction.play('curious', { intensity: 0.3 })
robot.performance.play('morning-stretch')
robot.reaction.cancel()
robot.performance.cancel()
```

会話ツール `stackchan.face.setEmotion`、`stackchan.react`、`stackchan.perform` はカタログから選択肢を公開します。Webシミュレーターの操作パネルにも全リアクション・演技を表示します。

| 種類 | 追加した名前 |
| --- | --- |
| 表情 | SURPRISED, CURIOUS, SHY, EXCITED, RELAXED, WORRIED, CONFIDENT, WINK |
| リアクション | surprised, curious, shy, laugh, wink, love, proud, worried, apologize, relieved, listening, look-around, stretch, doze, wake-up, goodbye |
| 演技 | morning-stretch, curiosity-tour, celebrate, shy-hello, thinking-hard, sleepy-bedtime, thank-you, goodbye |
| 首のモーション | bow, double-nod, peek-left, peek-right, scan, stretch |

追加した目・口の描画は標準のSimpleFace向けです。DogFaceは共通のまぶたを使い、画像の顔は各スプライト／アバターパックの対応表情に従います。画像素材自体は増やしていません。

首は既存の制限（yaw ±π/6、pitch ±π/8、最短移動150ms）の範囲で動きます。実機では「遊ぶ」から各演技を再生し、可動域、サーボ音、終了時と中断時の復元、会話中の口パクを確認してください。
