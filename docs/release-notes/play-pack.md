# あそびパック / Play pack

本体の「ミニアプリ」に、ｽﾀｯｸﾁｬﾝと向き合って遊ぶ3つのアプリを追加しました。ネット接続や音声認識は不要です。

- **じゃんけん**：グー・チョキ・パーで勝負し、勝った側が「あっちむいてホイ」で指します。先に2点取った側の勝ちです。ドロワーの「遊ぶ」→「じゃんけん」でも開きます。以前は手のアニメーションが繰り返すだけでした。
- **はやおし**：画面が緑になったら頭か画面をタップする反射神経ゲームです。5回で1セットで、自己ベストを保存します。合図前のタップはフライングになります。
- **おみくじ**：箱を振って、大吉〜末吉、ラッキーアクション、ラッキーカラーを引きます。時計が同期済みなら1日1回で、同じ日は同じ結果を表示します。

首の動きは、じゃんけんの「動きON」を選んだときだけです（初期値OFF）。会話中や別の動作中は首を動かしません。上下を向く `look-up` / `look-down` リアクションも追加しました。
旧4 MB M5Stack向けにはフラッシュ容量を守るため含めません。実機の首の向き・音量・タッチの体感は実機で確認してください。

Open **Mini Apps → JANKEN / QUICK TAP / FORTUNE**. Janken is rock-paper-scissors followed by "look over there": the winner points, and a matching glance scores; first to two wins. Quick Tap measures your reaction to a green signal over five rounds and keeps a personal best; tapping early is a false start. Fortune draws one slip a day once the clock is synced. Head motion is opt-in in Janken and pauses during conversations or other activity. New `look-up` / `look-down` reactions are available everywhere reactions are. The classic 4 MB M5Stack does not include the play pack.
