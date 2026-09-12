# Code Reading Guide

この資料は、初見のエンジニアが Stack-chan のコードベースを効率的に理解するための読み込み順序を説明します。

## 最初に読む5ファイル（優先度順）

### 1. `firmware/host/app/main.ts` ⭐ **Critical**

**理由**：ファームウェア全体のエントリーポイント。システム起動フローと主要な処理の流れが理解できます。

**注目する関数・クラス**：
- `main()` - 起動フロー全体
- `loadAppBehaviors()` - MOD ロード
- `startHostBootServices()` - ネットワーク初期化
- `createStackchanContext()` - 依存関係の組み立て

**読むべき流れ**：
```
96行: async function main()
  → 101行: startStackchanDock()
  → 104-105行: localization, timezone 設定
  → 107-111行: アプリ動作ロード・起動フロー判定
  → 122-127行: Boot Services 起動
  → 130-136行: Context 作成
  → 140-144行: MOD onContextCreated() 実行
```

### 2. `firmware/host/app/compose.ts` ⭐ **Critical**

**理由**：Dependency Injection パターンで、どのドライバ・TTS エンジン・UI が選択されるかが理解できます。

**注目する関数・クラス**：
- `createStackchanContext()` - コンポーネント組み立て
- `drivers` Map (L125-135) - モーション実装の選択肢
- `ttsEngines` Map (L136-144) - TTS エンジンの選択肢
- `uiControllers` Map (L145-156) - UI テーマの選択肢

**読むべき流れ**：
```
125-135行: ドライバの種類（scservo, m5stackchan, dynamixel等）
136-144行: TTS エンジンの種類（local, openai, voicevox等）
145-156行: UI テーマの種類（dog, simple, image）
160-192行: Preferences から実装を解決・インスタンス化
194-210行: 入力・センサ・接続の初期化
253-271行: Context パラメータをまとめて作成
```

### 3. `firmware/host/app/capabilities.ts` ⭐ **Critical**

**理由**：MOD が利用可能な全 API（StackchanContext）の型定義。これを理解すれば MOD 開発時に何ができるかがわかります。

**注目する型**：
- `StackchanContext` - メインの Context インターフェース
- `RobotUI` - 顔・UI 制御 API
- `MotionCapability` - モーション API
- `AudioCapability` - 音声 API
- `InputCapability` - 入力 API
- `ConnectivityCapability` - ネットワーク API

**読むべき構成**：
- 各キャパビリティのメソッド・プロパティシグネチャ
- JSDoc コメント（使用例が書かれている）

### 4. `firmware/mods/examples/look_around/mod.js` ⭐ **Critical**

**理由**：最小限の MOD 実装。`onContextCreated()` の基本パターンがわかります。

**全コード**（35行）を読んで理解すべき点：
```javascript
1. export function onContextCreated(robot) - エントリーポイント
4-21行: ボタンイベントハンドラ登録
22-32行: タイマーで周期的にモーション制御
33行: Timer.repeat() で実行開始
```

**実行フロー**：
```
A ボタン押下
  → robot.input.button.a.onEvent コール
  → isFollowing フラグ切り替え
  → タイマーループで lookAt() または lookAway() 実行
```

### 5. `firmware/host/modules/preferences/loadPreference.ts` ⭐ **Important**

**理由**：デバイスの設定（preferences）がどのように読み込まれるか。ユーザーが設定を変更した場合の流れが理解できます。

**注目する関数・定数**：
- `loadPreferences(category: PreferenceDomain)` - カテゴリ別設定ロード
- `loadModConfig()` - MOD カスタム設定ロード
- `PREFERENCE_DOMAINS` (L28-37) - 設定のカテゴリ一覧

**読むべき流れ**：
```
39-77行: loadPreferences() の優先度順
  1. mc/config（ビルド時定数）
  2. mod/config（MOD カスタム設定）
  3. Preference.get()（デバイス保存値）
  → マージして返す
```

---

## 次に読むファイル

### エントリーポイント・起動フロー

| ファイル | 役割 | なぜ読むか |
| --- | --- | --- |
| `firmware/host/app/app-launch.ts` | 起動画面・ユーザー選択フロー | どの MOD を実行するか、どうやって選ぶか |
| `firmware/host/app/default-behavior/on-launch.ts` | デフォルト起動挙動 | キャリブレーション、初期化画面 |
| `firmware/host/app/default-behavior/on-context-created.ts` | デフォルト UI・ジェスチャ設定 | 標準の動作・ボタン動作 |
| `firmware/host/app/mod-manager.ts` | MOD インストール UI | ユーザーが MOD を選んでインストール |

### リクエスト処理の追い方

#### MOD 起動フロー

```
1. main.ts: main()
   ↓
2. loadAppBehaviors()
   → app-behavior-resolver.ts: resolveAppBehaviors()
     → Modules.importNow('mod/behavior')
       ↓ MOD がデフォルト動作をオーバーライド
   ↓
3. createStackchanContext()
   → compose.ts: createStackchanContext()
     ↓
4. runContextCreatedBehaviors()
   → app-behavior.ts: runContextCreatedBehaviors()
     ↓
5. MOD.onContextCreated(context, options)
   ↓
6. 🎯 MOD 実行開始
```

#### UIボタンイベント処理フロー

```
User presses Button A
  ↓
Firmware interrupt handler
  ↓
globalEnv.button.a.onChanged / onEvent
  ↓
MOD's button.a.onEvent handler
  ↓
MOD logic (e.g., robot.motion.lookAt())
  ↓
runtime-motion.ts: MotionController.lookAt()
  ↓
Motion driver (e.g., scservo-driver.ts)
  ↓
Servo motor rotation
```

### DB 処理の追い方

#### Preference（設定）読込・保存フロー

```
MOD が TTS エンジン変更したい
  ↓
web/preference/ UI: "Select OpenAI"
  ↓
ble-preference-client.ts: sendPreference()
  → BLE TX characteristic に JSON 送信
  ↓
firmware/host/modules/connectivity/preference-server.ts
  ↓
Preference.set(DOMAIN.tts, 'type', 'openai')
  ↓
Preference XS (内部フラッシュ/NVRAM に保存)
  ↓
次起動時: loadPreference.ts が読み込み
  ↓
compose.ts で TTS エンジン再選択
```

### 非同期処理の追い方

#### 音声再生（TTS）フロー

```
MOD: await robot.audio.say("Hello")
  ↓
runtime-audio.ts: StackchanRuntimeAudio.say()
  ↓
tts-openai.ts: OpenAITTS.synthesize(text)
  → HTTP request: OpenAI API
  ↓
HTTP response: audio bytes
  ↓
speaker.ts: Speaker.write(audioBuffer)
  ↓
Speaker device (物理スピーカー)
  ↓
Promise resolve
  ↓
MOD 継続実行
```

#### 複数タスク（Promise.all）フロー

```
MOD: 
  const [audio, pose] = await Promise.all([
    robot.audio.synthesizeAndPlay("Text"),
    robot.motion.setPose(target, time)
  ])
  
  ↓ 両方が完了するまで待機
  ↓ 並列実行されない（シリアル動作）
  ↓ いずれかが reject すると全体 reject
```

### 認証処理の追い方

**Firmware 側**：
- API キーは `preferences.ai.token`、`preferences.tts.token` に保存
- MOD が読み取り: `options.config.ai.token`
- ネットワーク通信時にヘッダに付加

**Web 側**：
- BLE 設定サーバ（preferences-server.ts）に認証なし
- 前提：同じ物理場所（信頼できるネットワーク）

### エラー処理の追い方

#### 例：TTS エンジン不在時

```
preferences.tts.type = 'unknown'
  ↓
compose.ts L164-186: ttsEngines.get(ttsKey)
  ↓
ttsKey = 'unknown', TTS = undefined
  ↓
throw new Error('type "unknown" does not exist')
  ↓
MOD 起動失敗
  ↓
main.ts L146-155: catch ブロック
  → context.lifecycle.close()
  → dockRuntime?.close()
  ↓
Device リセット / エラー画面表示
```

---

## 主要ユースケース別コードマップ

### ユースケース1：MOD 開発者が Blockly でビジュアルプログラミング

```
User Flow:
  /web/editor/index.html
    ↓
  src/entries/editor.tsx
    ↓
  src/features/project-editor/project-editor-page.tsx
    ├─ Blockly Workspace 初期化
    │   blockly-workspace.tsx: BlocklyWorkspaceController
    │   └─ editor/blocks.mjs: カスタムブロック定義
    │
    ├─ ユーザーがブロック組み立て
    │   workspace.snapshot()
    │   └─ コード生成
    │
    ├─ "Build MOD" ボタン
    │   use-project-editor.ts: buildMod()
    │   ↓
    │   services/mod-builder/mod-build-service.ts
    │   └─ Web Worker 経由で WASM Moddable tools 実行
    │       mod-build.worker.ts
    │       └─ editor/mod-builder.mjs
    │           └─ mc.js / mc.wasm (Moddable runtime)
    │               ├─ プロジェクトファイル作成
    │               ├─ xsc（コンパイル）
    │               ├─ xsa（アーカイブ化）
    │               └─ .xsa バイナリ返却
    │
    ├─ "Test in Simulator" ボタン
    │   src/features/simulator/simulator-page.tsx
    │   ├─ WASM ファームウェア読み込み
    │   ├─ Bridge で MOD 実行環境構築
    │   └─ three.js で 3D 描画開始
    │
    └─ "Install to Device" ボタン
        services/esptool/esptool-adapter.ts
        ├─ USB 接続
        ├─ esptool-js 経由でファイル送信
        └─ Device フラッシュ

Key Files:
  /web/editor/blocks.mjs                    → カスタムブロック定義
  /web/src/features/project-editor/        → エディタUI全体
  /web/src/services/mod-builder/           → ビルドサービス
  /web/src/services/simulator/             → シミュレータ
```

### ユースケース2：MOD 作者が TypeScript で実装・ビルド

```
Developer Flow:
  firmware/mods/examples/mymod/
  ├─ manifest.json                  ← MOD の定義（どのファイルをビルドするか）
  └─ mod.ts                         ← TypeScript 実装
      export function onContextCreated(context, options) {
        context.motion.lookAt(...)
        context.audio.say(...)
      }

Build & Flash:
  firmware/
  $ npm run mod -- mods/examples/mymod/manifest.json
    ↓
  scripts/run-mcconfig.mjs
  └─ Moddable SDK (mcrun / mcpack)
      ├─ mod.ts コンパイル
      ├─ リソース (画像、フォント) 埋め込み
      ├─ XS アーカイブ生成
      └─ dist/bin/mymod.xsa

  $ npm run mod-install -- firmware/dist/bin/mymod.xsa
    ↓
  esptool 経由でデバイスに送信
    ↓
  Device リセット → MOD 実行開始

Key Files:
  /firmware/mods/examples/*/mod.ts          → MOD 実装例
  /firmware/host/app/capabilities.ts        → 利用可能 API（型定義）
  /firmware/docs/api.md                     → API 仕様
```

### ユースケース3：ロボット本体にファームウェアをフラッシュ

```
User Flow:
  /web/flash/index.html
    ↓
  src/entries/flash.tsx
    ↓
  src/features/firmware-install/firmware-install-page.tsx
    ├─ "Select USB Device" ボタン
    │   ↓ Web Serial API
    │   port = await navigator.serial.requestPort()
    │
    ├─ Device 接続
    │   services/esptool/esptool-adapter.ts
    │   └─ ESPLoader 作成 → connect()
    │
    ├─ Chip 検出
    │   loader.detectChip()
    │   └─ "M5StackChan CoreS3" を判定
    │
    ├─ Firmware ファイル選択
    │   /web/flash/manifest_esp32_m5stackchan_cores3.json
    │   └─ ビルド済みバイナリファイル参照
    │
    ├─ Erase & Write
    │   loader.writeFlash() で各パーティション書き込み
    │   ├─ bootloader.bin @ 0x0
    │   ├─ partitions.bin @ 0x8000
    │   ├─ firmware.bin @ 0x10000
    │   └─ Progress コールバック
    │
    └─ Reset
        Device リセット → 新しいファームウェアで起動

Key Files:
  /web/src/features/firmware-install/       → フラッシャー UI
  /web/src/services/esptool/                → USB 通信
  /web/src/services/firmware-install/       → フラッシュロジック
  /web/flash/                               → 各ボード用マニフェスト
```

### ユースケース4：ユーザーが Web Bluetooth で Wi-Fi 設定

```
User Flow:
  /web/preference/index.html
    ↓
  src/entries/preference.tsx
    ↓
  src/features/preferences/preferences-page.tsx
    ├─ "Connect via BLE" ボタン
    │   ↓ Web Bluetooth API
    │   device = await navigator.bluetooth.requestDevice()
    │
    ├─ BLE サーバ接続
    │   services/preferences/ble-preference-client.ts
    │   ├─ 接続
    │   └─ Nordic UART Service UUID
    │
    ├─ Wi-Fi SSID/Password 入力
    │   ↓ Form submission
    │
    ├─ BLE 送信
    │   client.sendPreference({
    │     domain: 'wifi',
    │     key: 'ssid',
    │     value: 'MyNetwork'
    │   })
    │   ↓ JSON → BLE TX characteristic へ書き込み
    │
    ├─ Device 側 受信
    │   firmware/host/modules/connectivity/preference-server.ts
    │   ├─ BLE RX characteristic から受信
    │   └─ Preference.set() で永続化
    │
    └─ 次起動時
        main.ts: loadPreferenceConfig()
        ↓ Preference から Wi-Fi 設定読み込み
        ↓ Network 接続

Key Files:
  /web/src/features/preferences/            → 設定 UI
  /web/src/services/preferences/            → BLE クライアント
  /firmware/host/modules/connectivity/      → BLE サーバ
```

---

## ファイル重要度一覧

### 🔴 Critical（必ず読む）
- `firmware/host/app/main.ts`
- `firmware/host/app/compose.ts`
- `firmware/host/app/capabilities.ts`
- `firmware/mods/examples/look_around/mod.js`
- `web/vite.config.ts`
- `web/src/entries/home.tsx`

### 🟠 Important（段階的に読む）
- `firmware/host/app/app-behavior.ts`
- `firmware/host/app/runtime-context.ts`
- `firmware/host/modules/motion/motion-controller.ts`
- `firmware/host/modules/audio/tts-types.ts`
- `firmware/host/modules/preferences/loadPreference.ts`
- `web/src/features/project-editor/use-project-editor.ts`
- `web/editor/blocks.mjs`
- `web/editor/mod-builder.mjs`

### 🟡 Reference（必要に応じて）
- `firmware/host/modules/motion/*-driver.ts` (サーボドライバ追加時)
- `firmware/host/modules/audio/tts-*.ts` (TTS エンジン追加時)
- `web/src/services/simulator/simulator-engine.mjs` (シミュレータバグ時)
- `web/src/services/esptool/esptool-adapter.ts` (フラッシング問題時)
- Test files: `**/*.test.*` (動作検証・デバッグ時)

---

## コード読み込みの順序の推奨パターン

### パターンA：全体理解を目指す場合（4-6時間）

1. README.md を読む（10分）
2. REPOSITORY_GUIDE.md を読む（30分）
3. **ファイル 1-5** を読む（120分）
4. ARCHITECTURE.md を読む（60分）
5. firmware/docs/api.md を読む（30分）
6. 1-2 つの example MOD を詳しく読む（60分）

### パターンB：MOD 開発に特化する場合（2-3時間）

1. README.md を読む（10分）
2. **ファイル 1, 3, 4** を読む（60分）
3. firmware/docs/api.md を読む（30分）
4. 複数の example MOD を読む（30分）
5. web/editor/blocks.mjs を読む（30分）

### パターンC：ハードウェア拡張（ドライバ追加）に特化する場合（3-4時間）

1. **ファイル 1, 2** を読む（90分）
2. ARCHITECTURE.md を読む（45分）
3. firmware/host/modules/motion/ を詳しく読む（60分）
4. 既存のドライバ実装（SCServoDriver等）を熟読（45分）

---

## よくある質問と対応ファイル

| 質問 | 対応ファイル |
| --- | --- |
| MOD に何ができるか？ | `firmware/host/app/capabilities.ts` |
| ボタンを押したらどうなる？ | `firmware/host/app/main.ts` + `firmware/mods/examples/look_around/mod.js` |
| Web と Device はどう通信する？ | `firmware/host/modules/connectivity/` + `web/src/services/preferences/` |
| TTS エンジンを追加したい | `firmware/host/modules/audio/tts-*.ts` + `firmware/host/app/compose.ts` |
| 新しいサーボドライバに対応したい | `firmware/host/modules/motion/*-driver.ts` + `firmware/host/app/compose.ts` |
| Blockly ブロックを追加したい | `web/editor/blocks.mjs` |
| ブラウザツール全体の構成は？ | `web/vite.config.ts` + `web/src/app/app-shell.tsx` |
| MOD をシミュレータでテストする流れ | `web/src/services/simulator/` + `web/simulator/bridge.mjs` |
| ファームウェア設定（Wi-Fi, TTS等）を追加したい | `firmware/host/modules/preferences/consts.ts` + `web/src/features/preferences/` |

---

## デバッグ時のファイル確認チェックリスト

- [ ] `firmware/host/app/main.ts` → エラー箇所が起動時か実行時か
- [ ] `firmware/host/app/compose.ts` → ドライバ・TTS・UI が正しく選択されているか
- [ ] Preferences (firmware/host/modules/preferences/) → 設定が正しく読み込まれているか
- [ ] MOD 側エラーハンドリング → 実装が `try-catch` で囲まれているか
- [ ] `firmware/docs/api.md` → API 使用方法が正しいか
- [ ] Web Tools側：`web/src/services/` → API 呼び出しが成功しているか（コンソール確認）
- [ ] テスト → `npm test` で関連テストが全て green か
