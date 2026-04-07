# New LINE App Guide

このリポジトリは、`Node.js + Express + LINE Messaging API + Render` の土台として再利用できるように整理してあります。

## そのまま使える共通部分

- `src/create-line-bot-server.js`
  - Webhook受信
  - LINE署名検証
  - `GET /` のヘルスチェック
- `src/line.js`
  - LINE Messaging API への reply / push
  - 画像メッセージの取得
- `render.yaml`
  - Render の Web Service + Postgres のひな形
- `src/config.js`
  - `.env` の読み込み
  - `APP_NAME` を使ったアプリ名とDBパスの切り替え

## 新しい○○アプリを作るときに主に触る場所

- `src/runtime.js`
  - 今のカロリーbotの起動ファイルです
  - 新しいアプリでは `handleEvent` の中身を差し替えるのが基本です
- `src/openai.js`
  - OpenAI連携が必要な場合に流用できます
- `src/db.js`
  - 保存したいデータに合わせてテーブルや関数を差し替えます

## 最短の流用手順

1. `APP_NAME` を新しいアプリ名に変更します
2. `src/runtime.js` の `handleEvent` を新アプリ向けに書き換えます
3. 使わない `db.js` や `openai.js` の処理を外します
4. Render では `render.yaml` を使ってデプロイします
5. LINE Developers の Webhook URL を `https://your-service.onrender.com/webhook` に設定します

## 例

テキストを受けたらそのまま返すだけのアプリにしたい場合は、`handleEvent` の中を次のような考え方に変えるだけで十分です。

- 画像処理を外す
- OpenAI呼び出しを外す
- `event.message.text` を `replyMessage` で返す

## 環境変数

`.env.example` をもとに設定します。

- `APP_NAME`
- `PORT`
- `APP_TIMEZONE`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `DATABASE_URL`
- `DATABASE_PATH`

OpenAI や DB が不要なアプリなら、その依存コードごと外して軽くできます。
