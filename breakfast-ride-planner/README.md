# 朝食ライド ルート提案 (Breakfast Ride Planner)

数人での朝食ライド向けに「開いている店を探す + そこまでのルートを提案する」MVP。
詳細仕様は [docs/specification.md](docs/specification.md) を参照。

既存の [cycling-tracking-app](../cycling-tracking-app) (本体アプリ) の技術資産・構成を踏襲している。

## ディレクトリ構成
- `docs/` : 仕様書
- `progress/` : タスク管理・開発進捗
- `src/server/` : バックエンド(Node.js / Express)
- `src/mobile/` : モバイルアプリ(Expo / React Native, 未着手)

## バックエンドの起動方法
1. `src/server/.env.example` を `src/server/.env` にコピーし、`DATABASE_URL` と `GOOGLE_MAPS_API_KEY` を設定する。
   - `GOOGLE_MAPS_API_KEY` は Places API・Directions API・Elevation API を有効化した Google Cloud プロジェクトのAPIキー。
2. Dockerでローカルに PostgreSQL(PostGIS付き)を起動する:
   - `docker compose -f src/server/docker-compose.yml up -d`
3. データベーススキーマを初期化する:
   - `cd src/server`
   - `npm install`
   - `npm run init-db`
4. サーバーを起動する:
   - `npm start`(デフォルトポート3000)

## API概要
- `GET /api/start-locations/recent` — 直近使用した出発地点の履歴を取得
- `POST /api/shops/search` — 出発地点・希望距離・出発時刻から候補店舗(最大5件)を検索。往復獲得標高・営業時間フィルタ・訪問済み除外を含む
- `GET /api/shops/visited` — 過去に訪問済み(ルートで選択済み)の店舗一覧
- `GET /api/shops/:id/routes` — ある店舗について過去に生成・使用したルート一覧(参考表示用)
- `POST /api/routes` — 選択した店舗への往復ルートを生成(行き・帰りを別ルートにし、標高プロファイルを算出)
- `POST /api/routes/:id/gpx` — 生成済みルートをGPXファイルとして保存
- `POST /api/routes/:id/share` — ルートを共有済みとして記録(`shared_at`を設定)
- `GET /api/usage/summary` — Places/Directions/Elevation API の今月の呼び出し回数の目安を取得(コスト管理用)

## テスト
`cd src/server && npm test` でテストを実行できる(Node.js組み込みのテストランナー、`.env`読み込みのため`dotenv/config`をプリロード、モジュールモックのため`--experimental-test-module-mocks`を使用)。Google APIキーが無くても実行可能。
- 純粋ロジックのユニットテスト: 標高計算・営業時間判定・ポリラインデコード・帰りルートのオフセット計算(`test/geo.test.js` 等)
- `lib/googleMaps.js`(Google API境界)・`lib/db.js`(DB境界)だけをモック化した結合テスト: `services/routeBuilder.js`のbicycling→drivingフォールバック・waypointリトライ・標高プロファイル結合(`test/routeBuilder.integration.test.js`)、`services/shopSearch.js`の営業時間フィルタ・訪問済み除外・標高キャッシュ・件数制限(`test/shopSearch.test.js`)

## コスト管理
- Places / Directions / Elevation の呼び出しはすべて `api_usage_logs` テーブルに記録される(`src/server/lib/googleMaps.js`)。
- `GET /api/usage/summary` で当月の呼び出し回数を確認できる。$200無料枠を超えないよう、実運用開始後は定期的に確認すること。

## モバイルアプリの起動方法
1. `cd src/mobile && npm install`
2. `src/mobile/src/config.js` の `API_BASE_URL` を開発機のLAN IP:3000に合わせて変更する(cycling-tracking-appと同様の理由。実機テスト時は同じWi-Fi上からアクセスできるIPが必要)。
3. `src/mobile/app.json` の `plugins` → `react-native-maps` → `androidGoogleMapsApiKey` に実際のGoogle Maps APIキーを設定する(現状プレースホルダーのまま)。**`app.json`はGit管理対象なので、サーバー用の`.env`のキーをそのまま使い回さないこと**。Maps SDK for Androidのみ有効化し、パッケージ名(`com.breakfastrideplanner.mobile`)+SHA-1で制限した専用キーを別途発行して使う(実機ビルド前にSHA-1を取得してから設定する)。
4. `npx expo start` で起動(Expo Go / dev clientでの実機確認は未検証。`react-native-maps`はネイティブモジュールのためExpo Goでは動作しない可能性が高く、cycling-tracking-app同様にdev client / EASビルドが必要になる見込み)。

画面遷移はライブラリを使わず`App.js`内のローカルstateで管理する(MVPは実装スピード優先の方針)。`npx expo-doctor`(21/21)・`npx expo export --platform android`(Metroバンドル)はいずれもエラー無く通過を確認済み。実機・エミュレータでの動作確認はまだ行っていない。
