# Conversation Gateway

English version: [conversation-gateway.md](./conversation-gateway.md)

## 目的

Stack-chanの会話スタックは4つの層に分かれます。

```text
Stackchan = 身体 + UI + Sensor
Gateway   = 会話インフラ
Agent     = 頭脳
MCP       = 外部世界への手足
```

`Stackchan`はファームウェアそのものです。マイク、スピーカー、顔、サーボ、タッチパネル、カメラ、LEDを持ちます。`Gateway`は常駐サービスで、リポジトリルートの`gateway/`パッケージがそれにあたります。セッション、メディアプレーン、ツールレジストリ、承認のやり取りを一手に引き受けます。`Agent`は会話に応答する知能で、テスト用のオフラインechoバックエンド、OpenAIのChat Completions API、あるいはHermesのワイヤ契約を実装した任意のHTTP + NDJSONエージェントのいずれかです。`MCP`はAgentがロボット外部のツール（GitHub、カレンダー、ホームオートメーション、ROSなど）に手を伸ばすための仕組みです。

このアーキテクチャの目的は、Stack-chanを特定のLLM・クラウド・Agentフレームワークに固定しないことです。OpenAIをローカルモデルへ置き換えることも、新しいAgent Backendを追加することも、Gateway側の設定変更で済みます。ファームウェアはAgentと直接会話しないため、その変更に一切気づきません。パッケージ自体のクイックスタートと構成は`gateway/README.md`を参照してください。本ドキュメントはプロトコルと挙動の仕様書です。

## 設計判断: GatewayはWebSocket越しのDockである

ファームウェアには、まさにこの種の課題向けのDockプロトコルがすでに存在していました。Android USB Dockは、USB越しに外部のRealtimeセッションと音声・制御をやり取りしており、その基盤となる2つのワイヤ契約は本機能より前から存在します。

- `stackchan.event.v1` — `conversation.start/stop/result`、`approval.*`、`task.status`（`firmware/host/app/remote-session/application-event.ts`）。
- OpenAI Realtime API風のRealtime制御プレーン — `session.created`、`session.update`/`session.updated`、`response.function_call_arguments.done`、`conversation.item.create`、`response.create`（`firmware/host/app/remote-session/realtime-session.ts`）。

Conversation Gatewayは、この**2つの契約をそのまま**、USBではなくWebSocket越しに話します。具体的には次の通りです。

- `gateway/src/protocol/stackchan-event-v1.ts`は、デバイス側`stackchan.event.v1`コーデックのGateway側ミラーです。
- `gateway/src/protocol/realtime-control.ts`は、Android USB Dockが話すのと同じRealtime制御プレーンのGateway側実装です。

ワイヤ形式が変わらないため、`RemoteConversationSession`、`createRealtimeSession()`（`realtime-session.ts`）、そして`createRemoteSessionRuntime()`（`firmware/host/app/remote-session/runtime.ts`、`firmware/host/app/remote-session/conversation-session.ts`経由）は、Gateway Dockから1行も変更せずに再利用されます。Direct-modeの`ChatService`セッションは無傷のままです。一つのターゲットのMODは常にDockを一つだけ選び、Gateway Dock（`firmware/host/app/docks/gateway/`）は`conversation.backend = 'gateway'`かつGatewayエンドポイントが設定されているときだけ起動します。

**issueが想定していなかった帰結:** デバイスがホストする身体性ツール（`stackchan.say`、`stackchan.face.setEmotion`など）には、専用の新しいメッセージ型が不要です。issueのサイドバンド候補には`tool.request`/`tool.result`が挙がっていましたが、これは不要だと判明しました。ロボットにはすでに、実行できるツールを`session.update`（`firmware/host/app/realtime-tools.ts`が構築する`RealtimeToolProvider`）で広告するチャネルがあり、Gatewayはそのツールを、USB Dockの相手側であるAndroidがすでに送っているのと同じイベント`response.function_call_arguments.done`で呼び出します。`gateway/src/conversation/conversation-session.ts`は、`session.update`をデバイスツールが「そもそも存在するかどうか」の唯一の正とみなします（詳細は[ツールと承認](#ツールと承認)を参照）。

この再利用には一つ必須の細部があります。`functionCallArgumentsDone()`（`gateway/src/protocol/realtime-control.ts`）は、すべての関数呼び出しに`stackchan_session_update_id`を付与し、その値はツールを広告した`session.update`の`event_id`です。デバイス側（`firmware/host/app/remote-session/realtime-session.ts`の`executeFunction()`）は、`stackchan_session_update_id`が直近に確認応答した`session.update`と一致しない呼び出しを破棄します。これは競合を防ぐためです。デバイスのツールプロバイダが変わった（新しい`session.update`が来た）タイミングで、前の世代からの呼び出しがまだ処理中だった場合、デバイスはその古い呼び出しを、すでに置き換わったプロバイダに対して実行してしまう代わりに破棄します。

`stackchan.event.v1`とRealtime制御プレーンに本当に欠けているもの——セッションのハンドシェイク、能力ネゴシエーション、メディアプレーン、トランスクリプト、Agentのエラー——だけが、新しいサイドバンドスキーマ`stackchan.gateway.v1`に収まります。次節で説明します。

## `stackchan.gateway.v1` サイドバンド

Gateway側は`gateway/src/protocol/stackchan-gateway-v1.ts`に定義され、デバイス側は`firmware/host/modules/conversation/gateway/gateway-protocol.ts`にミラーされます。`STACKCHAN_GATEWAY_PROTOCOL_VERSION`は`1`です。すべてのメッセージは`schema: 'stackchan.gateway.v1'`と`type`を持ちます。

| type | 方向 | 必須フィールド |
| --- | --- | --- |
| `session.hello` | device → gateway | `protocolVersion`、`deviceId`、`clientId`、`capabilities`（`audioInput`、`audioOutput`、`embodiment`、`approval`）。`token`は任意 |
| `audio.input` | device → gateway | `seq`、`payload`（base64エンコードされたPCM16フレーム） |
| `audio.input.end` | device → gateway | `seq` |
| `text.input` | device → gateway | `text` |
| `session.ready` | gateway → device | `protocolVersion`、`sessionId`、`audio.input`、`audio.output`、`features`（`audioInput`、`audioOutput`、`approval`、`tools`） |
| `transcript.input` | gateway → device | `text`、`final` |
| `transcript.output` | gateway → device | `text`、`final` |
| `audio.started` | gateway → device | `responseId`、`format` |
| `audio.chunk` | gateway → device | `responseId`、`seq`、`payload`（base64エンコードされたPCM16フレーム） |
| `audio.completed` | gateway → device | `responseId` |
| `agent.error` | gateway → device | `code`、`message`、`fatal` |
| `robot.directive` | gateway → device | `directive`、`params` |

`GatewayAudioFormat`は一貫して`{ codec: 'pcm16', sampleRate, channels }`です。V1では`codec: 'pcm16'`しかネゴシエーション対象になりません。`GatewayErrorCode`は`unauthorized`、`unsupportedProtocol`、`unsupportedAudioFormat`、`agentUnavailable`、`sttFailure`、`ttsFailure`、`toolFailure`、`internal`のいずれかです。

`robot.directive`は、結果を期待しないディレクティブ向けのfire-and-forget版として文書化されています。スキーマは双方に存在しますが、本変更ではまだ送信も処理もされません（[実装済みの範囲と未実装の範囲](#実装済みの範囲と未実装の範囲)を参照）。デバイスがホストするツール呼び出しは、明示的にこのスキーマの対象外です。前述のRealtime制御プレーンに乗ります。

### 独立して保守される2つのミラー

`gateway/src/protocol/stackchan-gateway-v1.ts`と`firmware/host/modules/conversation/gateway/gateway-protocol.ts`は、共有パッケージではなく、ほぼ同一の内容を持つ2つの独立したファイルです。ファームウェア側のコピーは、Moddable XSランタイム上でコンパイル・実行できる必要があるため、意図的にNodeの型やXS以外のAPIを一切含みません。Gateway側のコピーはNode.js上で動作します。両ファイルの冒頭コメントには、どちらか一方を変更したときはワイヤ形式をバイト単位で一致させ続けるよう明記されています。`stackchan.event.v1`についても同様で、Gatewayのミラー（`gateway/src/protocol/stackchan-event-v1.ts`）はデバイス自身のコピー（`firmware/host/app/remote-session/application-event.ts`）と`gateway/src/protocol/contract.test.ts`によって突き合わされ、共有されるワイヤ定数が一致することを検証しています。

## ハンドシェイクと能力ネゴシエーション

1. デバイスはGatewayの設定済みエンドポイントへWebSocketを開き、`deviceId`、`clientId`、任意の`token`、`capabilities`（送受信できる音声フォーマット、ホストしている身体性ツール名、承認UIを表示できるか）を添えて`session.hello`を送信します。
2. `gateway/src/server/device-session.ts`（`handshake()`）は、次の順にメッセージを検証します。
   - **プロトコルバージョン。** `hello.protocolVersion`がGatewayの`STACKCHAN_GATEWAY_PROTOCOL_VERSION`より新しい場合、Gatewayは`agent.error(code: 'unsupportedProtocol', fatal: true)`を送ってソケットを閉じます（WebSocketコード`1008`）。デバイス側のブリッジ（`firmware/host/modules/conversation/gateway/gateway-bridge.ts`）は、`session.ready`に対して対称的なチェックを行います。Gatewayの`protocolVersion`がデバイス自身の定数より新しい場合、ブリッジは`transportState`を`unsupported`にし、`session.ready`の通常処理に到達する前に、同じ`agent.error`をローカルで合成します。
   - **認証。** `deviceId`、`clientId`、`token`を添えて`options.authenticate(...)`が呼ばれます。拒否されると`agent.error(code: 'unauthorized', fatal: true)`が送られソケットが閉じます。トークン比較の詳細は[セキュリティ](#セキュリティ)を参照してください。
   - **音声フォーマットのネゴシエーション。** `negotiateAudioFormat()`は、デバイスが提示した（`hello.capabilities.audioInput`/`audioOutput`内の）フォーマットのうち、Gatewayも対応している最初の1つを、`codec`・`sampleRate`・`channels`の完全一致で選びます。どちらかの方向で共通集合が空の場合、`agent.error(code: 'unsupportedAudioFormat', fatal: true)`が送られソケットが閉じます。
3. 成功すると、Gatewayはセッションidを作成し、新しいツールレジストリと`ConversationSession`を構築したうえで、ネゴシエーションされた`audio.input`/`audio.output`フォーマットと`features`を添えて`session.ready`を送ります。`features.audioOutput`は、設定されたTTSアダプターの名前が`'null'`でない場合のみ`true`になります。これは、誰が話すかをデバイスが判断するためのフラグです（[メディアプレーン](#メディアプレーン)を参照）。`features.approval`は、デバイスが`capabilities.approval`で主張した値をそのまま返します。
4. `session.ready`の後にのみ、GatewayはRealtime制御プレーンを開き、`session.created`を送信します。デバイスは`session.update`で応答し、これによって身体性ツールが広告され、会話が実際にツール呼び出しを処理できるようになります。

すでにハンドシェイクを終えた接続に2回目の`session.hello`が届いた場合は無視されます（リセットとしてではなく、プロトコルエラーとしてログに記録し破棄されます）。ハンドシェイク完了前に届いたどんな種類のメッセージも、同様にエラーを起こさずログに記録して破棄されます。

## 会話状態

GatewayとファームウェアはRemoteConversationStateという1つの状態機械を共有します。`standby / connecting / listening / recognizing / speaking / blocked`です。両側のプロトコルミラー（それぞれの`stackchan-event-v1.ts`）に定義されており、Android USB Dockがこれまでも報告してきたのと同じenumです。

**Gateway側。** `gateway/src/conversation/conversation-session.ts`がこの状態機械を明示的に駆動します。Agentセッション作成中は`connecting`、立ち上がると`listening`、最終的な入力トランスクリプトまたは`text.input`が届くと`recognizing`、Agentの音声または最終出力トランスクリプトを配信中は`speaking`、ターンが終わると`listening`に戻り、致命的な`agent.error`が起きると`blocked`になります（そこから復帰できるのは新しい`conversation.start`を経て`conversation.result`が返るときのみです）。

**デバイス側。** USB Dockは1バイトのステータスバイトから状態を得ます（`firmware/host/app/docks/android-usb-audio/runtime.ts`の`onStatusChanged(status: number)`、`usbAudioConversationState()`でマッピング）。Gateway Dockにはそのようなバイトがありません。すでに受信している`stackchan.gateway.v1`サイドバンドから自ら状態を導出します。そのマッピングは`gatewayConversationState()`（`firmware/host/app/docks/gateway/runtime.ts`）にあります。

| サイドバンドメッセージ | 結果となる状態（`standby`/`blocked`でない場合） |
| --- | --- |
| `transcript.input` | `recognizing` |
| `transcript.output` | `speaking` |
| `audio.started` | `speaking` |
| `audio.completed` | `listening` |
| `fatal: true`の`agent.error` | `blocked` |
| それ以外 | 変化なし |

`standby`/`blocked`に対するガードは双方向に重要です。会話が完全に停止した後、あるいは障害が起きた後は、遅れて届くサイドバンドのトラフィック（すでに片付けられたターンに対する`audio.completed`など）が状態遷移を静かに復活させることはありません。この関数がエクスポートされているのは、そのコメントにもある通り「この対応関係は2つのプレーンをつなぐ契約であり、ここでの回帰は他のどのテストからも見えない」からです。

## メディアプレーン

V1の唯一の音声フォーマットは、符号付き16ビットリトルエンディアンPCM、モノラルで、デフォルトでは16 kHzでネゴシエーションされます（`stackchan-gateway-v1.ts`の`DEFAULT_INPUT_AUDIO_FORMAT`/`DEFAULT_OUTPUT_AUDIO_FORMAT`）。他のメッセージと同じJSONエンベロープの中にbase64テキストとして格納され、V1にはバイナリWebSocketフレーミングはありません。`gateway/src/server/gateway-server.ts`は、バイナリフレームを受け取るとパースを試みず、ログを出して破棄します。

Gateway側では、`gateway/src/conversation/audio-session.ts`が受信した`audio.input`フレームをバッファリングし、エネルギーベースのVAD（`gateway/src/audio/vad.ts`。アクティベーションレベルとリリースレベルのRMSしきい値によるヒステリシスと、ハングオーバー時間）で発話の境界を検出し、完成した発話を設定済みの`SttAdapter`（`gateway/src/audio/stt.ts`）に渡してテキスト化します。`audio.input.end`も、バッファされている内容をフラッシュします。これはGatewayのVADではなくデバイス側がターンの区切りを決める場合のためです。得られたテキストは、`text.input`とまったく同じように通常の入力ターンとしてAgentへ渡されます。

issueが述べていた**VAD → STT → Agent → TTS**のループは、Gateway側では実際に成立しています。`conversation-session.ts`はAgentの`text`/`audio`イベントを`transcript.output`に変換し、さらに（Agentが自前で音声を生成する場合は）ストリーミングの`audio.chunk`、あるいは設定済みの`TtsAdapter`（`gateway/src/audio/tts.ts`）で最終テキストを合成して`audio.started`/`audio.chunk`/`audio.completed`として配信するかのいずれかを行います。

**GatewayにTTSアダプターが設定されていない場合**（デフォルトの`tts.type: none`）、アダプターは`createNullTts()`となり、その`synthesize()`は一切チャンクを生成しません。このとき`session.ready.features.audioOutput`は`false`になり、Gatewayは`transcript.output`だけを送信します。ロボット側は、それを自前のローカルTTSで読み上げることが期待されます。これが、Phase 0のテキストMVPが、双方に音声インフラを一切持たずに成立している理由です。Gateway Dockのプレゼンテーション層（`firmware/host/app/docks/gateway/presentation.ts`）はこの契約を実装しています。デフォルトでは「ローカルで話す」モードから始まり、`runtime.ts`は`session.ready`が来るたびに`features.audioOutput`を読み直して`setSpeakLocally()`を切り替えます。誰が話すかは、静的なデバイス設定フラグではなく、セッションごとにGatewayが決めます。

## ツールと承認

`gateway/src/tools/tool-registry.ts`は、1つの会話につき1つの統合ツールセットを保持します。`ChatTool`互換なので（`gateway/src/tools/tool-types.ts`）、同じツール記述がDirect-modeの`ChatService`セッションとGateway-modeのAgentセッションの両方に使えます。ツールは`gateway`ホストか`device`ホストのいずれかです（`ToolHost`）。

- **Gateway-hostedツール**はGatewayプロセス内で実行されます。`gateway/src/tools/mcp-adapter.ts`経由で到達するMCPサーバー（設定の`tools.mcp: true`と`tools.servers`リストで有効化）と、任意の組み込みツールです。
- **Device-hostedツール**はロボット自身で実行され、前述のRealtime制御プレーン越しに呼び出されます。代表例は6つの身体性ツールで、`gateway/src/tools/stackchan-tools.ts`にリッチなJSON Schemaパラメーターとともに一度だけ定義され、デバイス側では`firmware/host/app/realtime-tools.ts`で実装されています。

  | ツール | パラメーター |
  | --- | --- |
  | `stackchan.say` | `text`（文字列、必須） |
  | `stackchan.face.setEmotion` | `emotion`（文字列enum、必須）: `neutral`、`angry`、`sad`、`happy`、`sleepy`、`doubtful`、`cold`、`hot` |
  | `stackchan.motion.setPose` | `yaw`（数値、必須）、`pitch`（数値、必須）、`durationSeconds`（数値） |
  | `stackchan.motion.lookAt` | `x`、`y`、`z`（いずれも数値、必須） |
  | `stackchan.light.set` | `r`、`g`、`b`（いずれも数値、必須）、`durationMs`（数値） |
  | `stackchan.camera.capture` | （パラメーターなし） |

  上表はAgentが実際に目にするGateway側スキーマです。デバイス自身の`realtime-tools.ts`実装はこれに加えて、`stackchan.say`に任意の`volume`、`stackchan.motion.setPose`を`position {x,y,z}` / `rotation {r,p,y}`と任意の`time`として構造化したもの、`stackchan.light.set`に任意の`led`名と`on`/`duration`を受け付けます。`mergeDeviceTools()`（`stackchan-tools.ts`）が両者を突き合わせます。**どのツールが存在するかは常にデバイス自身の広告が優先し**、正典スキーマはデバイスが広告した名前についてのみ、より詳細な説明とパラメーターを補います。デバイスが広告**していない**ツール名の正典スキーマは丸ごと破棄されます。Gatewayは、ロボットが実際には持っていない身体の一部をAgentへ提供することはありません。`realtime-tools.ts`はデバイス側からも同じ規則を強制します。各ツールは、そのビルドの`StackchanContext`に必要な能力が実際に存在する場合にのみ`session.update`へ含まれます（たとえば`context.lighting`とLEDが存在しない限り`stackchan.light.set`は広告されません）。

副作用のあるツールは、Gateway設定の`tools.requireApproval`で承認の対象にできます。ツール名の完全一致、または末尾`*`によるワイルドカードで指定し、`command`と`fileChange`の2種類に分かれます（`tool-registry.ts`の`toolPermissionFor()`）。ツールの解決された権限が`safe`でない場合、`gateway/src/tools/tool-invoker.ts`は実行前に`gateway/src/approval/approval-controller.ts`経由で呼び出しをルーティングします。

1. `approval.request`がデバイスへ送られます（`requestId`、`kind`、`title`、`summary`、デフォルトで2000文字に切り詰められたJSONの`detail`。切り詰められた場合は`truncated: true`）。
2. デバイスは、操作者へ提示できたら`approval.presented`で応答し、続いて`decision: 'approve' | 'decline'`を伴う`approval.response`を送ります。
3. コントローラーは`approval.resolved`を送って保留中の呼び出しを確定させます。`approve`ならツールを実行し、`decline`なら実行せずに拒否された結果を返します。`approvalTimeoutMs`（デフォルト120,000ミリ秒。Gatewayごとに設定可能）以内に応答がない場合は`approval.suspended`を送って呼び出しを拒否とし、呼び出し元が永遠にハングしないようにします。

承認の有無にかかわらず、すべてのツール呼び出しは`task.status(state: 'running')` / `task.status(state: 'idle')`で括られます（`approval-controller.ts`の`beginTask()`）。承認が必要だったかどうかに関係なく行われ、これがロボットが「Agentが何かを実行している」というアクティビティを示すための合図になります。

## 設定

**デバイス側**（`firmware/host/modules/conversation/gateway/gateway-config.ts`、型`GatewayConfig`）は、hostの`gateway`設定ブロックから読み込まれるか、`resolveGatewayConfig()`経由でMODによって有効化されます。

| キー | 意味 |
| --- | --- |
| `enabled` | Gateway Dockを起動するかどうか。hostの設定でオフになっていても、MODが強制的にオンにできます。 |
| `endpoint` | `ws://`または`wss://`のURL。`parseGatewayEndpoint()`がホスト/ポート/パスに分解し、ポートは省略時80/443、パスは省略時`/`になります。 |
| `deviceId` | このロボットの安定したid。`session.hello`で送信されます。 |
| `clientId` | クライアントインスタンスのid。同じく`session.hello`で送信されます。 |
| `token` | 任意のデバイストークン。詳細は[セキュリティ](#セキュリティ)を参照。 |
| `autoStart` | ヘッドタッチジェスチャーを待たず、Stack-chanコンテキストが作成された時点でリモート会話セッションを起動します。 |
| `presentationEnabled` | DockがバルーンやTTSなど自前のプレゼンテーションを表示するかどうか（`false`で無効化。プレゼンテーションを別の方法で行うMOD向け）。 |
| `microphone` | gatewayメディアプレーン越しのマイクストリーミングをオプトインします。デフォルトはオフです（[実装済みの範囲と未実装の範囲](#実装済みの範囲と未実装の範囲)を参照）。 |

`endpoint`、`deviceId`、`clientId`はいずれも有効化に必須です。1つでも欠けていると、Dock起動時にどのフィールドが欠けているかを名指しして即座に失敗します（`requireGatewayIdentity()`）。デバイスが自分自身を識別できないエンドポイントへソケットを開いてしまうことはありません。

**Gateway側**: 完全なスキーマは`gateway/gateway.example.yaml`と`gateway/src/config.ts`を参照してください——`gateway.listen`、`gateway.token`/`gateway.devices`、`agent.*`、`stt.*`、`tts.*`、`tools.*`です。YAML内の任意の文字列値は`${NAME}`として環境変数を参照でき、未設定の参照は空文字列になる代わりに起動時に失敗します。

**LLMの資格情報はGatewayに留まります。** 上記のデバイス設定には、OpenAIキー、Hermesエンドポイントのトークンなど、クラウド資格情報のフィールドが一切ありません。それらはGateway自身の設定（`agent.apiKey`、`stt.apiKey`、`tts.apiKey`、`tools.servers[].token`など）にのみ存在します。ロボットがGateway側に持つ身元情報は、URL・デバイスid・Gatewayトークンに限られます。

## セキュリティ

- **定数時間でのトークン比較。** `gateway/src/server/authenticator.ts`は、提示されたトークンと期待値を`node:crypto`の`timingSafeEqual`で比較し、長さが一致しない場合でも自分自身との比較を行って同じコストの処理を実行することで、タイミングから情報が漏れないようにしています。
- **デバイスごとのトークンは共有トークンより優先されます。** `gateway.devices`に自分の`token`とともに登録されたデバイスは、そのトークンでのみ照合されます。共有の`gateway.token`は、トークンを持たないデバイスのためのフォールバックです。これにより、1台のロボットを無効化するために、フリート全体の資格情報を回転させる必要はありません。
- **`wss://`は信頼できるLAN以外では前提となります。** Gatewayサーバー自体は平文のWebSocketを話します。TLS終端は`gateway-server.ts`の内部ではなく、その手前（リバースプロキシやロードバランサー）で行われることが前提です。
- **ツール権限ポリシー。** `tools.requireApproval`（[ツールと承認](#ツールと承認)を参照）は、シェルコマンド、ファイル書き込み、外部サービスへの到達など、副作用のあるツールを、Agentに無監督で実行させず、ロボット自身の承認UIの背後に置くための仕組みです。
- **`requestId`によるトレース。** すべての`stackchan.event.v1`メッセージと承認は`requestId`を持つため、ある会話とそれが引き起こしたツール呼び出しをログ上でエンドツーエンドに突き合わせられます。

## 実装済みの範囲と未実装の範囲

**実装済み:**

- 完全な`stackchan.gateway.v1`制御プレーン（ハンドシェイク、メディアプレーン、トランスクリプト、Agentエラー）と、既存の`stackchan.event.v1`およびRealtime制御プレーンの再利用。Gateway・ファームウェア双方。
- `session.hello` → `session.ready`ハンドシェイク。双方向のプロトコルバージョン拒否とPCM音声フォーマットのネゴシエーションを含みます。
- エンドツーエンドのテキスト会話: `text.input`またはGateway側STT → Agent → `transcript.output`。GatewayにTTSアダプターが設定されていない場合はデバイスがローカルで読み上げます。これがPhase 0の経路であり、音声トランスポートを一切必要としません。
- デバイスがホストする身体性ツール: `stackchan.say`、`stackchan.face.setEmotion`、`stackchan.motion.setPose`、`stackchan.motion.lookAt`、`stackchan.light.set`、`stackchan.camera.capture`。デバイスの`StackchanContext`が実際にサポートする範囲に応じて条件付きで広告され、Realtime制御プレーン越しに呼び出されます。
- `tools/mcp-adapter.ts`経由のGateway-hostedなMCPツール。
- 承認: `approval.request → presented → response → resolved`の完全なハンドシェイクと、タイムアウト時の`approval.suspended`、すべてのツール呼び出しを括る`task.status`。
- 3つのAgent Backend: `echo`（オフライン、決定的、結合テストのダブルとしても使用）、`openai`（tool callingに対応したChat Completions）、`hermes`（`gateway/src/agent/hermes-backend.ts`に記述された契約を実装する任意のHTTP + NDJSONエージェント）。
- Gateway側の音声パイプライン: エネルギーベースのVAD、`SttAdapter`/`TtsAdapter`のペア（OpenAIバックエンドまたはnullパススルー）、ネゴシエーションされた出力フォーマットへ合わせるPCMリサンプリング。
- 指数バックオフによるデバイス側の再接続（`gateway-bridge.ts`: 初期遅延1秒、最大30秒まで倍増）。WebSocketが切れても操作者の介入なしに復旧します。
- ストリーミングされたAgentターンのデバイス側再生: `presentation.ts`は`audio.chunk`のペイロードをバッファし、`audio.completed`が来た時点で1つの連続したバッファとして再生します。Piuにはフレーム単位で供給できるPCMシンクがないためです。

**未実装、意図的に後回しにされているもの:**

- **デバイス上での継続的なマイクキャプチャ。** Gatewayのプロトコルと`audio-session.ts`は`audio.input`/`audio.input.end`を完全に受け付けますし、デバイス側の`GatewayConfig.microphone`フラグもオプトインのスイッチとして存在しますが、ファームウェアにはまだ実際にマイクフレームをキャプチャして`audioInput()`/`audioInputEnd()`（`gateway-protocol.ts`）を呼び出すコードパスがありません。Android USB Dockがすでに持っているのと同種のオーディオワーカーが必要です。現状、Gateway Dockが Agentへ到達する経路は`text.input`だけです。
- **フレーム単位の再生。** デバイスは1ターン分の`audio.chunk`フレームをまとめてバッファし、`audio.completed`が届いてから初めて再生します。ストリーミングPCMシンクはまだ存在せず、可聴遅延は最初のチャンクではなくAgentのターン1回分になります。
- **デバイス上での`robot.directive`処理。** このメッセージ型は双方のプロトコルミラーに存在しますが、送信も処理も行われません。身体性の表現は、このfire-and-forgetなディレクティブチャネルではなく、前述のツール呼び出しの経路だけを通じて行われます。

本変更は実機のStack-chanハードウェアでは一切実行されていません。ファームウェア側の各実装（`gateway-bridge.ts`、`gateway-protocol.ts`、`gateway-config.ts`、Gateway Dock自体）は、`node --test`によって純粋なロジックとモック化されたトランスポートに対して検証されていますが、デバイス上では検証されていません。

## Phaseマッピング

issueは4つのPhaseを定義していました。実際に実装された内容は次の通りです。

- **Phase 0 — Gateway Text MVP。** 完全に実装済みです。Gateway接続、`conversation.start`/`stop`、サイドバンドマッピングによる会話状態の同期、3つのAgent Backendいずれかを通じたテキストLLM応答、そしてロボットが自前のTTSで応答を読み上げることまで含みます。
- **Phase 1 — Voice。** 部分的に実装済みです。ループのGateway側半分は完成しています——VAD、STT、TTS合成、ストリーミングされる`audio.chunk`出力はすべて存在し、ユニットテストされています。デバイス側半分は未完成です。ストリーミングマイクキャプチャがまだ存在せず（前述の通り）、再生はフレーム単位ではなくターンごとのバッファリングです。進行中のAgentターンの割り込み/キャンセルは`AgentSession`インターフェース（`cancel()`）として定義されていますが、本変更ではデバイス発のどのイベントからも配線されていません。
- **Phase 2 — Embodiment。** ほぼ実装済みです。6つの身体性ツールすべてが存在し、デバイスの能力に応じて条件付きで広告され、どのAgent Backendからも呼び出し可能です。Touch/IMUのコンテキストをAgentへの入力として渡すこと（Agentがツール経由で出力を駆動するのとは逆方向）は、本変更の対象外です。
- **Phase 3 — Agent / MCP。** 実装済みです。`echo`に加えて`hermes`・`openai`のAgent Backend、MCPツールレジストリ、承認、`task.status`のすべてが揃っており、エンドツーエンドで配線されています。
