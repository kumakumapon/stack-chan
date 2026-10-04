# LAN通知と伝言箱

GatewayのHTTP受信箱は会話WebSocketと独立しています。受信・ペアリング・送信の操作でAgentセッションやマイクを起動しません。

## 起動

```yaml
# inbox.yaml
gateway:
  listen: { host: 0.0.0.0, port: 8765 }
  devices:
    - deviceId: stackchan-01
      token: ${STACKCHAN_INBOX_TOKEN}
agent:
  type: echo
inbox:
  allowedOrigins: ["http://localhost:5173"]
```

`STACKCHAN_INBOX_TOKEN`に十分長いランダムな秘密値を設定し、gatewayディレクトリで `npm ci && npm run build`、`node dist/main.js inbox.yaml` を実行します。受信箱では明示的に登録したdeviceIdと空でないトークンを必須とします。会話用の匿名接続設定では受信箱を操作できません。

本体の通常のGateway設定に `ws://<LANのPC>:8765/`、deviceId、tokenを設定し、暮らし工房の「通知を受け取る」をONにします。Simulatorでは工房の受信フォームに `http://<LANのPC>:8765` を入力します。Simulator URLのorigin（scheme/host/portが一致するもの）を `inbox.allowedOrigins` に登録してください。`*`はサポートしません。Simulatorの工房フォームで入力した接続情報はメモリ内だけに保持し、再読込後は再入力します。

このMVPは信頼する同一LANのHTTP用です。インターネット公開・遠距離中継は含みません。HTTPSで開いたSimulatorからHTTP GatewayへはブラウザがMixed Contentとして拒否する場合があります。ローカルHTTPでWebを起動するか、ブラウザ・ネットワーク構成を揃えて利用してください。

## ビルド成功を通知する

ビルドが成功した後だけ、同じ処理に同じIDを付けてPOSTします。再送時はIDを変えません。

```sh
curl --fail-with-body 'http://localhost:8765/api/inbox/build' \
  -H "Authorization: Bearer $STACKCHAN_INBOX_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"deviceId":"stackchan-01","id":"local-build-001"}'
```

本文は固定の `Build succeeded`。有効期限10分、同じIDの再送は `accepted:false` です。通知本文の任意入力やHome Assistantアダプタは含みません。

## スマホとペアリングする

1. 本体の「暮らし工房 → 通知と伝言箱 → 送信者を登録」で登録コードを発行します。
2. 同じLANのスマホで `http://<GatewayのPC>:8765/inbox` を開き、deviceId・表示名・コードを入力します。本体のGatewayトークンはスマホへ渡しません。
3. 「ありがとう」「おつかれさま」「こんにちは」を送信します。スマホには接続中／未接続と送信済みの未読・既読・返信・削除状態が表示されます。
4. 本体で伝言を開くと既読になります。「ありがとうを返す」「この伝言を削除」を選択できます。
5. 本体で登録解除を確認すると、すべての送信者トークンと発行済みコードを失効させます。スマホの「登録を忘れる」はそのタブの資格情報だけを消します。

コードは2分、失敗5回で失効。最大8送信者・32台、1台16件、本文は定型だけ、表示名24文字までです。伝言の有効期限は1時間、削除時に本文を消し、再送防止IDを24時間（最大128件）保持します。上限時はHTTP429で拒否し、古い通知を無制限に再演しません。

受信箱とペアリングはGatewayのメモリ内に保持します。Gateway再起動で消えるため再登録が必要です。スマホの資格情報はsessionStorageに保存され、同じタブの再読込では保持されます。永続配送・遠距離対応はこのMVPの対象外です。

## HTTP契約

すべて `POST /api/inbox/<action>`、JSON bodyの`deviceId`が必須です。body上限4KiB。認証はBearerヘッダーで、Cookieは使用しません。

| action | 認証 | 追加の入力 |
| --- | --- | --- |
| poll / pair / revoke | 本体トークン | なし |
| read / reply / delete | 本体トークン | `id`（受信したID） |
| build | 本体トークン | `id`（英数字、`_`、`-`、1〜64文字） |
| claim | 期限内コード | `code`, `name` |
| send | ペアリングで得た送信者トークン | `id`（再送時固定）, `preset`: thanks/rest/hello |
| status | 送信者トークン | なし |

pollの期限は`remainingMs`で返し、本体の単調時計で期限切れを判断します。スマホは自分が送った伝言の状態だけ参照できます。
