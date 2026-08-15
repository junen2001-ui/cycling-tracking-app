# 進捗

## 2026-08-16(続き): shopSearch/routeBuilderのモック結合テストを追加
Google APIキー無しで進められる範囲として、`lib/googleMaps.js`(Google API境界)・`lib/db.js`(DB境界)だけをモック化し、`services/shopSearch.js`・`services/routeBuilder.js`本体のロジックは実物のまま通す結合テストを追加した。

- `test/routeBuilder.integration.test.js`: bicycling失敗時のdrivingフォールバック、帰りルートのwaypoint付与とwaypoint失敗時の無waypoint再試行、bicycling/driving両方失敗時に例外を投げること、行き→帰り通しの標高プロファイル結合(距離オフセット)と獲得標高計算を検証。
- `test/shopSearch.test.js`: 営業時間不明の店舗を除外せず候補に含めること、到着予想時刻に閉店確実な店舗を除外すること、訪問済み店舗を除外しPlace Details呼び出し自体を避けること(コスト削減の実効性を確認)、往復獲得標高がキャッシュされ2回目以降Directions/Elevationを呼ばないこと、候補が距離順・最大5件に制限されることを検証。
- **モック方式**: Node.js組み込みテストランナーの`mock.module()`(Node 22+の実験的機能、`--experimental-test-module-mocks`フラグが必要)を使用。ハマった点2つ:
  1. 相対パス指定は拡張子(`.js`)を省略するとESM解決で`ERR_MODULE_NOT_FOUND`になる。`'../lib/googleMaps.js'`のように明示する必要がある。
  2. `shopSearch.js`は`const { pool } = require('../lib/db')`と分割代入で束縛するため、モック側の`pool`を素朴に`let`変数の再代入や`get`アクセサで差し替えても、テストごとの差し替えが反映されない(束縛時点の値のまま固定される)。固定の`queryメソッド`を持つ委譲オブジェクト(内部で実体だけを`beforeEach`ごとに差し替え)にする必要があった。
- テストが実際にバグを検知できることも確認済み(訪問済み除外のfilter条件を一時的に無効化→該当テストが失敗することを確認→元に戻した上で全テスト再度パス)。
- `package.json`の`npm test`に`--experimental-test-module-mocks`を追加。

全26件パス済み(`cd src/server && npm test`)。

## 2026-08-16: バックエンドのユニットテストを追加
API キー無しでも検証できる純粋ロジック部分(標高計算・営業時間判定・ポリラインデコード・帰りルート用オフセット計算)にユニットテストを追加した。Google Maps APIキーの取得待ちの間、実データ検証はまだできないため、代わりにコードの正しさを固める目的。

- `src/server/test/geo.test.js`: `haversineDistanceMeters`(既知の緯度1度分の距離)、`offsetMidpointPerpendicular`(中点からのオフセット距離・直交方向)
- `src/server/test/polyline.test.js`: `decodePolyline`をGoogle公式ドキュメントのサンプル文字列でデコード検証
- `src/server/test/openingHours.test.js`: `isOpenAt`の通常営業・24時間営業・日をまたぐ深夜営業・曜日不一致・情報無し(null)の各パターン
- `src/server/test/routeBuilder.test.js`: `calculateElevationGainM`(上昇分のみ合算、下降は無視)
- `services/routeBuilder.js`から`calculateElevationGainM`をexport(テスト用、動作は変更無し)
- `package.json`に`npm test`(`node -r dotenv/config --test`、Node.js組み込みテストランナー)を追加。`-r dotenv/config`が必要な理由: `routeBuilder.js`が`lib/googleMaps.js`→`lib/apiUsage.js`→`lib/db.js`を経由して読み込まれ、`lib/db.js`は`DATABASE_URL`未設定だとrequire時点で例外を投げるため。

全15件パス済み(`cd src/server && npm test`)。

## 2026-08-15: プロジェクト初期構築(仕様書読み込み → README/progress作成 → バックエンド・モバイル雛形実装)
[cycling-tracking-app](../../cycling-tracking-app)(本体アプリ)の構成・技術スタックを踏襲する形で、`docs/`・`progress/`・`src/server`・`src/mobile` のディレクトリ構成を新規作成し、[specification.md](../docs/specification.md)に基づきMVPの初期実装を行った。

### 実装内容
**バックエンド(`src/server`)** — Express + pg (PostgreSQL/PostGIS)。実際にDockerでDBを起動し、`npm run init-db`・`npm start`・主要エンドポイントのcurl疎通(バリデーションエラー・404含む)まで検証済み。
- `db/schema.sql`: `shops` / `routes` / `ride_logs` / `api_usage_logs`(仕様書のデータモデルに準拠)。`shops.google_place_id`を仕様書には無い追加カラムとして導入(Places検索結果の重複排除・訪問済み判定に実務上必要なため)。
- `lib/googleMaps.js`: Places Nearby Search / Place Details(営業時間) / Directions / Elevation の呼び出しラッパー。呼び出しごとに`lib/apiUsage.js`経由で`api_usage_logs`に記録。
- `lib/openingHours.js`: Google Placesの`opening_hours.periods`から、到着予想時刻に営業中かどうかを判定(日をまたぐ営業・24時間営業にも対応)。
- `services/routeBuilder.js`: 往復ルート生成。bicyclingモードを優先し、失敗時はdrivingモード+`avoid=highways`にフォールバック。帰りルートには行き→帰りの直線に対する垂直オフセットwaypointを与え、単純な折り返しを避ける(仕様書の「疑似ルーティング」に対応、精度は多少雑という前提のMVP実装)。Elevation APIで行き・帰り通しの標高プロファイルをサンプリングし、獲得標高(上昇分のみ合算)を算出。
- `services/shopSearch.js`: Nearby Searchで候補を取得→直線距離でプレ絞り込み(コスト削減のため上位8件のみPlace Details/Elevationを呼ぶ)→訪問済み(routesで選択済み)除外→到着予想時刻での営業時間フィルタ→距離順に最大5件。往復獲得標高は`shops.elevation_gain_round_trip_m`にキャッシュし、以後の検索で再計算しない。
  - **既知の割り切り**: この標高キャッシュは出発地点に依存しない(店舗単位でのみキャッシュ)。出発地点が変わると本来は標高も変わるはずだが、MVPでは出発地点のバリエーションが少ない前提で許容している。将来、出発地点違いでの誤差が問題になれば`(shop_id, start_location)`単位のキャッシュに見直す。
- `services/gpx.js`: GPX 1.1形式でルートを`data/gpx/{routeId}.gpx`に保存(Git管理対象外)。
- `server.js`: 仕様書のAPI一覧(README参照)をすべて実装。

**モバイル(`src/mobile`)** — Expo SDK 57。`npm install`・`npx expo-doctor`(21/21)・`npx expo export --platform android`(Metroバンドル、1407モジュール)まですべてエラー無く通過を確認済み。**実機・エミュレータでの表示確認はまだ行っていない**。
- 画面遷移ライブラリは使わず、`App.js`内のローカルstateで4画面(出発地点→条件指定→候補店舗→ルート地図)を管理(MVPは実装スピード優先の方針、仕様書の高度プロファイルグラフのライブラリ選定と同じ考え方)。
- `src/components/ElevationProfileChart.js`: `react-native-wagmi-charts`の`LineChart`を使用。本来は時系列(`timestamp`)前提のコンポーネントだが、距離(km)を`timestamp`代わりに流用する簡易実装(見た目の検証はまだ)。
- `react-native-wagmi-charts`のpeer dependency(`react-native-gesture-handler`/`react-native-reanimated`/`react-native-svg`/`react-native-worklets`)と、reanimated v4に必要な`babel.config.js`(`react-native-worklets/plugin`)・`babel-preset-expo`(devDependency)を追加。**sibling appには無い設定なので、次回別PCでセットアップする際はこれらが揃っているか要確認**。
- `app.json`の`react-native-maps`用Google Maps APIキーはプレースホルダーのまま(未設定)。

### 重要: 作業中に発見したDocker Composeのプロジェクト名衝突(伝播事故と復旧)
このセッション中に、`breakfast-ride-planner/src/server`で`docker compose up -d`を実行した際、**`cycling-tracking-app`の稼働中DBコンテナ(`cycling-tracking-db`)が誤って`breakfast-ride-planner-db`として再構成されてしまう事故が発生した**。

**原因**: 両プロジェクトのdocker-compose.ymlがどちらも`src/server`ディレクトリに置かれており、Docker Composeがプロジェクト名をディレクトリ名(`server`)から自動生成するため、**別プロジェクトなのに同じCompose project名(`server`)・同じservice名(`db`)になり、既存コンテナが「同じサービスの再構成対象」とみなされてしまった**(コンテナの再利用はcontainer_nameではなくproject+serviceの組で判定される)。

**実際の影響**: `cycling-tracking-db`コンテナはその場で`breakfast-ride-planner-db`に置き換わったが、**データボリューム(`server_cycling_tracking_pgdata`)自体は無事だった**(新しいcompose定義が別名のボリュームを参照していたため、既存データは上書きされていない)。`cycling-tracking-app/src/server`側で改めて`docker compose up -d`を実行し、正しいコンテナ名・ポート・ボリュームで復元。`participants`テーブルのレコード数(14件)が事故前と一致することを確認し、データ損失が無いことを確認済み。

**恒久対応**: `breakfast-ride-planner/src/server/docker-compose.yml`に`name: breakfast-ride-planner`を明示し、Compose project名を`cycling-tracking-app`側(`server`のまま)から確実に分離した。以後、両プロジェクトのコンテナ・ボリュームは独立して共存する(`docker ps`で`breakfast-ride-planner-db`(ポート5433)と`cycling-tracking-db`(ポート5432)が同時に確認できる状態)。
**今後の注意点**: `cycling-tracking-app/src/server/docker-compose.yml`側には`name:`が無いため、もし将来さらに別プロジェクトが`src/server`という同名ディレクトリでComposeプロジェクト名衝突を起こすと同じ事故が再発しうる。cycling-tracking-app側の修正は本タスクのスコープ外のため未実施(触っていない)。

### 未着手・次回やること
- Google Cloud ProjectでPlaces API / Directions API / Elevation APIを有効化し、`GOOGLE_MAPS_API_KEY`を実際に設定して`POST /api/shops/search`〜`POST /api/routes`を実データで検証(現状はAPIキー無しのため、DB周りのエンドポイントのみ検証済み)。
- モバイルアプリの実機/エミュレータでの動作確認(地図表示・高度プロファイルグラフの見た目・GPX保存・共有ボタンの导线)。`react-native-maps`はネイティブモジュールのためExpo Goでは動作しない可能性が高く、cycling-tracking-app同様dev client / EASビルドが必要になる見込み。
- `app.json`のGoogle Maps APIキー(Android)を実際の値に差し替え。
- コスト管理: `GET /api/usage/summary`の実運用確認(現状はロジックのみ、実際のAPI呼び出しボリュームでの動作は未検証)。
- 将来拡張: `RideLog`を使った実走フィードバック収集、`source_route_id`を使った過去ルート参照機能はテーブルのみ用意で未実装(仕様書通りMVPスコープ外)。

## 開発タスク一覧

ステータス凡例: `未着手`、`進行中`、`完了`

### 1. バックエンド基盤
- [x] 完了 - ディレクトリ構成の作成(docs/, progress/, src/server, src/mobile)
- [x] 完了 - package.json / .env.example / docker-compose.yml
- [x] 完了 - DBスキーマ作成・初期化スクリプト
- [x] 完了 - サーバー起動・DB接続を実機(Docker)で検証

### 2. Google Maps API連携
- [x] 完了 - Places Nearby Search / Place Details 呼び出しラッパー
- [x] 完了 - Directions API呼び出し(bicycling→drivingフォールバック)
- [x] 完了 - Elevation API呼び出し(標高プロファイルサンプリング)
- [x] 完了 - API呼び出しログ記録・使用量サマリAPI
- [ ] 未着手 - 実際のAPIキーでのエンドツーエンド検証

### 3. 店舗検索・ルート生成
- [x] 完了 - 候補店舗検索(距離・営業時間フィルタ・訪問済み除外)
- [x] 完了 - 往復ルート生成(行き帰り別ルート・獲得標高算出)
- [x] 完了 - GPXファイル生成・保存API
- [x] 完了 - グループ共有(shared_at記録)API
- [ ] 未着手 - 実データでの検証(店舗検索結果の精度・ルートの妥当性)

### 4. モバイルアプリ
- [x] 完了 - Expoプロジェクト雛形(package.json, app.json, babel.config.js)
- [x] 完了 - 出発地点入力画面(地図タップ・履歴選択)
- [x] 完了 - 条件指定画面(希望距離・出発時刻)
- [x] 完了 - 候補店舗表示画面(一覧・過去訪問店舗パネル)
- [x] 完了 - ルート表示画面(地図・高度プロファイルグラフ・GPX保存・共有ボタン)
- [x] 完了 - expo-doctor / Metroバンドルのエラー無し確認
- [ ] 未着手 - 実機・エミュレータでの動作確認
- [ ] 未着手 - dev client / EASビルド環境の構築

### 5. 将来拡張(MVPスコープ外、テーブルのみ用意)
- [x] 完了 - RideLogテーブル作成
- [ ] 未着手 - 実走フィードバック収集機能
- [ ] 未着手 - 過去ルート参照(source_route_id)を使ったレコメンド

### 6. テスト
- [x] 完了 - 純粋ロジック部分(標高計算・営業時間判定・ポリラインデコード・オフセット計算)のユニットテスト(2026-08-16)
- [x] 完了 - shopSearch/routeBuilderの結合テスト(Google API・DBをモック化)(2026-08-16)
- [ ] 未着手 - APIエンドポイントの統合テスト(実際のPlaces/Directions/Elevationレスポンスを使った検証)
