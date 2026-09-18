# MiniStack Local Peer PoC（Issue #10 / Phase 0）

このブランチは **M5StackChan CoreS3 実機で検証済み**。MiniStack BLE 接続、表情変更、左右の首動作を確認した。stack-chan 側 MOD とブラウザー検証クライアントを実装する。

イベントストリーム、バルク転送（写真・録音）、タッチ入力、`config.set` による設定変更は MOD 側（本ファイルが扱う範囲）で実装済み。ただし実機（CoreS3）での動作確認はまだ行っておらず、自動検証で担保しているのはプラットフォーム非依存のロジックのみ（「自動検証」参照）。MiniStack の Python backend、PC 側で常駐する Node ブリッジ、MCP は MiniStack 本体側リポジトリの実装であり、このリポジトリの範囲外・未着手のまま。音声認識（STT）は本 MOD には実装しない方針で、録音は生バイト列のまま PC に渡し、文字起こしは PC 側の責務とする（詳細は「制限事項」）。

## ビルド

`firmware/` で環境変数 `MINISTACK_SHARED_KEY`（16〜128文字）を設定し、次を実行する。値をチャットや Git に貼らない。

```text
node mods/examples/ministack/configure.mjs
npm run mod:build -- mods/examples/ministack/manifest.json
```

生成される `config.local.js` は Git 対象外。共有キーは MOD アーカイブにも含まれるため、このアーカイブを Pages、Release、CI artifact に公開しない。本体と PC は同じキーを使用する。HMAC は改ざん検出のみで、内容を暗号化しない。

この PoC はメッセージ単位の `authenticated` を利用する。従来ファームはこの属性を提供しないので、**このブランチの host ファームウェアが必要**。Issue の「無改造配布ファーム」という最終条件はまだ満たさない。共有キーで認証された過去の通信があるだけでは、非認証 broadcast を実行可能にしてはいけない。

## 実機試験（接続を依頼してから行う）

1. 現在の host/MOD、設定と復元用イメージを記録する。
2. このブランチで `npm run build:m5stackchan_cores3`、本体接続後 `npm run flash:m5stackchan_cores3`。
3. `npm run mod -- mods/examples/ministack/manifest.json` で専用 MOD を書き込む。
4. `web/` で `npm run dev -- --host 127.0.0.1`。Chrome/Edge で表示された localhost URL の `/ministack/` を開く。
5. 同じキーで接続し `STK`（本体が通知する BLE 名）を選ぶ。「笑顔」、「首を左右に小さく動かす」、停止、切断の順で確認する。
6. 不一致キーではコマンドが実行されないこと、接続断後は待機動作が再開しないことを確認する。
7. イベントストリーム・バルク転送（写真・録音）・タッチ判定・`config.set` は、この手順によるハードウェア確認がまだ行われていない。自動検証（プラットフォーム非依存ロジックのみ）で担保している状態。

本体の設定モードは Preferences 用 BLE を使用する。MiniStack は通常起動した MOD が BLE を一つだけ所有する。

## 現在のプロトコル

service: `io.github.kumakumapon.ministack`。Local Peer の確認付き `send` を使用する。
すべての payload に `v: 1` と `requestId`（英数字、`_`、`-`、最大64文字）。最初に `capabilities.get` で sessionId を取得し、以後はその sessionId を必須とする（`capabilities.get` のみ sessionId 不一致でも受け付ける）。

- `capabilities.get` / `state.get`: 能力・機器キュー状態。`state.get` は `running`（実行中コマンド種別）、`queued`（待機件数）に加え、`nextEventId`（次に発行される eventId）、`pendingEvents`（未確認イベント件数）を返す。
- `servo.diag`: サーボの診断。読み取り専用で、`state.get` と同様に動作要求の履歴を消費しない。最後に指令した目標角（`commanded`）、読み戻した実測角（`measured`、失敗時は `measuredError`）、ドライバーの診断カウンター（`servo`: 軸ごとの送信数・応答数・タイムアウト・目標位置・実測位置、バスの受信フレーム数と破棄・チェックサム不一致・エコー数、サーボ電源の状態、UART設定とGoal Time）を返す。ドライバーが診断を提供しない場合は `unsupported`、読み取りに失敗した場合は `diagnostics-failed`。
- `events.ack`: payload `{lastEventId}`。`lastEventId` 以下の確認済みイベントを MOD 側のバッファから破棄する。成功時 `{lastEventId}` を返す。`lastEventId` が MOD が発行したことのない ID（負値、または現在の `nextEventId` 以上）だと `invalid-ack`。履歴を消費しない。
- `events.since`: payload `{afterEventId}`。`afterEventId` より後の、まだ確認していないイベントを再生し `{events, gap}` を返す。`afterEventId` が未発行の ID（負値、または `nextEventId` 以上）だと `invalid-event-cursor`。`gap` の意味と対処は「イベントストリーム」参照。履歴を消費しない。
- `transfer.read`: payload `{transferId, offset, length}`。`length` は 1〜1024 バイト（生バイト換算）。成功時 `{transferId, offset, byteLength, chunk（base64文字列）, eof}` を返す。`transferId` が存在しない場合 `unknown-transfer`、`offset` が範囲外（0未満または転送データ長超過）で `invalid-offset`、`length` が範囲外で `invalid-length`。同じ offset の再読み込みは同じ結果を返す（冪等）。履歴を消費しない。詳細は「バルク転送」参照。
- `transfer.release`: payload `{transferId}`。成功時 `{released: true}`。`transferId` が存在しない場合 `unknown-transfer`。履歴を消費しない。
- `config.set`: payload に `speechVolume`（整数 0〜100）/`longPressMs`（整数 300〜2000）/`faceMotion`（真偽値）のいずれか1つ以上を含める。動作キューを待たず即時適用する（次の動作・発話の挙動を変える設定なので、キューで待たせると適用が遅れて意味を成さないため）。成功時 `{applied: {...適用した設定}}`。未対応キーが含まれると `unknown-setting`、値が範囲外・型不一致または対象キーが1つもないと `invalid-setting`、適用処理自体が失敗すると `config-failed`。既定値は `speechVolume=100`、`longPressMs=600`（`faceMotion` は明示的な既定値を持たず、`config.set` で指定されるまで変更されない）。履歴を消費しない。
- `head.set`: yawRad/pitchRad、durationMs 500〜3000。PoC 上限は yaw ±0.25 / pitch ±0.15 rad。機械的な全可動域を表す値ではない。トルクを有効化してから位置を指令する。成功時の yawRad/pitchRad は指令値であり、実測位置や移動完了の保証ではない。位置指令は送信完了で処理を進めるため、一時的なサーボ応答ACK欠落で操作全体は失敗しない。
- `face.set`: `emotion`（NEUTRAL/ANGRY/SAD/HAPPY/SLEEPY/DOUBTFUL/COLD/HOT）と／または `color`（`{key: 'primary'|'secondary', r, g, b}`、各チャンネルは整数 0〜255）。少なくとも一方の指定が必要。両方省略、`emotion` が非対応、または `color` の `key`／チャンネル値が不正だと `invalid-face`。
- `reaction.play`: happy / neutral / nod。
- `speech.say`: 1〜200文字。`interrupt`（真偽値、省略可）を受け付けるが、結果は常に `interruptHonoured: false` を返す。理由は「制限事項」参照。選択済み TTS を使用。
- `conversation.listen`: payload `{timeoutMs}`（整数 500〜15000、録音時間）。`capabilities.listen`（マイク搭載）が true でない機体では `unsupported`。録音開始時に `listen.started`、録音データをバルク転送に登録したのち `listen.finished` イベントを発行し、応答として `{transferId, byteLength, ...}` を返す。録音バイト列を文字起こしする機能は MOD 側にない（「制限事項」参照）。
- `photo.capture`: `capabilities.photo`（カメラ搭載）が true でない機体では `unsupported`。撮影しバルク転送に登録したのち `photo.ready` イベントを発行し、応答として `{transferId, byteLength, width, height, imageType}` を返す。
- `stop`: scope queue/all。待機動作と後続プリセット動作を取り消す。実行済みサーボ指令・発話の即時停止は保証しない。

動作コマンド（head.set / face.set / reaction.play / speech.say / conversation.listen / photo.capture）と `stop` には priority 0〜3、ttlMs 100〜10000（`stop` を除く）が必要。TTL は受信から実行開始までの有効時間。最大待機8件。

**セッション内256 request IDの履歴（records）を消費するのは、上記の動作コマンドと `stop` のみ。** 同一IDの再送は同じ応答を返し、異なる内容でのID再利用は `request-id-conflict` で拒否する。上限到達は `session-full`（再起動・再接続が必要）。ただし `stop` は履歴が満杯でも `session-full` では拒否されない例外で、履歴に空きがない場合はその `stop` 自体は記録されない（重複排除の対象にならないだけで、実行自体は行われる）。`capabilities.get` / `state.get` / `servo.diag` / `events.ack` / `events.since` / `transfer.read` / `transfer.release` / `config.set` はこの履歴を一切消費しない。読み取り系は毎回現在の状態を返し、`events.*` はイベントバッファ、`transfer.*` は転送レジストリ、`config.set` は設定値という、それぞれ別の（別の上限を持つ）リソースに対して動作するため。本体タッチの長押しによるローカル停止も、`receive` を経由せず内部の停止処理を直接呼ぶため履歴もキューも消費しない（物理ボタンの連打で PC 自身のコマンドが締め出されるのを防ぐための設計）。各要求には新しいIDを使う。本 PoC は長時間常駐用ではない。

PC クライアントは能力情報を受け取ると直ちに state.get を送り、その後1秒ごとに送る。初回能力情報要求からセッションID付き要求が届くまでは最大12秒待つ。接続確立後は正しいセッションIDの要求が3秒以上途絶えると閉じる。切断・停止後は MOD を再起動して新規 session を開始する。イベントストリームは実装済み（下記「イベントストリーム」参照）。自動再接続、接続断の即時検知は後続実装。

`response` は `{v, sessionId, requestId, ok, result|error}`。未対応要求は `unsupported`。MOD から push される `event` メッセージ（`type: 'event'`、`response` とは別種別）は `{v, sessionId, eventId, occurredAt, kind, data}`。

### エラーコード一覧

セッション・envelope 共通:

- `invalid-request-id`: requestId が英数字／`_`／`-`、1〜64文字の形式でない。
- `closed`: セッションが既に閉じられている。
- `unsupported-version`: `v` が1でない。
- `stale-session`: `sessionId` が現在のセッションと一致しない（`capabilities.get` は対象外）。
- `request-id-conflict`: 同じ requestId を異なる内容で再利用した。
- `unsupported`: 要求種別が存在しない、または対応する機能（events／transfers／config／servo診断／マイク／カメラ／listen）がこのビルド・機体に存在しない。

動作コマンド（head.set / face.set / reaction.play / speech.say / conversation.listen / photo.capture / stop）共通:

- `invalid-ttl`: `ttlMs` が100〜10000の整数でない。
- `invalid-priority`: `priority` が0〜3の整数でない。
- `queue-full`: 待機8件を超えた。
- `session-full`: セッション内履歴が256件に達した（`stop` を除く）。
- `expired`: 実行開始前に TTL が切れた。
- `cancelled`: `stop` またはローカル停止（タッチ長押し）でキャンセルされた。
- `execution-failed`: 実行中に内部エラーが発生した。具体的な理由（発話失敗・カメラ利用不可など）はトレースログにのみ残り、PC への応答には出ない。
- `servo-timeout`: サーボ通信がタイムアウトした。

種別ごとの入力検証エラー:

- `invalid-head`（head.set）: yawRad/pitchRad が有限数でない、または durationMs が500〜3000の整数でない。
- `invalid-face`（face.set）: emotion・color がともに未指定、emotion が非対応、または color の key が primary/secondary でない・r/g/b が0〜255の整数でない。
- `invalid-speech`（speech.say）: text が1〜200文字の文字列でない、または interrupt が真偽値でない。
- `invalid-listen`（conversation.listen）: timeoutMs が500〜15000の整数でない。
- `invalid-reaction`（reaction.play）: name が happy/neutral/nod のいずれでもない。
- `invalid-scope`（stop）: scope が queue/all のいずれでもない。

読み取り・設定・イベント・転送系:

- `diagnostics-failed`（servo.diag）: 診断の読み取りに失敗した。
- `unknown-setting`（config.set）: 対応しないキーが含まれる。
- `invalid-setting`（config.set）: 値が範囲外・型不一致、または対象キーが1つもない。
- `config-failed`（config.set）: 設定の適用処理自体が失敗した。
- `invalid-ack`（events.ack）: `lastEventId` が MOD が発行したことのない ID。
- `invalid-event-cursor`（events.since）: `afterEventId` が MOD が発行したことのない ID。
- `unknown-transfer`（transfer.read / transfer.release）: `transferId` が存在しない（解放済み・TTL切れ・別の撮影で置き換え済みを含む）。
- `invalid-offset`（transfer.read）: `offset` が0未満、または転送データ長を超える。
- `invalid-length`（transfer.read）: `length` が1〜1024バイトの範囲外。

## イベントストリーム

MOD は完了・失敗したコマンドや物理イベント（タッチなど）を `event` メッセージとして push する。配信は**少なくとも1回**（at-least-once）で、PC は `eventId` で重複排除する。`command.finished`/`command.rejected` イベントは `receive` の応答と同じ内容を運ぶため、応答（`response`）を1回取りこぼしても、完了通知は最終的にちょうど1回として扱える。

- `eventId` は**起動セッション内でのみ単調増加**する。MOD の再起動（BLE 再接続でセッションが再確立される）で 1 から振り直される。push される event には常に `v` と `sessionId` が含まれるため、PC は自分が保持している現在の sessionId と異なるイベントを、カーソルに対する重複排除の対象にせず単純に破棄しなければならない。別セッションの eventId を現在のカーソルと比較すると、たまたま数値が一致・逆転して誤判定する。
- MOD が保持する未確認イベントは最大32件（`EVENT_BUFFER`）まで。`events.ack` で確認済みの分は破棄される。あふれた場合は**最も古いイベントから**破棄される（判断待ちなのは最新のイベントであるため）。この破棄は記録され、`events.since` の応答で `gap: true` として返る。
- **`gap: true` を受け取ったら、失われたイベントは二度と手に入らない。** イベントから推測していた状態（実行中だったコマンドが完了したか失敗したか等）はすべて信頼できなくなるので、PC は `state.get` を呼んで状態を再同期しなければならない。これが本ドキュメントで最も重要な規則。
- イベント種別（`EVENT_KINDS`）: `ready`, `error`, `touch`, `speech.started`, `speech.finished`, `listen.started`, `listen.finished`, `photo.ready`, `command.finished`, `command.rejected`。すべて実際に発行される。issue #10 が挙げていた `connection.changed` は意図的に持たない。接続したことは `ready` が伝えており、切断したことは伝えようがない（伝える経路そのものが失われているため）。届かない種別を宣言しても、待つ側を誤らせるだけであるため。

## バルク転送（写真・録音）

写真・録音データは Local Peer のメッセージ envelope（1メッセージ最大 2 KiB）に収まらないため、`response`/`event` に直接載せない。かといって認証されない別チャンネルを新設するのも避け、同じ認証済みチャンネル上で `transfer.read` により PC 側がチャンクを引き取る（pull）方式にした。

- 1チャンクの最大は生バイトで1024バイト（`TRANSFER_CHUNK_MAX`）。base64 化すると約4/3倍に膨らむため、1024バイトを base64 にした約1366文字＋envelope の他フィールドが 2 KiB の envelope に収まるよう、この値になっている。
- `transfer.read` は offset 指定の読み取りで冪等。同じ offset を読み直しても同じ結果が返るため、応答を1回取りこぼしても失うのはそのチャンク1つ分だけで済む。
- 種別（kind、`photo`／`audio`）ごとに1件しか保持しない。`photo.capture` を新しく実行すると直前の写真の transfer は自動的に解放される（`photo` と `audio` は別 kind なので、写真と録音は同時に保持できる）。カメラフレームは専用バッファを握っているため、解放時に確実にクローズされる。
- 読み終えたら `transfer.release` で明示的に解放する。解放を忘れた場合も TTL＝60秒（60000ms）で自動的に破棄・解放される。セッションが閉じられると残っている transfer もすべて解放される。

## タッチ入力

MOD はタッチパネルの押下（press）／離す（release）イベントから短押し・長押しを判定する。判定は release を待たず、**指が触れたままの状態で**行う（`longPressMs`、既定600ms、`config.set` で300〜2000msの範囲に変更可、その時間が経過した時点で長押しと判定する）。release を待ってから判定すると、長押しを即時停止ボタンとして使う意味がなくなるため。

- 長押しはそれ自体が停止動作を兼ねる: `touch`（`press: 'long'`）イベントを発行すると同時に、動作キューを取り消し（この停止は `stop` 要求としては扱われず、request ID の履歴を消費しない）、録音中であればマイクの停止を試みて録音を中断する（マイクドライバが停止をサポートしない場合は何もしない）。
- 短押しは `touch`（`press: 'short'`）イベントを発行するのみで、それ自体は何も止めない。短押しの意味づけは PC 側の責務。

## 制限事項

- `speech.say` は `interrupt` を受け付けるが、結果は常に `interruptHonoured: false`。ファームウェアの MOD 向け音声 API には、既にスピーカーへストリーミング中の発話を止める手段が存在しないため、`interrupt: true` は受理はされるが実際には何も中断しない。
- `transcript` イベントは存在しない。MOD 自体は音声認識を持たない。`conversation.listen` は録音した生バイト列をバルク転送で渡すだけで、文字起こしは PC 側が行う（Issue の「audio.record → PC 側 STT」というフロー通り）。これは Issue #10 に挙げられたイベント一覧との意図的な差分。

## 自動検証

```text
node --test firmware/mods/examples/ministack/controller.test.mjs firmware/mods/examples/ministack/outbox.test.mjs firmware/mods/examples/ministack/protocol.test.mjs
```

`controller.test.mjs`（要求ごとのキュー・履歴・診断・首制御ロジック）、`outbox.test.mjs`（イベントバッファ・転送レジストリ・送信ポンプ）、`protocol.test.mjs`（`receive` を通した各要求の検証とエラーコード）の3ファイルはいずれも `firmware/package.json` の `test:unit` に登録済みで、通常の `npm run test:unit`（`npm test`）実行時にまとめて走る。

Local Peer のメッセージ認証テストは既存 XS manifest `host/modules/connectivity/__tests__/local-peer-service-xs` に追加。これらの Node テストはプラットフォーム非依存ロジックの検証であり、ハードウェア動作を保証しない。イベントストリーム・バルク転送・タッチ判定・`config.set` を含め、いずれもこのロジック検証のみ済んでおり、CoreS3 実機での動作は未確認。

### 首が動かないときの切り分け

テスト画面の「サーボ診断を読む」で `servo.diag` を読む。**再書込みは不要**。指令・実測・カウンターを並べて表示するため、「指令が出ていない」「応答が返っていない」「応答は返るが動いていない」を区別できる。層の特定だけなら [`servo_selftest` MOD](../servo_selftest/README_ja.md) が1回の書込みで同じ判定を出す。

### 首制御の実機確認

M5StackChan CoreS3 で、公式互換の SCSCL Goal Time（20）と position/time/speed の完全な書込みにより、左右の首動作を確認した。テスト画面のボタンは押すたびに左右の目標位置を交互に送る。

接続失敗時の復旧手順、切り分け手順、1サイクルで残す記録のテンプレートは[実機検証メモ](../../../../docs/operations/ministack-cores3-validation_ja.md)を参照。
