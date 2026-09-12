# Stack-chan リポジトリガイド

## 1. 一言でいうと

**Stack-chan** は、M5Stack社のマイコンボードに JavaScript で走るプログラムを書き込める、オープンソースロボット開発基盤です。ユーザーが作成した MOD（モジュール）と呼ぶアプリケーションをロボットに実装でき、ブラウザ上のビジュアルエディタでも開発できます。

## 2. このシステムが解決する問題

- 組み込みマイコンプログラミングの敷居が高い → JavaScript で開発可能
- 機械学習・音声処理などの複雑な機能を個人で実装するのは困難 → 外部サービス（OpenAI、VoiceVox等）と統合した機能を提供
- ロボット制御の自由度を高めたい → モーションドライバ（サーボ）を交換可能に設計
- 開発環境構築が大変 → ブラウザだけで開発・テスト・フラッシュまで実行可能

## 3. 主な利用者

- **一般ユーザー**：完成した M5StackChan を購入し、MOD Gallery から既成の MOD をインストール
- **開発者**：ブロックエディタ（Blockly）で MOD を作成、または TypeScript で実装
- **拡張開発者**：ファームウェアソースコードを変更し、新しいドライバ・モジュール・機能を追加

## 4. 主な機能

| 機能 | 提供場所 | 利用者 |
| --- | --- | --- |
| ブラウザからのファームウェアフラッシュ | Web Firmware Installer（`/web/flash`） | 初期セットアップ |
| Wi-Fi・デバイス設定 | Web Preferences（`/web/preference`） | すべてのユーザー |
| MOD ギャラリー | MOD Gallery（`/web/mod-gallery`） | すべてのユーザー |
| ビジュアルプログラミング | Block Editor（`/web/editor`） + Blockly | 初心者向け |
| MOD の 3D シミュレータ | Simulator（`/web/simulator`） | 開発者 |
| 顔エディタ | Face Editor（`/web/face-editor`） | 初心者向け |
| MediaPipe 連携 | MediaPipe BLE Tracking（`/web/mediapipe`） | 拡張開発者 |
| テキスト音声合成 | TTS エンジン（OpenAI、VoiceVox等） | 利用可能な MOD |

## 5. システム全体像

```
┌─────────────────────────────────────────────────────────────┐
│                    Stack-chan ロボット                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Firmware (Moddable SDK / JavaScript)                │  │
│  │  ┌─────────────────────────────────────────────┐    │  │
│  │  │ Main Application (host/app/main.ts)         │    │  │
│  │  │  - Boot Services (Network, Preferences)     │    │  │
│  │  │  - Context Creation (Capabilities)          │    │  │
│  │  │  - MOD Loading & Execution                  │    │  │
│  │  └─────────────────────────────────────────────┘    │  │
│  │                                                       │  │
│  │  ┌─────────────────────────────────────────────┐    │  │
│  │  │ Capabilities (Runtime API for MODs)         │    │  │
│  │  │  - Motion (motion-controller)                │    │  │
│  │  │  - Audio (TTS, Speech, Recording)            │    │  │
│  │  │  - UI (Face, Effects, Drawer)                │    │  │
│  │  │  - Input (Touch, IMU, Buttons)               │    │  │
│  │  │  - Connectivity (BLE, Network, LocalPeer)    │    │  │
│  │  │  - Camera                                    │    │  │
│  │  └─────────────────────────────────────────────┘    │  │
│  │                                                       │  │
│  │  ┌─────────────────────────────────────────────┐    │  │
│  │  │ Modules (Hardware Abstraction)               │    │  │
│  │  │  - Motion Drivers (SCServo, PWM, etc)        │    │  │
│  │  │  - TTS Engines (OpenAI, VoiceVox, etc)       │    │  │
│  │  │  - USB Audio, Connectivity                   │    │  │
│  │  │  - Preferences (BLE settings server)         │    │  │
│  │  └─────────────────────────────────────────────┘    │  │
│  │                                                       │  │
│  │  ┌─────────────────────────────────────────────┐    │  │
│  │  │ MOD (User Application)                      │    │  │
│  │  │  - JavaScript/TypeScript code                │    │  │
│  │  │  - Runs with StackchanContext                │    │  │
│  │  └─────────────────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
           ↕ USB / BLE
┌─────────────────────────────────────────────────────────────┐
│              Web Browser Tools (Vite + React)                │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│ │ Flash Tool  │ │ Preferences │ │ MOD Gallery │ ...        │
│ └─────────────┘ └─────────────┘ └─────────────┘            │
│ ┌──────────────────────┐ ┌──────────────────────┐           │
│ │ Block Editor         │ │ 3D Simulator (WASM)  │           │
│ │ (Blockly +           │ │ (three.js)           │           │
│ │  Project Storage)    │ │                      │           │
│ └──────────────────────┘ └──────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

## 6. 使用技術

| 分類 | 技術 | このプロジェクトでの役割 |
| --- | --- | --- |
| **Firmware** | Moddable SDK | JavaScript を ESP32 マイコンに実装 |
| **Firmware Lang** | JavaScript / TypeScript | ファームウェア・MOD・ドライバ実装 |
| **Hardware** | M5Stack Core S3 / M5StackChan | 標準ターゲット（複数対応） |
| **Web Frontend** | React 19 | ブラウザツール UI |
| **Web Build** | Vite 8 | モジュールバンドラ・HMR |
| **Web Styling** | Tailwind CSS 4 | UI デザイン |
| **Web Vis.Editor** | Blockly 13 | ビジュアルプログラミング |
| **Web 3D** | three.js 0.185 | シミュレータの 3D 描画 |
| **Web Communication** | esptool-js 0.6 | USB からのファームウェアフラッシュ |
| **Web Testing** | Vitest 4, Playwright 1.62 | 単体テスト・ビジュアルテスト |
| **CI/CD** | GitHub Actions | ビルド・テスト・リリース |
| **Type Checking** | TypeScript 7 | 型安全性 |

## 7. ディレクトリ構成（主要部分）

```
stack-chan/
├── firmware/                           # ハードウェアに走るファームウェア
│   ├── host/                           # ホストアプリケーション
│   │   ├── app/
│   │   │   ├── main.ts                 # エントリーポイント
│   │   │   ├── compose.ts              # コンポーネント組み立て
│   │   │   ├── capabilities.ts         # 公開 API 定義
│   │   │   └── boot-services.ts        # ネットワーク・プリファレンス初期化
│   │   └── modules/
│   │       ├── audio/                  # TTS・マイク・スピーカー
│   │       ├── motion-controller/      # サーボドライバ制御
│   │       ├── connectivity/           # BLE・ネットワーク
│   │       └── preferences/            # 設定読み込み
│   ├── mods/
│   │   ├── examples/                   # MOD 実装例（開発学習用）
│   │   │   ├── look_around/            # 最小限の例
│   │   │   ├── chatgpt/                # 外部 API 連携例
│   │   │   └── ... (30+ 例)
│   │   └── README.md                   # MOD 開発ガイド
│   ├── docs/
│   │   ├── api.md                      # 公開 API 仕様
│   │   ├── flashing-firmware.md        # ビルド・フラッシュ手順
│   │   ├── getting-started.md          # 開発環境セットアップ
│   │   └── text-to-speech.md           # TTS 機能解説
│   ├── typings/                        # TypeScript 型定義（Moddable SDK 補完）
│   ├── scripts/                        # ビルド・テスト・デプロイスクリプト
│   └── package.json                    # npm スクリプト・依存関係
│
├── web/                                # ブラウザ上のツール・エディタ
│   ├── src/
│   │   ├── entries/                    # 各ツールのエントリーポイント
│   │   │   ├── home.tsx                # ツール選択ホーム
│   │   │   ├── flash.tsx               # ファームウェアフラッシュツール
│   │   │   ├── editor.tsx              # ブロックエディタ（フロントエンド）
│   │   │   ├── simulator.tsx           # WASM シミュレータ（フロントエンド）
│   │   │   └── ...
│   │   ├── features/                   # 機能ごとのコンポーネント
│   │   │   ├── project-editor/         # MOD プロジェクト編集
│   │   │   ├── simulator/              # シミュレータロジック
│   │   │   ├── preferences/            # デバイス設定管理
│   │   │   └── ...
│   │   ├── services/                   # ユーティリティ・サービス
│   │   │   ├── device-service/         # デバイス通信
│   │   │   └── ...
│   │   └── components/                 # 再利用可能な UI コンポーネント
│   ├── flash/                          # ファームウェアフラッシャー
│   │   └── index.html                  # フラッシャー UI
│   ├── editor/                         # ブロックエディタ
│   │   ├── index.html                  # エディタ UI
│   │   ├── blocks.mjs                  # Blockly カスタムブロック
│   │   └── mod-builder.mjs             # MOD ビルド（ブラウザ側）
│   ├── simulator/                      # WASM ファームウェア＆ 3D シミュレータ
│   │   ├── index.html                  # シミュレータ UI
│   │   ├── mc.js / mc.wasm             # WASM ファームウェアビルド
│   │   └── ...
│   ├── preference/                     # デバイス設定ツール
│   ├── mod-gallery/                    # MOD カタログ表示
│   ├── face-editor/                    # 顔パーツエディタ
│   ├── mediapipe/                      # 顔・手トラッキング（MediaPipe）
│   ├── vite.config.ts                  # Vite マルチエントリーポイント設定
│   ├── index.html                      # ホーム HTML
│   └── package.json
│
├── case/                               # 3D プリント用ハウジング
├── schematics/                         # 回路図・基板設計
├── docs/
│   ├── ROADMAP.md                      # 開発ロードマップ
│   ├── specs/                          # 仕様書
│   ├── operations/                     # 運用・検証ガイド
│   └── release-notes/                  # リリースノート
├── .github/
│   ├── workflows/                      # GitHub Actions CI/CD
│   │   ├── build.yml                   # ビルド・テスト
│   │   ├── bundle.yml                  # リリースビルド
│   │   └── ...
│   └── actions/setup/                  # カスタムアクション
├── CONTRIBUTING.md                     # 開発貢献ガイド
├── GUIDELINE.md                        # コード・コミットガイドライン
└── README.md                           # プロジェクト概要
```

## 8. 起動から動作開始まで

### ロボット側（ファームウェア起動フロー）

```
npm run flash
  ↓
[Moddable SDK] ファームウェアをコンパイル
  ↓
[esptool] ESP32 へ書き込み
  ↓
[M5StackChan] リセット・ブート
  ↓
firmware/host/app/main.ts が実行
  ├─ Dock 起動（MOD マネージャ）
  ├─ 言語化・タイムゾーン初期化
  ├─ アプリ動作の読み込み（MOD オーバーライド）
  ├─ Boot Services 起動（ネットワーク）
  └─ StackchanContext 作成（Capabilities）
      └─ onContextCreated() で MOD が開始
```

### ブラウザ側（Web ツール起動フロー）

```
npm run dev (in web/)
  ↓
[Vite] 開発サーバ起動
  ↓
http://localhost:5173
  ↓
src/entries/home.tsx → React App
  ├─ Flash Tool    → esptool-js を使用
  ├─ Editor        → Blockly + 編集UI + MOD ビルダ
  ├─ Simulator     → WASM ファームウェア + three.js
  └─ ... 他のツール
```

### 設定ファイル

```
firmware/host/modules/preferences/consts.ts
  ↓ DOMAIN 定義（wifi, driver, ui, tts, ai, led, mcp, time）
  ↓
loadPreference.ts で読み込み
  ├─ mc/config（ビルド時コンパイル定数）
  ├─ mod/config（MOD 定義設定）
  └─ Preference（デバイスに保存された設定）
      ↓ マージ
  ↓
createStackchanContext() で使用
```

## 9. 主要ユースケース

### 1. **ファームウェアフラッシュ**
- **入口**：Web Flash Tool（`/web/flash/index.html`）
- **処理**：esptool-js が USB でデバイスに接続 → ファームウェアバイナリ書き込み
- **結果**：ロボットが新しいファームウェアで起動

### 2. **デバイス設定変更**
- **入口**：Web Preferences（`/web/preference/index.html`）
- **処理**：BLE で接続 → preference-server（`firmware/host/modules/connectivity/preference-server.ts`）へ送信
- **設定項目**：Wi-Fi SSID・パスワード、モーションドライバ種別、TTS エンジン等
- **永続化**：Preference（XS Runtime）に保存

### 3. **MOD を ブロックエディタで作成**
- **入口**：Block Editor（`/web/editor/index.html`）
- **編集**：Blockly で ビジュアルプログラミング
- **検証**：Simulator（WASM）で実行
- **ビルド**：ブロック → JavaScript コード生成 → MOD アーカイブ
- **インストール**：Gallery または エディタから デバイスに送信

### 4. **MOD を TypeScript で実装**
- **ファイル**：`firmware/mods/examples/*/mod.ts`
- **エントリー**：`export function onContextCreated(context, options) { ... }`
- **Build**：`npm run mod -- mods/examples/mymod/manifest.json`
- **デバイス**：USB/BLE 経由で install

### 5. **チャット MOD による ChatGPT 連携**
- **例**：`firmware/mods/examples/chatgpt/mod.js`
- **フロー**：
  1. WebSocket で STT サーバに接続
  2. テキスト音声入力待機
  3. ChatGPT API へリクエスト（設定の AI トークン使用）
  4. レスポンスを TTS で再生
  5. モーション・表情表現

### 6. **MediaPipe 顔トラッキング**
- **入口**：MediaPipe BLE Tracking（`/web/mediapipe/index.html`）
- **処理**：ブラウザで MediaPipe で顔・手 → BLE 送信 → MOD が受信して モーション制御

### 7. **3D シミュレータでの MOD テスト**
- **入口**：Block Editor → Simulator タブ
- **実行**：WASM ファームウェア + 3D Stack-chan モデル
- **操作**：MOD のボタン操作・音声入力をシミュレート

## 10. データの流れ

```
┌─ ユーザー入力（テキスト・音声）
│
├─ MOD (onContextCreated)
│  ├─ context.audio.say(text)  ──→ TTS エンジン
│  │                              ├─ OpenAI API
│  │                              ├─ VoiceVox
│  │                              ├─ ElevenLabs
│  │                              ├─ Local (Stackchan Voice)
│  │                              └─ 音声ファイル → Speaker
│  │
│  ├─ context.motion.lookAt([x,y,z])  ──→ Motion Driver
│  │                                      ├─ SCServo
│  │                                      ├─ PWM
│  │                                      ├─ Dynamixel
│  │                                      └─ RS30X
│  │                                          ↓ 物理サーボモータ
│  │
│  ├─ context.face.setEmotion()  ──→ Piu UI / Face
│  │                                 └─ 液晶画面
│  │
│  ├─ context.input.touch  ──→ タッチセンサ入力
│  │
│  ├─ context.connectivity.localPeer  ──→ BLE / ESP-NOW
│  │                                      (ローカルピア通信)
│  │
│  └─ context.camera.capture()  ──→ カメラセンサ
│
└─ Web Tools
   ├─ Flash Tool  → USB → esptool-js → ファームウェアバイナリ
   ├─ Preferences → BLE → preference-server → Preference XS
   ├─ Editor      → Project format JSON → MOD 生成 → デバイス
   └─ Simulator   → WASM Firmware + Blockly blocks → 3D UI
```

## 11. 外部サービス

| サービス | 機能 | 設定場所 | 必須性 |
| --- | --- | --- | --- |
| **OpenAI** | テキスト音声合成（TTS）・ChatGPT | `preferences.tts.token` (API キー) | 選択 |
| **VoiceVox** | テキスト音声合成（オンプレミス or Web版） | `preferences.tts.host:port` または Web API | 選択 |
| **ElevenLabs** | テキスト音声合成 | `preferences.tts.token` | 選択 |
| **Stackchan Voice** | ローカルテキスト音声合成（組み込み） | なし | デフォルト |
| **Google STT** | 音声認識（カスタムスクリプト用） | MOD 側 | 選択 |
| **Codex Voice（MCP）** | 音声通話・アシスタント | `preferences.mcp.token` | 選択 |

## 12. 設定・環境変数

### firmware 側

**設定ドメイン** (`firmware/host/modules/preferences/consts.ts`)

| ドメイン | キー | 型 | 説明 |
| --- | --- | --- | --- |
| `wifi` | `ssid` | String | ネットワーク名 |
| | `password` | String | Wi-Fi パスワード |
| `driver` | `type` | String | モーション制御「scservo」「m5stackchan」「pwm」「dynamixel」「rs30x」「none」 |
| | `baudrate` | Number | シリアル通信速度 |
| | `offsetPan`/`offsetTilt` | Number | サーボ角度キャリブレーション |
| `ui` | `type` | String | UI テーマ「dog」「simple」「image」「small-face」 |
| | `language` | String | 言語「ja」「en」「zh」 |
| `tts` | `type` | String | TTS バックエンド |
| | `host`/`port` | String/Number | リモート TTS サーバ |
| | `token` | String | API キー（OpenAI等） |
| | `volume` | Number | 音量 0-100 |
| | `voice`/`speed` | String/Number | 音声キャラ・速度 |
| `ai` | `token` | String | 外部 AI API キー（ChatGPT等） |
| | `context` | String | AI プロンプトコンテキスト |
| `led` | (カスタム) | Object | LED 設定（PIN、WS2812 等） |
| `mcp` | `token` | String | Codex Voice API キー |
| `time` | `timezone` | String | タイムゾーン（Asia/Tokyo等） |

**読み込み順序** (`firmware/host/modules/preferences/loadPreference.ts`)
1. ビルド時定数（`mc/config`）
2. MOD 定義設定（`mod/config`）
3. デバイス保存設定（Preference XS）
→ マージして使用

### web 側

**環境変数**（`vite.config.ts` 参照）

```javascript
VITE_WASM_BUILD_ID  // WASM ファームウェアビルドID（キャッシュバスティング）
```

**Flash マニフェスト** (`web/flash/manifest_*.json`)

異なるハードウェア対象ごとにビルド出力パスを指定

## 13. テスト

### Firmware 側

```bash
firmware/
├── **/*.test.ts         # Node.js 単体テスト
│                        $ npm run test:legacy
│                        $ npm run test:react (React Component)
├── host/app/
│   └── __tests__/       # アーキテクチャテスト
└── scripts/
    └── run-module-tests.js  # モジュール統合テスト
```

### Web 側

```bash
web/
├── **/*.test.mjs        # Node.js テスト (editor, simulator 等)
│                        $ npm test:legacy
├── src/**/*.test.tsx    # React Component テスト
│                        $ npm run test:react
├── **/*.visual-test.mjs # 生成ファイル比較テスト
│                        $ npm run test:visual
└── i18n-visual-test.mjs # 国際化テスト
```

**重要なテスト対象**

- `web/editor/blocks.test.mjs` - Blockly カスタムブロック検証
- `web/editor/mod-builder.test.mjs` - MOD パッケージング検証
- `firmware/host/app/__tests__/` - アーキテクチャ・アシスタント依存テスト
- `firmware/host/modules/audio/__tests__/` - TTS 等オーディオ機能テスト

## 14. 変更時の注意点

### API 変更時の注意

- **firmware/docs/api.md** → 公開 API 変更は必ず記録
- **MOD エコシステム互換性** → 既存 MOD が壊れないよう配慮
- **Blockly ブロック定義** → `web/editor/blocks.mjs` 更新忘れ注意

### 設定追加時の注意

- **preferences/consts.ts** に PREF_KEYS 登録必須
- **preference-server.ts** で BLE 設定サーバも更新
- **web/src/features/preferences/` で UI フォーム追加

### TTS エンジン追加時

- **firmware/host/modules/audio/tts-*.ts** に実装
- **compose.ts** の ttsEngines Map に登録
- **firmware/typings/** で型定義追加
- **web/editor/blocks.mjs** で使用可能ブロック更新

### モーションドライバ追加時

- **firmware/host/modules/motion/drivers/` に実装
- **compose.ts** の drivers Map に登録
- **firmware/docs/api.md** で座標系・制御方法記載
- キャリブレーション MOD（`examples/calibration/`）動作確認

### UI テーマ追加時

- **firmware/host/modules/ui/faces/` に顔コンポーネント追加
- **compose.ts** の uiControllers Map に登録
- **web/face-editor/` でエディタに対応

## 15. 用語集

| 用語 | 意味 | 例 |
| --- | --- | --- |
| **MOD** | Stack-chan で実行するユーザーアプリケーション | chatgpt.stackchan-mod, look_around.stackchan-mod |
| **Host** | MOD を実行するベースファームウェア | stack-chan-host |
| **Capability** | MOD に提供される実行時 API | context.motion, context.audio |
| **Preference** | デバイスに保存された設定 | Wi-Fi SSID、TTS エンジン種別 |
| **TTS** | テキスト音声合成 (Text-To-Speech) | OpenAI TTS、VoiceVox |
| **Motion Driver** | サーボモータ制御ドライバ | SCServo、PWM サーボ（SG90等） |
| **Piu** | Moddable SDK の UI フレームワーク | 液晶表示制御 |
| **WASM** | WebAssembly | ブラウザシミュレータ用ファームウェアビルド |
| **Blockly** | Google のビジュアルプログラミングエディタ | Block Editor で使用 |
| **esptool** | ESP32 フラッシュツール | USB ファームウェア書き込み |
| **BLE** | Bluetooth Low Energy | ワイヤレスデバイス通信 |
| **LocalPeer** | ローカル無線通信（BLE/ESP-NOW） | デバイス間メッセージング |

## 16. 不明点・確認が必要なこと

以下の事項は、実装から完全には確認できませんでした。プロジェクト担当者への確認が必要です：

- [ ] Moddable XS バージョン固定理由と更新ポリシー
- [ ] MOD Gallery カタログの自動生成・更新メカニズム
- [ ] リリースプロセス中の QA・検証フロー
- [ ] パフォーマンステスト・負荷テストの実施状況
- [ ] セキュリティレビュー・脆弱性報告プロセス
- [ ] ハードウェア互換性テストの自動化状況
- [ ] 多言語対応（日本語・英語・簡体字中国語）のメンテナンス体制
