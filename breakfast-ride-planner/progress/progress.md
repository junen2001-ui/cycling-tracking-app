# 進捗

## 2026-08-19: 本番(UTCタイムゾーン)で候補店舗が0件になる不具合を修正
本番URL経由でアプリを使ったユーザーから「候補店舗が見つからない」と報告。調査したところ、**本番VMのOSタイムゾーンがUTC(ローカル開発機はJST)だったため、営業時間の曜日・時刻判定がほぼ全て誤判定になっていた**ことが原因と判明。

### 原因
`lib/openingHours.js`が`dateTime.getDay()`/`getHours()`/`getMinutes()`(サーバーのOSタイムゾーンに依存するローカルメソッド)を使っていた。Google Placesの営業時間は店舗の現地時刻(日本時間)基準のデータのため、UTCサーバー上では実際の日本時間より9時間ずれた曜日・時刻で営業時間チェックが行われ、実際には営業中の店舗もほぼ全て「閉店中」と誤判定→候補が0件になっていた。ローカル開発機(JST)ではこの不具合は再現しなかった(たまたまサーバーのOSタイムゾーンと営業時間の基準タイムゾーンが一致していたため)。

### 修正
`getJstDayAndMinutes()`ヘルパーを追加し、`dateTime`にJST分(+9時間、日本にサマータイムは無いので固定オフセットでよい)を加算した上でUTC系メソッド(`getUTCDay()`等、サーバーのOSタイムゾーンに影響されない)で曜日・時刻を取り出すように変更。これによりサーバーのOSタイムゾーンに関わらず常に日本時間基準で判定されるようになった。

### 検証
- 回帰テストを追加(`test/openingHours.test.js`): `process.env.TZ`を`UTC`/`Asia/Tokyo`/`America/Los_Angeles`と切り替えながら同じ判定結果になることを確認(Node.jsは`process.env.TZ`の変更を実行時に反映することを利用)。全46件パス。
- 本番へデプロイ後、久留米市江戸屋敷起点・50km・日曜日の検索で0件→19件に復旧したことを実際に確認。デプロイ中もcycling-tracking-appへの影響が無いことを確認済み。

### 教訓
サーバーのOSタイムゾーンに依存するロジックは、ローカル開発機と本番環境のタイムゾーンが異なる場合に気づきにくい形で壊れる。日時をユーザー向けの意味(曜日・営業時間など)で扱う処理は、対象がいつも同じ地域(今回は日本)である場合は明示的に固定タイムゾーンで計算するべきだった。

## 2026-08-18(続き): Oracle Cloud VM(cycling-tracking-appと同居)への本番デプロイ
ユーザーの希望で、cycling-tracking-appが稼働中のOracle Cloud VM(`217.142.249.10`)上に、breakfast-ride-plannerのバックエンドも同居させた。cycling-tracking-appの稼働には影響を与えていないことを確認済み。

### 構成
- **DB**: 新規コンテナは作らず、既存の`cycling-tracking-db`コンテナ(Postgres/PostGIS、`127.0.0.1:5432`のみ公開)内に`breakfast_ride_planner`という別データベースを作成(`cycling_tracking`とは独立、同一Postgresインスタンスを共有)。
- **サーバー**: `~/app/breakfast-ride-planner/server`にコード配置(`tar`転送、cycling-tracking-appの「10. Oracle Cloud本番バックエンドへの再デプロイ」と同じ手順)。ポート3001。systemdサービス`breakfast-ride-planner.service`(`cycling-tracking.service`と同一パターン、`WorkingDirectory`と`Description`のみ変更)。
- **公開URL**: `https://breakfast.217-142-249-10.nip.io`。Caddyfileに新しいサイトブロックを追記(`reverse_proxy 127.0.0.1:3001`)して`systemctl reload caddy`。nip.ioは任意のサブドメインが同じIPに解決される無料ワイルドカードDNSのため、`breakfast.`プレフィックスを付けるだけで別ホスト名として扱える。
- **APIキー**: ローカル開発用(無制限)とは別に、**IPアドレス制限(`217.142.249.10`のみ)をかけた専用キー**を新規発行して使用。理由: サーバー用キーはPlaces/Directions/Elevationを呼べる強い権限を持つため、公開URL経由で誰でも呼べる状態を避けるため。

### 動作確認
- `https://breakfast.217-142-249-10.nip.io/health` が200を返すことを確認
- `POST /api/shops/search`を公開URL経由で実行し、実際に店舗が返ることを確認(IPアドレス制限付きキーが正しく機能)
- デプロイ作業中も`https://217-142-249-10.nip.io/api/participants`(cycling-tracking-app)が200を返し続けることを確認、影響なし
- VMのメモリ使用量: breakfast-ride-planner.serviceは約20〜30MB(VM全体954MBのうち。1GB弱の小さいVMだが、cycling-tracking-appとの同居で問題になる兆候は今のところ無し)

### 今後の注意点
- モバイルアプリ(`src/mobile`)は現状まだローカル開発機のLAN IP(`192.168.1.36:3001`)を向いたままで、この公開URLは使っていない。外出先からも使えるようにする場合は、`eas.json`の`preview.env.EXPO_PUBLIC_API_BASE_URL`をこの公開URLに変更して再ビルドが必要(cycling-tracking-appの`build.preview.env`と同様の変更)。
- `.env`(APIキー・DATABASE_URL)はVM上にのみ存在し、Gitには含まれない。次回別PCからこのVMにコード更新をデプロイする場合の手順はcycling-tracking-appのREADME「10. Oracle Cloud本番バックエンドへの再デプロイ」を参照(サーバーディレクトリ名を`breakfast-ride-planner/server`に読み替える)。
- DBスキーマを変更した場合は、`ssh ... "cd ~/app/breakfast-ride-planner/server && npm run init-db"`を追加で実行すること。

## Action Items(未解決・保留中の課題)
- **地図のダークモード表示が直らない**(2026-08-18時点、保留)。ダークテーマ端末で`react-native-maps`の地図が暗い配色のまま表示される。試した対策(いずれも実機ビルドで確認済みだが効果なし):
  - `android:forceDarkAllowed=false`をAppThemeに注入(`plugins/withAndroidForceDarkDisabled.js`)
  - `AppCompatDelegate.setDefaultNightMode(MODE_NIGHT_NO)`をMainApplication.ktに注入(`plugins/withAndroidForceLightMode.js`)
  - `MapView`に`customMapStyle={[]}`を明示指定(StartLocationScreen.js/RouteMapScreen.js)
  - 実機確認で地図タイル自体は正常に読み込めている(認証エラーではない)ことは確認済みなので、Google Maps SDK側の何らかのシステムテーマ追従が原因と推測されるが未特定。ユーザー判断でこのまま保留(実用上は許容)。次回調査する場合は、Android実機のlogcatでMaps SDK関連のログを確認するか、`react-native-maps`のGitHub Issueで同様の既知事例がないか調べるとよい。

## 2026-08-17: Android実機ビルド環境の構築、WSLメモリクラッシュの解消、実機検証で見つかった不具合2件を修正
cycling-tracking-appと同じWSL2ローカルビルド環境(`~/build/breakfast-ride-planner-mobile`、Expoアカウント`endy_jun`は既にログイン済みで流用)を使い、初めてこのプロジェクトのAndroid APKをビルド・実機インストールまで行った。

### サーバーのポートを3000→3001に変更
モバイル実機テストにはバックエンドをLAN経由で常時起動しておく必要があるが、cycling-tracking-appのローカルサーバーも同じPCでポート3000を使っており、同時起動できないことが判明。`src/server/.env(.example)`の`PORT`を3001に変更し、`src/mobile/src/config.js`のデフォルトLAN URLも合わせた(README参照)。ポート3001への着信を許可するWindowsファイアウォールルールが必要(管理者権限が要る作業のためユーザーに依頼)。

### 発見したDocker Composeの罠(再掲・関連)
このセッションでもDocker Desktopが未起動だったため起動し直した。プロジェクト名を明示していない状態でのcompose upは[2026-08-15のセクション]で記録した衝突が再発しうるので注意。

### WSL2がAndroidビルド中に繰り返しクラッシュした問題(解決)
初回ビルドで`docker`/WSL自体が"Stopped"になる現象が3回連続で発生。原因はメモリ不足で、`dmesg`に`Out of memory: Killed process (java)`が記録されていた。本プロジェクトはcycling-tracking-appには無い`reanimated`/`worklets`/`gesture-handler`/`svg`(高度プロファイルグラフ用)を含み、4アーキテクチャ(arm64-v8a/armeabi-v7a/x86/x86_64)分のネイティブC++コンパイルを並列実行するとWSLのデフォルトメモリ上限(ホストの約50%、このPCでは15GB)を超えてしまうことが原因と判明。
- 対策1: `eas.json`の`preview`プロファイルに`ORG_GRADLE_PROJECT_reactNativeArchitectures=arm64-v8a`を追加し、実機で使う1アーキテクチャのみビルド(Gradleのプロジェクトプロパティ経由でReact Native側のABIフィルタに反映される、標準的なGradle env var連携)。
- 対策2: `~/.gradle/gradle.properties`(WSL側、プロジェクト非依存のグローバル設定)に`org.gradle.workers.max=1`・`org.gradle.parallel=false`・`org.gradle.daemon=false`・`org.gradle.jvmargs=-Xmx2048m`を設定し、Gradle自体の並列度も最小化。
- **これでも治らなかった**(CMake/Ninjaのネイティブコンパイルはgradle.jvmargsの制御対象外のため)。最終的に`C:\Users\jun_e\.wslconfig`を新規作成し`memory=24GB`(15GBから拡張)・`swap=8GB`を設定、`wsl --shutdown`で反映(Docker Desktopも巻き込んで停止するため、再起動後に両プロジェクトのDBコンテナを`docker start`で復旧した)。これで初めてビルドが最後まで完走した。
- **次回別PCでこの環境を再構築する場合の教訓**: cycling-tracking-appのREADMEの「WSL2ローカルビルド環境の構築」手順だけでは、reanimated等の重いネイティブモジュールを含むプロジェクトではメモリ不足でクラッシュしうる。`.wslconfig`でのメモリ拡張(ホストのRAM次第だが20GB前後を目安)と`ORG_GRADLE_PROJECT_reactNativeArchitectures=arm64-v8a`は最初から設定しておくとよい。

### 実機検証で発見した不具合2件(修正済み、再ビルドで確認予定)
1. **「次へ」ボタンが反応しない**: `App.js`で`react-native-gesture-handler`必須の`GestureHandlerRootView`ラップが抜けていた(`react-native-wagmi-charts`がgesture-handlerに依存しているため導入されていたが、ラップを忘れていた)。gesture-handlerはAndroidのタッチイベント配送に介入するため、ラップ漏れでアプリ全体のタッチ判定(地図タップ含む)が不安定になり、「次へ」有効化に必要な`selectedLocation`が更新されなかったと推測される。`App.js`のルートを`GestureHandlerRootView`でラップして解決。
2. **ダークテーマ端末で地図が反転して見える**: Android の Force Dark機能が原因。`app.json`の`userInterfaceStyle: "light"`だけではネイティブ側の`android:forceDarkAllowed`には反映されないことを、実際に`expo prebuild`で生成される`styles.xml`で確認した。`plugins/withAndroidForceDarkDisabled.js`(新規のconfig plugin)で`AppTheme`に`android:forceDarkAllowed=false`を注入して解決。両修正とも、実際にビルドする前に`expo export`(バンドル検証)と`expo prebuild`(styles.xml生成検証、フルビルドはしない)で効果を確認してからビルドした。

### ボタンとシステムナビゲーションバーの重なり(別セッションで先に修正済み)
4画面すべてでルート要素を素の`View`から`SafeAreaView`(`react-native-safe-area-context`)に変更済み(このセクションの前の実機テストで発見・修正)。

### ビルド成果物
`breakfast-ride-planner/build/breakfast-ride-planner-preview-fix2-20260817.apk`(Git管理対象外、`.gitignore`済み)。上記2件の修正を含む。まだ実機での再検証はしていない。

## 2026-08-16(続き2): 実際のGoogle APIキーでエンドツーエンド検証、実データで見つかったバグ2件を修正
ユーザーがGoogle Cloudでプロジェクトを作成しPlaces API/Directions API/Elevation API/Maps SDK for Androidを有効化、APIキーを発行(`src/server/.env`の`GOOGLE_MAPS_API_KEY`にのみ設定。gitignore対象なのでコミットはされない)。実際にサーバーを起動し、出発地点を福岡市天神(33.5902, 130.4017)としてエンドツーエンドで検証した。

### 検証結果(すべて実際のGoogle APIレスポンスで確認)
- `POST /api/shops/search`: 天神エリアの実在カフェ5件(エクセルシオール カフェ、サン・フカヤ、ブルーボトルコーヒー福岡天神カフェ等)が距離・評価・営業時間付きで返ることを確認
- `POST /api/routes`: 実際のbicyclingルート(往復)が生成され、標高プロファイル(実測値、天神エリアは標高8m前後でほぼ平坦)・獲得標高が算出されることを確認
- `POST /api/routes/:id/gpx`・GETでのダウンロード: 実データで生成したGPXファイルの保存・ダウンロードを確認
- `POST /api/routes/:id/share`: `shared_at`設定を確認
- 訪問済み除外: ルートで選択した店舗が`GET /api/shops/visited`に現れ、**同条件で再検索すると候補から除外され、別の店舗に差し替わる**ことを実データで確認(コスト削減目的のPlace Details呼び出しスキップも込みで、モックテストで検証した通りの挙動が実環境でも成立)
- `GET /api/usage/summary`: 検証一式(Nearby Search 2回・Place Details 16回・Directions 24回・Elevation 24回)で概算$0.58。無料枠に対して十分小さい

### 発見して修正したバグ
1. **`distance_km`が実際のルート距離ではなく、リクエストの希望距離で上書きされていた**(`server.js`の`POST /api/routes`)。`distanceKm ?? route.distanceKm`という実装になっており、モバイル側が常に`distanceKm`を送るため、実際に生成されたルートが1.5km(近い店舗を選んだため)でも保存される`distance_km`は希望値の20kmのままになっていた。`route.distanceKm`(実際の計算値)を常に使うよう修正。**モックテストでは検出できなかった**(モックはAPI呼び出しの構造は検証するが、実際の店舗が「近すぎる」ことで生じるこの手のズレは実データでないと表面化しない)。
2. **`gpx_file_path`にWindows形式の区切り文字(`\`)がそのままDBへ保存されていた**(`services/gpx.js`の`path.join('data','gpx',fileName)`)。ローカル(Windows)では`path.join`で復元できるため実害は出ていなかったが、将来Linuxサーバー(cycling-tracking-appと同様Oracle Cloud等)にデプロイした際に`path.join(__dirname, route.gpx_file_path)`が壊れる。保存用パスは`` `data/gpx/${fileName}` ``で固定するよう修正。

### 検証中に一時的に発生した非バグの現象(記録)
GPXダウンロード(`GET /api/routes/:id/gpx`)がExpressの既定の404("Cannot GET")を返す現象が発生したが、原因はコードではなく**サーバー再起動時にkillしたはずの旧プロセスとの入れ替わりタイミングの問題**だった(再起動後にデバッグログを仕込んで再現したところ、新プロセスでは正しくハンドラに到達し200が返ることを確認)。サーバーを再起動した直後の動作確認では、`netstat`でPIDを取り直してから確認するなど、確実に新プロセスに当たっていることを意識すること。

### 未対応(モバイル側)
モバイル(`app.json`の`react-native-maps`用Androidキー)には**まだこのキーを設定していない**。理由: このキーはPlaces/Directions/Elevationの呼び出し権限を持つ制限なしキーであり、`app.json`はGit管理対象(コミットされる)のため、そのまま埋め込むと公開リポジトリ相当の露出リスクがある。当初の方針通り、Android用には別途「Maps SDK for Androidのみ・パッケージ名+SHA-1で制限」した専用キーを、実機ビルドのタイミングで発行・設定することを推奨(README参照)。

全26件のテストは今回の修正後も引き続きパス。

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
- [x] 完了 - 実際のAPIキーでのエンドツーエンド検証(2026-08-16、福岡市天神エリアで確認)

### 3. 店舗検索・ルート生成
- [x] 完了 - 候補店舗検索(距離・営業時間フィルタ・訪問済み除外)
- [x] 完了 - 往復ルート生成(行き帰り別ルート・獲得標高算出)
- [x] 完了 - GPXファイル生成・保存API
- [x] 完了 - グループ共有(shared_at記録)API
- [x] 完了 - 実データでの検証(2026-08-16。distance_km上書きバグ・GPXパス区切り文字バグを発見・修正)

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
