---
"stack-chan": minor
"stackchan-web": minor
---

MiniStack MOD (`firmware/mods/examples/ministack/`) が、PC の要求に答えるだけでなく機器側で起きたことを報告できるようになりました。イベントは monotonic な ID を持ち、PC が確認するまで MOD が保持して再送するため、応答が失われても完了した命令が「永久に待たれる命令」になりません。バッファが溢れたときは最古を捨てて `gap` として報告するので、PC は取りこぼしを黙って見逃さず `state.get` で再同期できます。

写真と録音は 2 KiB の Local Peer envelope に収まらないため、同じ認証済みチャネル上で PC がチャンクを引き取る方式にしました。あわせて本体タッチ（短押し・長押し。長押しはそれ自体が停止操作）、`conversation.listen`、`photo.capture`、`face.set` の色指定、列挙された設定だけを変更する `config.set` を追加し、ブラウザ検証クライアント (`web/ministack/`) をこの新しいプロトコルに対応させています。
