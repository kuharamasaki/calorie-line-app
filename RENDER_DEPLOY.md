# Render Deploy Guide

このアプリはローカルでは `SQLite`、Render では `Postgres` を使えます。

## なぜ SQLite のままではだめか

Render の無料 Web Service はローカルファイルを永続化しないため、`SQLite` の DB ファイルが消える可能性があります。

無料で公開する場合は `Render Postgres` と `DATABASE_URL` を使うのが安全です。

## Render で使う構成

- Web Service: `Render`
- Database: `Render Postgres`
- Build Command: `npm install`
- Start Command: `npm start`

## 環境変数

- `APP_TIMEZONE=Asia/Tokyo`
- `LINE_CHANNEL_ACCESS_TOKEN=...`
- `LINE_CHANNEL_SECRET=...`
- `OPENAI_API_KEY=...`
- `OPENAI_MODEL=gpt-4.1-mini`
- `DATABASE_URL=...`

`PORT` は Render が自動で設定します。

## Webhook URL

デプロイ後に LINE Developers の Webhook URL を次に更新します。

```text
https://your-service.onrender.com/webhook
```
