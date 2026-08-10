# Cycling Tracking App Status

## 開発環境について
- このプロジェクトはOneDrive配下で開発しており、複数PCでの開発再開手順は `README.md` の「別のPCで開発を再開する手順」を参照。DockerコンテナとDBの中身、および `.git` フォルダの複数PC間同期には注意点がある(詳細はREADME参照)。

## 現在の状態
- Expressで実装されたバックエンドサーバーが `http://127.0.0.1:3000` で稼働している
- Dockerで `postgis/postgis:16-3.4` を使ったPostgreSQLデータベースを起動している
- 参加者・認証・位置情報・緊急通知・休憩エリア・ルート(GPX)などのテーブルを含むDBスキーマの初期化が完了している
- `/api/auth/send-code` と `/api/auth/verify-code` による認証フローが動作している
- `/api/locations` による位置情報アップロードAPIが動作している
- `/api/participants` による参加者取得APIが動作している
- `ws://127.0.0.1:3000` でWebSocketサーバーを実装し、`location-update` イベントをブロードキャストしている
- 「滞留」と「ロスト」は別概念として管理している(2026-08-09実装、2026-08-10にロースト判定タイミングを修正、いずれも`server.js`の`computeParticipantStatus()`)。滞留はアプリ側が直近5分の移動距離(250m未満)から判定して送ってくる(`participantClientStalled`にメモリ保持)。**滞留中(`clientStalled: true`)はアプリが電力節約のため送信を止める仕様のため、無音時間の長さに関わらず次の「稼働中」通知が来るまで滞留のまま扱う**。ロースト(通信断)は「直近は稼働中と分かっていたのに10分間無音」の場合のみ判定する(滞留由来の意図的な無音とは区別)。休憩所内にいる場合は滞留とみなさない。旧バージョンのアプリ向けに、サーバー側の静止時間ヒューリスティック(`participantStationarySince`)へのフォールバックも維持している(いずれもDB永続化なし、サーバー再起動でリセット)。詳細は `progress/progress.md` の2026-08-10セクション参照。

## 完了したマイルストーン
- サーバー基盤・環境構築
- DBコンテナの起動とスキーマ初期化
- 参加者の認証とトークン発行
- 位置情報の追跡と最新位置の取得
- 位置情報更新のリアルタイムWebSocketブロードキャスト

## 次に取り組むこと
- **未解明・軽微(次回滞留テスト時に要観察)**: 2026-08-10の実機検証で、滞留から約25分後に座標がほぼ同じ地点のまま4回連続送信が発生する謎の挙動を観測(ユーザーはスマホに触れていないと証言)。GPS再測位時のジャンプかAndroidのDoze省電力機能が疑われるが未確認。消費電力への影響は軽微なため、緊急対応は不要と判断し保留中。詳細は `progress/progress.md` の2026-08-10セクション参照。
- `src/mobile`(参加者アプリ)の3件の不具合修正・地図機能とも実機検証まで完了(2026-08-06)。残るはiOSビルド/検証(有料のApple Developerアカウントが必要)のみ。
- 管理画面(`admin.html`/`admin.js`)の拡張(日本語化・GPXルート表示・現在地初期表示・アラート/停滞一覧の消去)も実装・Playwright検証まで完了(2026-08-06)。詳細は `progress/progress.md` セクション11参照。
- バックエンドの公開デプロイ(Oracle Cloud無料枠)は2026-08-07に完了。`https://217-142-249-10.nip.io` で稼働中。詳細は `progress/progress.md` の同日セクション参照。
- **11月の実イベント利用前に必須**: 管理画面・関連APIに認証が一切無く、公開URLになった今は誰でも参加者の個人情報閲覧・データ改変が可能な状態(PoC期間中はユーザー判断で現状のまま運用)。認証トークンの有効期限が無い点も合わせて `progress/progress.md` の「Action Items」を参照。

## バックエンドの公開デプロイ (Oracle Cloud, 2026-08-07)
- Oracle Cloud無料枠(Always Free)の`VM.Standard.E2.1.Micro`(ap-osaka-1、パブリックIP `217.142.249.10`)にデプロイ済み。Docker(PostgreSQL/PostGIS、`127.0.0.1`のみバインド)+ Node.js(systemdサービス`cycling-tracking`)+ Caddy(自動HTTPS、Let's Encrypt)の構成。
- 公開URL: `https://217-142-249-10.nip.io`(nip.ioの無料ワイルドカードDNS。独自ドメイン未取得のため)。
- SSHは `~/.ssh/oracle_cycling_tracking`(開発機のみに存在、Git管理対象外)で接続。VM上の`~/app/server/.env`(本番用`AUTH_SECRET`・`DATABASE_URL`)もVM上にのみ存在しGit管理対象外。
- 詳細な構築手順・検証結果は `progress/progress.md` の2026-08-07セクション参照。

## ネイティブモバイルアプリ (src/mobile)
- 2026-08-02にスキャフォールド: Expo(SDK 57、プレーンJavaScript、TypeScriptなし、ルーターライブラリなし)の参加者アプリを `src/mobile` に作成した。`src/server/public/participant.js` の挙動(画面構成、タイミング定数、日本語エラー文言)を1対1で移植した上で、Web版にはできなかったバックグラウンド位置情報送信を追加している。
- バックグラウンド位置情報は `expo-location` + `expo-task-manager`(`src/mobile/src/location/backgroundLocationTask.js`、モジュールスコープで登録する `TaskManager.defineTask`)を使い、フォアグラウンド・バックグラウンド問わず位置情報送信の唯一の手段としている。バックグラウンド権限が拒否された場合はフォアグラウンドのみの `Location.watchPositionAsync` にフォールバックする。
- 認証トークン/participantIdは `expo-secure-store` に保存している(AsyncStorageではない。資格情報のため)。
- **実機テストには `development` ではなく `preview` のEASビルドプロファイルを使うこと。** `development`(Metro接続が必要)は、アプリを長時間バックグラウンドに置いた際にバックグラウンドタスクの実行が不安定になることを確認済み。`preview` はビルド時にJSバンドルを埋め込むため、実行時のMetro依存が無い。
- EASプロジェクト: `@endy_jun/mobile`。**2026-08-07にEAS無料枠のAndroidビルド回数を使い切った(月次リセットは9月1日)ため、以降はWSL2(Ubuntu)上でのローカルビルドに切り替えている**。構築手順・ビルドコマンドは `progress/progress.md` の「モバイルのローカルビルド環境」セクション参照。EASクラウドビルドの無料枠が復活すれば、従来通り `EAS_SKIP_AUTO_FINGERPRINT=1 npx eas-cli build --profile preview --platform android --non-interactive` でも再ビルド可能。
- 現時点での最新ビルド: `mobile-preview-stalled-lost-20260809.apk`(ローカルビルド、`cycling-tracking-app/build/`配下・Git管理対象外)。位置情報送信・滞留/ロースト判定の全面見直しを含む。**2026-08-10に終日の実機検証で、移動中の継続送信・滞留検知・滞留中の送信抑制・稼働再開の検知まで確認済み**(併せてサーバー側の未反映バグとロースト判定タイミングも修正・本番デプロイ済み)。詳細は `progress/progress.md` の2026-08-10セクション参照。
- **位置情報の送信方針(2026-08-09見直し)**: `accuracy`は`High`固定(`Balanced`はAndroidネイティブ側で`PRIORITY_BALANCED_POWER_ACCURACY`となりWi-Fi/基地局ベースの間延びした測位になる不具合が実機で確認されたため、`Balanced`は不採用)。送信間隔は`LOCATION_SEND_INTERVAL_MS`(`src/mobile/src/config.js`、現在60秒)。「移動25m未満は送信しない」はOSの`distanceInterval`に頼らず`src/mobile/src/route/trailStorage.js`の`evaluateLocationForSending()`で軌跡データから自前に計算する(OS側の直線距離フィルタは移動を検知し損ねることがあった)。
- **滞留(stalled)判定はアプリ側で実施**: 直近5分の移動距離が250m未満なら滞留とみなす(`STALLED_WINDOW_MS`/`STALLED_DISTANCE_THRESHOLD_M`)。**滞留に入った瞬間・滞留から復帰した瞬間のみ送信し、滞留継続中は送信しない**(電力節約、ユーザー指示)。「ロスト」(通信途絶)はサーバー側で無音時間のみから判定する別概念(`server.js`参照)。
- 緊急ボタン押下時は`sendFreshLocationNow()`(`App.js`)で高精度な現在地を確実に取得・送信してから通知する(それまで緊急通知に位置情報が一切添付されていなかった不具合を修正)。
- アプリをタスク一覧からスワイプで終了すると位置情報送信も停止する(`foregroundService.killServiceOnDestroy: true`)。通常のバックグラウンド(画面ロック・他アプリ切替)では継続する。
- 走行軌跡を`trailStorage.js`でログイン〜ログアウトの全区間分ローカル保存し、`RouteMapScreen.js`でピンクのポリライン+進行方向を示す矢印マーカーとして表示する。
- 2026-08-02〜03に実機のAndroid端末で一通り検証済み: 認証フロー、手動送信、バックグラウンド位置情報送信(画面ロック中・他アプリ使用中も10分以上にわたり15〜20秒間隔で継続受信することを、生の `participant_locations` DBレコードと突き合わせて確認)、緊急ボタン、運営本部への電話ボタン、ログアウト、WebSocket再接続/オフラインバナー、セッション切れ(401)処理。見つかって修正したネイティブビルド特有の問題(`RECEIVE_BOOT_COMPLETED` 権限不足によるクラッシュ、EASクラウドビルドがローカルの `.env` を読み込まない問題、`expo-build-properties` 経由でのAndroidの平文HTTP通信ブロック対応、スマホがPCに全く到達できなかったWindowsファイアウォール/ネットワークプロファイルの問題)、および未解決のまま残っている不具合(表示固まり、セッション切れ後の再ログインで自動送信が再開しないケース)の詳細一覧は `progress/progress.md` を参照。

## 管理画面 (src/server/public/admin.html)
- 2026-08-06に日本語化、GPXルート表示(スタート地点中心で表示)、初期表示時の現在地取得(HTTP接続では通常失敗し参加者位置フォールバック)、アラート/停滞一覧の個別消去機能を追加。
- 消去機能はDBに永続化され全管理画面で共有される(`incidents.dismissed_at`、`participants.stalled_dismissed_until` — スキーマ変更は `npm run init-db` を再実行すれば反映済み)。停滞の消去は参加者アプリ自身の状態表示(`stalled`フィールド)には一切影響しない設計(詳細は `progress/progress.md` セクション11)。
- 実装の過程で、既存の重大バグ(Leaflet CDNのSRIハッシュ不一致で地図全体が描画されない)も発見・修正済み。
- 2026-08-07に参加者名・電話番号のExcelインポート機能を追加(「Excelインポート」ボタン→列指定ダイアログ→`POST /api/participants/import-roster`)。電話番号は`normalizePhoneNumber()`で数字のみに正規化した上で認証フロー・インポートの両方に適用しており、表記ゆれによる二重登録を防止している。まだアプリ未認証の参加者はExcel内容で事前登録され、本人が後から認証すると自動的に紐付く。既存の手動編集機能は維持。詳細は `progress/progress.md` セクション12参照。
- 2026-08-07に休憩所の追加インタフェースを追加(「休憩所を追加」ボタン→地図クリックで中心座標指定→名前・幅・高さ入力ダイアログ→`POST /api/rest-areas`)。登録済みの休憩所は矩形として地図に表示され、クリックすると削除もできる(`DELETE /api/rest-areas/:id`、新規追加)。複数管理画面タブ間はWebSocket(`rest-area-created`/`rest-area-deleted`)で同期。詳細は `progress/progress.md` セクション13参照。
- 2026-08-07に画面レイアウトを刷新(ユーザー指示): 地図表示領域を最大化するため、画面幅860px超では「地図(左、画面いっぱい)+情報パネル(右、幅300pxサイドバー)」の横並びに変更。860px以下(スマホ)では自動的に元の縦積み(地図の下にパネル)レイアウトに切り替わるレスポンシブ対応(メディアクエリ)。
- 2026-08-09に「滞留」「ロスト」を別状態として表示するよう変更。マーカー色を3色化(稼働中=赤橙、滞留中=amber、ロスト=グレー)、参加者一覧・停滞パネルの表示も3状態対応(`statusLabel()`/`statusColor()`ヘルパー)。`GET /api/participants`・WebSocketの`stalled`に加えて`lost`フィールドを追加。
- 2026-08-07に「GPXファイルを読み込む」ボタンの保存先をサーバーに変更(下記「ルート配布」セクション参照)。ブラウザ内でのパース・スタート地点中心表示という見た目の挙動自体は変更なし。

## ルート配布 (2026-08-07)
- 参加者アプリ側での手動GPXファイル選択(`expo-document-picker`)を廃止し、休憩エリアと同様に運営が管理画面から一度アップロードしたルートをサーバー経由で全参加者アプリが自動取得する方式に変更(ユーザー指示、2026-08-06に予告)。
- DB: `routes`テーブル(`points` JSONB)。イベントごとにルートは1本の想定で、アップロードのたびに既存行を削除してから新規挿入する(履歴は持たない)。
- API: `POST /api/route`(管理画面がGPXパース後の座標を保存、`route-updated`をWebSocketでブロードキャスト)、`GET /api/route`(現在のルート取得。無ければ`route: null`)。他のAPI同様、DB書き込み失敗時はメモリフォールバック。
- モバイル(`RouteMapScreen.js`)は画面表示時に`GET /api/route`を自動取得。取得結果は`AsyncStorage`(`routeStorage.js`)にキャッシュし、次回表示時はまずキャッシュを即表示してからサーバーの最新版で更新する(オフライン時のフォールバック用)。手動更新用の「最新のルートを再取得」ボタンあり。
- 未使用になった`src/mobile/src/utils/gpx.js`と`expo-document-picker`/`expo-file-system`パッケージは削除済み。

## 備考
- バックエンドは現在 `src/server/.env` の `AUTH_SECRET` と `DATABASE_URL` を使用している
- Docker Desktop / WSL はインストール済みで、Dockerデーモンも起動中
- 休憩エリアの矩形判定は位置情報アップロード処理の中で実装済み
- バックエンドサービスは、Dockerベースの Postgres コンテナと同期した状態を保つこと

## 言語設定
- 常に日本語で会話する
- コメントも日本語で記述する
- エラーメッセージの説明も日本語で行う
