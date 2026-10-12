# Windows 日本語会話 Gateway

CoreS3 のマイク・スピーカー・表情・動作と、PCで動く会話アプリを接続します。
Codex CLI / Claude Code / Lemonade / LM Studio をブラウザから切り替えます。
[合意した要件](REQUIREMENTS_ja.md)も参照してください。

## 初回の準備

1. Windows 11 に Node.js 22以降と Python 3.10以降を用意します。
2. Codex CLI / Claude Code は公式CLIでサブスクのアカウントにログインしておきます。
   ローカル LLM は Lemonade / LM Studio のサーバーを起動し、日本語対応モデルをロードします。
3. `gateway/Setup-Speech.cmd` をダブルクリックします。
   この操作だけネット接続を使い、リポジトリ内の `.venv/` に faster-whisper と依存パッケージ、
   `.runtime/models/whisper-small/` に認識モデルを導入します。
   認識は日本語固定・CPU int8です。GPUのVRAMはLLMに残します。
4. [VOICEVOX](https://voicevox.hiroshiba.jp/)のWindows版をインストールして起動します。
   通常のローカルエンジンは `http://127.0.0.1:50021` です。
   追加の有料APIやDockerは必要ありません。声の利用条件は選んだ話者の規約に従ってください。

音声認識・合成には有料のクラウドサービスを使いません。初回導入後の音声処理はオフラインです。
Codex / Claude はオンラインでサブスクの利用枠を消費します。認証は公式CLIが処理します。
Lemonade / LM Studio もローカル推論を選ぶことで、会話全体をオフラインにできます。

## 起動

`gateway/Start-Gateway.cmd` をダブルクリックしてください。
ビルド後にGatewayと管理画面を開きます。初回でnpm依存が未導入なら `npm ci` を実行します。
導入済みのローカル認識モデルがあれば、音声認識サーバーも起動します。
VOICEVOXは先に起動しておいてください。

- 管理画面: `http://127.0.0.1:8766/`（このPCだけ）
- 本体のWebSocket接続: `ws://<このPCのLAN IP>:8765/`
- 音声認識: `http://127.0.0.1:8767/`（このPCだけ）

通常は起動ウィンドウを残します。Ctrl+Cで終了すると管理画面とGatewayを閉じ、
この起動処理が生成した認識プロセスを停止します。他のLLMやVOICEVOXは終了しません。
起動済みのときに再度ダブルクリックすると、既存のGatewayの画面を開きます。
ブラウザの「Gateway を終了」でも終了できます。音声の初回導入後は、このボタンで終了してから再起動してください。
起動ウィンドウを強制終了した場合は認識プロセスが残ることがあります。
次回起動では既存の認識サーバーを利用し、そのプロセスは停止対象にしません。

コマンドから起動する場合:

```powershell
cd gateway
npm ci
npm run build
npm run start:desktop
```

既存の `npm start` は従来のYAML設定Gatewayとして残っています。
同じポートを使うため、同時には起動しないでください。

## 本体をつなぐ

CoreS3とPCを同じWi-Fi / LANに接続します。
管理画面の「本体につなぐ」でPCのLAN接続先を選び、設定をコピーします。
本体のWeb設定に以下を入力して保存・再起動します。

| 項目 | 値 |
| --- | --- |
| `conversation.backend` | `gateway` |
| `gateway.endpoint` | 画面に表示されたPCのLAN URL |
| `gateway.deviceId` | 画面の本体ID（初期値 `stackchan-01`） |
| `gateway.clientId` | `cores3-01` |
| `gateway.token` | 画面に表示した本体用トークン |
| `gateway.microphone` | 有効 / `1` |
| `conversation.autoStart` | 無効 / `0` |

Windowsファイアウォールでは、プライベートLANからのTCP 8765受信を許可してください。
管理ポート8766と認識ポート8767をLANへ公開する必要はありません。

管理画面から開始・停止・中断するには、今回の `conversationControl` 拡張に対応した本体ファームウェアが必要です。
古い本体では更新が必要だと画面に表示し、管理操作を拒否します。
顔タップによる従来の操作はそのまま利用できます。

本体ビルド（Moddable / ESP-IDF の開発環境が必要）:

```powershell
cd firmware
npm run build:m5stackchan_cores3 -- --mode=release
```

実機への書き込みは [ファームウェアの書き込みガイド](../firmware/docs/flashing-firmware_ja.md)に従ってください。
この変更の作成中に、実機の書き込みや設定消去は行っていません。

## LLMと声を選ぶ

1. 「会話するLLM」でプロバイダーを選び、「このLLMを使う」で保存します。
2. 「接続を確認」でCLIのバージョン・ログイン状態、またはローカルのモデル一覧を確認します。
3. ローカルLLMはモデル名を選び、もう一度保存します。
4. 「本体なしで返答を試す」で日本語の返答を確認できます。このテストは履歴保存・身体操作をしません。
5. 「日本語の声」の「音声エンジンを確認」で認識サービスとVOICEVOXを確認します。
   話者を選んで保存してください。

CLIのモデル名は空欄なら公式CLIの既定値です。
CLIコマンドが見つからない場合は `codex` / `claude` の実行ファイルの完全パスを入力できます。
Windowsのnpm用`.cmd`・`.ps1`はJavaScript実体へ解決し、会話内容をシェルへ渡しません。
Codexは0.162.1、Claude Codeは2.1.296のヘルプに基づくオプションを利用しています。
古いCLIでオプションエラーが出る場合は更新してください。

ローカルLLMの既定値:

- Lemonade: `http://127.0.0.1:13305/api/v1`（導入済みCLIの既定ポートに合わせた値）
- LM Studio: `http://127.0.0.1:1234/v1`

インストール済みサーバーが別のポート・APIパスなら画面で変更してください。
推論サービスの認証が有効な構成は初版では扱いません。PC内の認証なしローカルAPIを使います。
`/models` と `/chat/completions` に対応する必要があります。
モデルはJSON形式の日本語返答が可能なものを選んでください。
返答形式が不正な場合は、動作を実行せずエラーを表示します。

## 会話・記憶・キャラクター

- 顔タップまたは画面で開始・停止。開始中は発話の区切りを自動検出します。
- 返答中は本体のマイクを停止します。顔タップ・画面の中断で返答を止めます。
- 名前・性格・動作の有効/無効は画面から変更できます。
- 表情・うなずき・視線は本体が広告した既存ツールだけを使います。
  モーター座標をLLMから直接受け取らず、小さなうなずきと限定した視線位置に変換します。
- 会話履歴は本体IDごとに最大1,000往復。次のLLMには直近12往復を渡します。
- LLM切替後・PC再起動後も同じ履歴から続けます。
- 設定の保存・履歴削除は進行中の返答を中断します。履歴削除後は過去の会話を次のLLMへ渡しません。

保存場所は `gateway/.runtime/desktop.json` です。トークンと会話を含むためGitには入りません。
認識モデル、CLIの作業ディレクトリも `.runtime/` 配下です。
名前・好みを自動抽出する長期記憶、外部ツールやPC操作、全二重、音声による割込みは初版の範囲外です。

## 検証と障害の切り分け

今回の結果と未確認の範囲は [検証記録](VALIDATION_ja.md)を参照してください。

```powershell
cd gateway
npm test
npm run lint
npm run typecheck
python -m unittest discover -s scripts -p test_whisper_server.py
node scripts/check-desktop.mjs
```

CLIに実際の短い日本語返答を生成させる場合（サブスクの利用枠を使用）:

```powershell
node scripts/check-desktop.mjs codex claude --live
```

管理画面の接続・エラー記録には生の音声、CLIの認証情報や思考内容を記録しません。
会話内容は選択したLLMへ渡します。音声はローカルサービスにのみ渡します。
接続診断はモデル生成をせず、明示的な返答テストだけ生成を行います。

実機確認はPCテストと分けて実施してください。特にCoreS3のマイク音量・日本語認識精度、
音声再生の末尾、顔タップ、サーボ可動域、Wi-Fi復帰、繰り返し開始・停止を確認します。
ビルドや合成音声の試験は実機品質の確認にはなりません。

## 参照仕様

- [Codex 認証](https://learn.chatgpt.com/docs/auth) / [非対話実行](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Claude Code の非対話実行](https://code.claude.com/docs/en/headless)
- [LM Studio の互換API](https://lmstudio.ai/docs/developer/openai-compat)
- [Lemonade の互換API](https://lemonade-server.ai/docs/api/openai/)
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) / [VOICEVOX Engine](https://github.com/VOICEVOX/voicevox_engine)
