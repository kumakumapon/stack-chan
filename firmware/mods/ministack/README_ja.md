# MiniStack Local Peer PoC（Issue #10 / Phase 0）

このブランチは **M5StackChan CoreS3 実機で検証済み**。MiniStack BLE 接続、表情変更、左右の首動作を確認した。stack-chan 側 MOD とブラウザー検証クライアントを実装する。MiniStack の Python backend、Node 常駐ブリッジ、MCP、音声認識、写真転送、タッチイベントは未実装。

## ビルド

`firmware/` で環境変数 `MINISTACK_SHARED_KEY`（16〜128文字）を設定し、次を実行する。値をチャットや Git に貼らない。

```text
node mods/ministack/configure.mjs
npm run mod:build -- mods/ministack/manifest.json
```

生成される `config.local.js` は Git 対象外。共有キーは MOD アーカイブにも含まれるため、このアーカイブを Pages、Release、CI artifact に公開しない。本体と PC は同じキーを使用する。HMAC は改ざん検出のみで、内容を暗号化しない。

この PoC はメッセージ単位の `authenticated` を利用する。従来ファームはこの属性を提供しないので、**このブランチの host ファームウェアが必要**。Issue の「無改造配布ファーム」という最終条件はまだ満たさない。共有キーで認証された過去の通信があるだけでは、非認証 broadcast を実行可能にしてはいけない。

## 実機試験（接続を依頼してから行う）

1. 現在の host/MOD、設定と復元用イメージを記録する。
2. このブランチで `npm run build:m5stackchan_cores3`、本体接続後 `npm run flash:m5stackchan_cores3`。
3. `npm run mod -- mods/ministack/manifest.json` で専用 MOD を書き込む。
4. `web/` で `npm run dev -- --host 127.0.0.1`。Chrome/Edge で表示された localhost URL の `/ministack/` を開く。
5. 同じキーで接続し `STK`（本体が通知する BLE 名）を選ぶ。「笑顔」、「首を左右に小さく動かす」、停止、切断の順で確認する。
6. 不一致キーではコマンドが実行されないこと、接続断後は待機動作が再開しないことを確認する。

本体の設定モードは Preferences 用 BLE を使用する。MiniStack は通常起動した MOD が BLE を一つだけ所有する。

## 現在のプロトコル

service: `io.github.kumakumapon.ministack`。Local Peer の確認付き `send` を使用する。
すべての payload に `v: 1` と `requestId`（英数字、`_`、`-`、最大64文字）。最初に `capabilities.get` で sessionId を取得し、以後はその sessionId を必須とする。

- `capabilities.get` / `state.get`: 能力・機器キュー状態。
- `head.set`: yawRad/pitchRad、durationMs 500〜3000。PoC 上限は yaw ±0.25 / pitch ±0.15 rad。機械的な全可動域を表す値ではない。トルクを有効化してから位置を指令する。成功時の yawRad/pitchRad は指令値であり、実測位置や移動完了の保証ではない。位置指令は送信完了で処理を進めるため、一時的なサーボ応答ACK欠落で操作全体は失敗しない。
- `face.set`: emotion（NEUTRAL/ANGRY/SAD/HAPPY/SLEEPY/DOUBTFUL/COLD/HOT）。色指定は未対応。
- `reaction.play`: happy / neutral / nod。
- `speech.say`: 1〜200文字。割り込みは未対応。選択済み TTS を使用。
- `stop`: scope queue/all。待機動作と後続プリセット動作を取り消す。実行済みサーボ指令・発話の即時停止は保証しない。

動作コマンドには priority 0〜3、ttlMs 100〜10000 が必要。TTL は受信から実行開始までの有効時間。最大待機8件、動作要求の履歴はセッション内256 request IDまで保持する。動作要求の重複IDは同じ応答、異なる内容でのID再使用は拒否。state.get / capabilities.get は履歴を消費せず、毎回現在の状態を返す。各要求には新しいIDを使う。上限到達は `session-full`（再起動・再接続が必要）。本 PoC は長時間常駐用ではない。

PC クライアントは能力情報を受け取ると直ちに state.get を送り、その後1秒ごとに送る。初回能力情報要求からセッションID付き要求が届くまでは最大12秒待つ。接続確立後は正しいセッションIDの要求が3秒以上途絶えると閉じる。切断・停止後は MOD を再起動して新規 session を開始する。自動再接続、接続断の即時検知、非同期 event ストリームは後続実装。

`response` は `{v, sessionId, requestId, ok, result|error}`。未対応要求は `unsupported`。

## 自動検証

```text
node --test firmware/mods/ministack/controller.test.mjs
```

Local Peer のメッセージ認証テストは既存 XS manifest `host/modules/connectivity/__tests__/local-peer-service-xs` に追加。Node の仲裁テストはハードウェア動作を保証しない。

### 首制御の実機確認

M5StackChan CoreS3 で、公式互換の SCSCL Goal Time（20）と position/time/speed の完全な書込みにより、左右の首動作を確認した。テスト画面のボタンは押すたびに左右の目標位置を交互に送る。
