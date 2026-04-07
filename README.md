# calorie-line-app

料理写真を LINE で送ると、OpenAI でカロリーを推定し、必要な運動量と今週の累計カロリーを返す `Node.js + Express` アプリです。

## 機能

- `LINE Messaging API` の webhook を受信
- 画像メッセージを `OpenAI API` に送り、料理名と推定カロリーを算出
- `SQLite` にユーザーごとの食事ログを保存
- 今週の累計カロリーを返信
- 毎週月曜 0:00 (`APP_TIMEZONE` 基準) に週次集計をリセット

## セットアップ

```bash
cp .env.example .env
npm install
```

`.env` に以下を設定してください。

```env
PORT=3000
APP_TIMEZONE=Asia/Tokyo
LINE_CHANNEL_ACCESS_TOKEN=your_line_channel_access_token
LINE_CHANNEL_SECRET=your_line_channel_secret
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4.1-mini
DATABASE_PATH=./data/calorie-line.sqlite
```

`DATABASE_PATH` を省略した場合、Windows では `%LOCALAPPDATA%\calorie-line-app\calorie-line.sqlite` を使います。OneDrive 配下で SQLite の I/O エラーが出る環境では、この省略設定のまま使うのが安全です。

## 起動

```bash
npm run dev
```

本番起動:

```bash
npm start
```

## LINE Developers 側の設定

- Webhook URL を `https://your-domain/webhook` に設定
- Webhook を有効化
- 応答メッセージはオフ推奨

## 返信内容

画像を受け取ると、次のようなテキストを返します。

```text
料理: 親子丼
推定カロリー: 720 kcal
運動目安: ウォーキング 180分 / ジョギング 90分
今週の累計: 1520 kcal
補足: 鶏肉と卵の丼ものに見えます。
写真からの推定値です。
```

## 実装メモ

- `src/index.js`: Express サーバーと LINE webhook
- `src/openai.js`: 画像解析と JSON パース
- `src/db.js`: SQLite 初期化、食事ログ、週次集計
- `src/week.js`: 月曜始まりの週キー計算
- `src/line.js`: LINE 署名検証と API 呼び出し

## 注意点

- OpenAI の画像認識結果なので、カロリーはあくまで推定です
- `OPENAI_MODEL` は画像入力に対応したモデルを指定してください
- `DATABASE_PATH` を指定しない場合、SQLite ファイルは OS ごとのローカルデータ領域に作成されます
