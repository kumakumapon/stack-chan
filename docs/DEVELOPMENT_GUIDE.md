# Development Guide

新しく開発に参加する人向けの手順書です。実際に確認できたコマンドだけを記載しています。

## Requirements

### ハードウェア

- **M5StackChan CoreS3** または M5Stack（任意のモデル）
- **USB Type-C ケーブル** (データ通信対応)
- **コンピュータ**（Windows / macOS / Linux）

### ソフトウェア

- **Node.js** 18 以上 (LTS 推奨)
- **npm** または **pnpm**
- **Git**
- **ブラウザ** (Chrome / Edge 推奨、USB/BLE API 対応)

## Setup

### 1. リポジトリクローン

```bash
git clone https://github.com/kumakumapon/stack-chan.git
cd stack-chan
```

### 2. 依存関係インストール

#### Firmware セットアップ

```bash
cd firmware
npm install
npm run setup
npm run setup -- --device=esp32
npm run doctor
```

**出力例**：
```
✓ Moddable SDK path: /path/to/moddable
✓ ESP-IDF version: 5.1
✓ ESP32 tools found
```

#### Web ツールセットアップ

```bash
cd web
npm install
```

## Environment Variables

### Firmware

設定は `mc/config` で管理（ビルド時固定値）。実行時変更は Preference で。

### Web

```bash
# .env.local (オプション)
VITE_WASM_BUILD_ID=<hash>  # 自動生成（手動変更不要）
```

## Database Setup

**Web 側**：IndexedDB を自動使用（セットアップ不要）

**Firmware 側**：Preference XS（オンボード NVRAM）自動初期化

## Migration

実行時マイグレーション必要なし（Preference は後方互換性あり）

## Run

### Firmware

#### 標準ターゲット（M5StackChan CoreS3）をビルド・フラッシュ

```bash
cd firmware
npm run flash
```

**流れ**：
1. Moddable SDK でコンパイル
2. esptool で ESP32 へ書き込み
3. Device 自動リセット
4. 起動画面表示

#### 特定の MOD だけビルド・インストール（高速）

```bash
npm run mod -- mods/examples/look_around/manifest.json
```

出力：`firmware/dist/bin/stack-chan-host` (ホスト)、MOD アーカイブ

#### その他のターゲット

```bash
npm run flash:stackchan_rt          # Stack-chan RT 用
npm run flash:takao_core2_sg90      # Takao Core2 用
```

### Web Tools

#### 開発サーバ起動

```bash
cd web
npm run dev
```

**出力**：
```
VITE v8.2.1  ready in 234 ms

➜  Local:   http://localhost:5173/
```

ブラウザで http://localhost:5173 を開く

#### ビルド（本番用）

```bash
npm run build
```

出力：`web/dist/` ディレクトリ

## Test

### Firmware

#### 全テスト実行

```bash
cd firmware
npm test
```

実行内容：
- `npm run test:legacy` - Node.js 単体テスト（simulator, editor, etc）
- `npm run test:react` - React Component テスト（vitest）

#### モジュール個別テスト

```bash
node --test host/app/__tests__/compose.test.ts
```

### Web

#### ブロックエディタ・MOD ビルダテスト

```bash
cd web
npm run test:legacy
```

実行対象：
- `editor/blocks.test.mjs` - Blockly ブロック検証
- `editor/mod-builder.test.mjs` - MOD パッケージング
- `editor/project-format.test.mjs` - プロジェクト形式

#### React Component テスト

```bash
npm run test:react
```

#### ビジュアルテスト（生成ファイル比較）

```bash
npm run test:visual
```

テスト内容：
- エディタ出力の一貫性
- シミュレータ画面のスナップショット
- 国際化ファイル整合性

## Lint / Format

### Firmware

```bash
cd firmware
npm run typecheck          # TypeScript 型チェック
npx biome format .         # Formatter（biome）
npx biome lint .           # Linter（biome）
```

### Web

```bash
cd web
npm run typecheck          # TypeScript 型チェック
npx prettier --write .     # Formatter（Prettier）
```

## Build

### Firmware リリースビルド

```bash
cd firmware
npm run bundle             # 全ターゲットビルド
```

出力：`firmware/dist/bundle-targets/` に各ターゲットの ZIP ファイル

### Web リリースビルド

```bash
cd web
npm run build
```

出力：`web/dist/` (複数の HTML エントリーポイント)

## Debug

### Firmware デバッグ出力

```bash
cd firmware
npm run flash              # 通常フラッシュ
# Device が起動し、xsbug で trace 出力が表示される
```

**trace() 関数を MOD 内で使用**：

```javascript
// mod.js
export function onContextCreated(robot) {
  trace('[mymod] Starting...\n')
  robot.motion.lookAt([0.5, 0, 0])
  trace('[mymod] Looked at target\n')
}
```

### Web デバッグ

#### ブラウザコンソール

```bash
npm run dev
# Chrome DevTools: F12 → Console タブ
```

#### React DevTools (拡張機能インストール時)

- Component ツリー確認
- Props / State 検査

#### Simulator デバッグ

```javascript
// web/src/services/simulator/simulator-engine.mjs で console.log
console.log('[simulator] MOD loaded:', modName)
```

### USB 通信デバッグ

```bash
# Chrome: chrome://device-log で USB イベントログ表示
```

## よくある変更

### API を追加する

**Firmware 側**：

1. `firmware/host/app/capabilities.ts` に型定義追加
   ```typescript
   export interface StackchanContext {
     myNewFeature?: {
       doSomething(): Promise<void>
     }
   }
   ```

2. `firmware/host/app/runtime-context.ts` に実装追加
   ```typescript
   this.myNewFeature = {
     doSomething: async () => { ... }
   }
   ```

3. テスト追加
   ```bash
   firmware/host/app/__tests__/*.test.ts に追加
   ```

4. MOD で使用
   ```javascript
   export function onContextCreated(context) {
     await context.myNewFeature.doSomething()
   }
   ```

### DB 項目（Preference キー）を追加する

1. `firmware/host/modules/preferences/consts.ts` に登録
   ```typescript
   export const PREF_KEYS = Object.freeze([
     [DOMAIN.myfeature, 'mykey', String],
     ...
   ])
   ```

2. `firmware/host/modules/preferences/consts.ts` に DOMAIN 追加（必要なら）
   ```typescript
   export const DOMAIN = {
     myfeature: 'myfeature',
     ...
   }
   ```

3. `firmware/host/modules/connectivity/preference-server.ts` で対応（BLE サーバ）

4. `web/src/features/preferences/` に UI フォーム追加

### ビジネスロジック（MOD 側）を変更する

```bash
# look_around 例を編集して再ビルド
cd firmware
npm run mod -- mods/examples/look_around/manifest.json

# または開発モード（fast rebuild）
npm run mod -- mods/examples/look_around/manifest.json -- watch
```

### 外部サービス API を追加する

1. TTS エンジン例：

   ```typescript
   // firmware/host/modules/audio/tts-mynewservice.ts
   export class MyNewServiceTTS implements TTS {
     synthesize(text: string): Promise<AudioBuffer> {
       return fetch('https://api.myservice.com/tts', {
         method: 'POST',
         body: JSON.stringify({ text }),
         headers: { 'Authorization': `Bearer ${this.apiKey}` }
       })
       .then(r => r.arrayBuffer())
       .then(buffer => new AudioBuffer(buffer))
     }
   }
   ```

2. `firmware/host/app/compose.ts` に登録
   ```typescript
   const ttsEngines = new Map<string, (param: unknown) => TTS>([
     ['mynewservice', (param) => new MyNewServiceTTS(param)],
     ...
   ])
   ```

3. テスト追加
   ```bash
   firmware/host/modules/audio/__tests__/tts-mynewservice.test.ts
   ```

### Blockly ブロック定義を追加する

1. `web/editor/blocks.mjs` に ブロック定義追加

   ```javascript
   // Define the block
   const blockDefinition = {
     type: 'motion_my_new_move',
     message0: 'move to %1 %2 %3',
     args0: [
       { type: 'field_number', name: 'X', value: 0.5 },
       { type: 'field_number', name: 'Y', value: 0 },
       { type: 'field_number', name: 'Z', value: 0 }
     ],
     previousStatement: null,
     nextStatement: null,
     colour: 240
   }
   
   Blockly.Blocks['motion_my_new_move'] = { init() { ... } }
   ```

2. 日本語ラベル追加
   ```javascript
   Blockly.Msg['MOTION_MY_NEW_MOVE'] = 'に移動 %1 %2 %3'
   ```

3. Python コード生成
   ```javascript
   Blockly.Python['motion_my_new_move'] = (block) => {
     const x = block.getFieldValue('X')
     const y = block.getFieldValue('Y')
     const z = block.getFieldValue('Z')
     return `robot.motion.moveTo([${x}, ${y}, ${z}])\n`
   }
   ```

4. テスト追加
   ```bash
   web/editor/blocks.test.mjs に追加
   ```

### テストを追加する

#### Firmware MOD テスト

```typescript
// firmware/host/app/__tests__/myfeature.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { myFeature } from '../myfeature'

test('myFeature returns expected value', () => {
  const result = myFeature()
  assert.equal(result, expected)
})
```

#### Web テスト

```typescript
// web/src/features/myfeature/my-component.test.tsx
import { render, screen } from '@testing-library/react'
import { MyComponent } from './my-component'

test('renders title', () => {
  render(<MyComponent />)
  expect(screen.getByText('Title')).toBeInTheDocument()
})
```

## 開発時の注意事項

### Preferences 変更時の注意

- キーを削除する場合、古いキーの値がデバイスに残る可能性
- マイグレーション関数で古いキーを新しいキーに変換（例：`consts.ts` L67-74）
- テストで前方互換性確認

### Blockly ブロック追加時の注意

- ブロック定義と Python/JavaScript ジェネレータの同期を取ること
- 日本語・英語・中国語ラベルすべて定義すること
- サンプルプロジェクト作成時にテスト

### TTS エンジン追加時の注意

- API キーの秘密度管理（Preference に保存、ログ出力禁止）
- ネットワークエラー時のフォールバック（ローカル TTS 等）
- 複数の言語・音声をサポートする場合、UI で選択肢提供

### モーションドライバ追加時の注意

- サーボ通信プロトコルの実装（ボーレート、パケット形式）
- キャリブレーション用スクリプト・MOD 作成
- 角度計算の座標系統一（degrees vs radians）
- キャリブレーション MOD（`examples/calibration/`）で動作確認

### UI テーマ追加時の注意

- 顔コンポーネント（目、口、髪、アクセサリ）の Piu 実装
- アニメーション（瞬き、口パク）の実装
- 感情表現（8 種類）すべてサポート
- メモリ使用量確認（M5Stack Core S3 は ~4MB フラッシュ）

### Web ツール（エディタ等）新機能追加時の注意

- ブラウザ互換性（Chrome / Edge 推奨）
- IndexedDB が使用不可の環境での localStorage フォールバック
- BLE / Web Serial API サポートブラウザ確認
- 国際化（`web/src/lib/i18n.mjs` で ja/en/zh-CN）

## よくあるエラーと対策

### Firmware フラッシュエラー

**エラー**：`Failed to connect to the board`

**対策**：
1. USB ケーブルがデータ通信対応か確認
2. Device Manager で認識されているか確認
3. `npm run doctor` で Moddable SDK 環境確認
4. Device USB ドライバ再インストール

**エラー**：`INVALID_CHIP_ID`

**対策**：
1. ターゲットボード設定確認（M5StackChan CoreS3 選択）
2. `npm run flash -- --target=m5stackchan_cores3`

### Web ツール起動エラー

**エラー**：`Cannot find module 'blockly'`

**対策**：
```bash
cd web
rm -rf node_modules
npm install
```

**エラー**：`WASM ファイルが見つからない`

**対策**：
```bash
cd firmware
npm run build:release:simulator_wasm
# 出力を web/simulator/ にコピー
cp -r dist/bin/mc.* ../web/simulator/
```

### Blockly コンパイルエラー

**エラー**：`MOD ビルド失敗：Unexpected token`

**対策**：
1. Blockly ブロック定義の日本語ラベル確認
2. 生成されたコードの字句チェック
3. `web/editor/blocks.test.mjs` で検証

### BLE 接続エラー

**エラー**：`Failed to get GATT characteristic`

**対策**：
1. Device が Bluetooth オンか確認
2. Device が GATT サーバー起動しているか（`preference-server.ts` 確認）
3. ブラウザ Bluetooth パーミッション与えているか確認
4. Chrome DevTools: https://webbluetoothcg.github.io/web-bluetooth/tests/ でテスト

## リリース手順（プロジェクト管理者向け）

### 版番号管理

```bash
# バージョンを v1.1.0 にバンプ
git tag v1.1.0
git push origin v1.1.0
```

CI が自動トリガー：
- `.github/workflows/bundle.yml` で全ターゲット最適化ビルド
- GitHub Releases に ZIP ファイル upload

### Web ツール更新（GitHub Pages）

```bash
cd web
npm run build
# dist/ が GitHub Pages で公開
# https://kumakumapon.github.io/stack-chan/develop/web/
```
