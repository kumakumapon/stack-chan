# リズムまねっこ / Rhythm Imitation

本体の「ミニアプリ」から「リズムまねっこ」を開いて「開始」を押します。音と青い点滅のお手本を見聞きしたあと、頭のタッチパネルか画面の顔のパッドを短くタップして、同じ間隔のリズムを返します。3拍から6拍までの6回をクリアすると「リズム名人！」になります。ネット接続や音声認識は不要です。

- 最初のタップを基準に、隣り合う拍の間隔を判定します。お手本が終わってから始めるまでの反応速度は採点しません。12秒間入力がない場合は再挑戦の画面になります。
- 判定の余裕は各間隔の±25%（最低150 ms）。頭タッチは50 ms周期で検出し、押してから離すまで300 ms以内のタップを受け付けます。長押しやなでる操作は回答になりません。
- 「お手本」で同じ問題を再生できます。失敗後の「もう一度」も同じ回から再挑戦します。連打してもクリアできません。
- 「音OFF」でも点滅だけで遊べます。会話・別の音声・ラジオなどの使用中は音を出しません。本体のスピーカー音量設定も尊重します。
- 成功すると画面の顔が笑い、パッドが緑になります。サーボはゲームから動かしません。
- 左上の戻るボタンでいつでも終了できます。ゲームのタイマー・頭タッチ購読・短音を解放し、他の再生は停止しません。
- Virtual Petと併用できます。今回のクリア結果はMini App結果イベントとして通知しますが、Petへの経験値連携は追加していません。

CoreS3以外に頭タッチパネルがない機種でも、LCDタッチのある構成なら画面のパッドで遊べます。Webシミュレーターでは「頭をタップ」ボタンとLCDの両方を使えます。実機の音量、入力遅延、判定の体感は実機で確認してください。

Open **Mini Apps → RHYTHM → Start**. Watch/listen to the pulses, then repeat their spacing with short taps on the head or LCD face pad. Six rounds progress from three to six beats. The first tap anchors your answer; adjacent gaps allow ±25% (at least 150 ms). Replay keeps the current pattern, Muted retains the visual cues, and Back releases the game's input, timers and owned audio. No network or speech recognition is required.
