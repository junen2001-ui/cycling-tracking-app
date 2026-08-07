# Cycling Tracking App

このディレクトリは、サイクリング参加者の位置情報追跡アプリケーション用です。

## ディレクトリ構成
- docs/ : 仕様書・設計ドキュメント
- progress/ : タスク管理・開発進捗
- src/ : アプリケーションのソースコード

## バックエンドの起動方法
1. `src/server/.env.example` を `src/server/.env` にコピーし、`DATABASE_URL` と `AUTH_SECRET` を設定する。
2. Dockerでローカルに PostgreSQL を起動する:
   - `docker compose -f src/server/docker-compose.yml up -d`
3. データベーススキーマを初期化する:
   - `cd src/server`
   - `npm install`
   - `npm run init-db`
4. サーバーを起動する:
   - `npm start`

## API概要
- `POST /api/auth/send-code` — 電話番号宛に認証コードを要求する
- `POST /api/auth/verify-code` — コードを確認し、参加者用トークンを取得する
- `POST /api/locations` — `Authorization: Bearer <token>` を付けて参加者のGPSデータをアップロードする
- `GET /api/participants` — 参加者一覧と最新の位置情報を取得する
- `ws://127.0.0.1:3000` — リアルタイム位置情報更新用のWebSocket接続
  - 接続時にウェルカムメッセージを受信する
  - 参加者が位置情報をアップロードするたびに `location-update` イベントを受信する

## モバイルアプリ(参加者用)の起動方法
ネイティブの参加者アプリは `src/mobile`(Expo、プレーンJavaScript)にあります。画面ロック中やアプリ切り替え中もバックグラウンドで位置情報を送信するため、カスタムのdev client(ビルド済みAPK)が必要です。素のExpo Goでは動作しません。

**実機でのテストには `development` プロファイルではなく `preview` プロファイルを使用してください。** `development`(Metro接続が必要)はバックグラウンドタスクの実行が不安定になることが確認されています。`preview` はビルド時にJSバンドルを埋め込むため、実行時にMetroへの接続が不要で安定します。

1. `cd src/mobile && cp .env.example .env` を実行し、`EXPO_PUBLIC_API_BASE_URL` を開発機のLAN IPとポート3000に設定する(例: `http://192.168.1.23:3000`)。同じWi-Fi上の実機からバックエンドに到達できるようにするため。
2. `eas.json` の `build.preview.env.EXPO_PUBLIC_API_BASE_URL` にも同じLAN IPを設定する。**重要**: EASのクラウドビルドはローカルの `.env` を自動では読み込まないため、ビルドに反映させるにはここに明示的に設定する必要がある。
3. EAS経由でインストール可能なAndroid APKをビルドする(クラウドビルドのため、ローカルにAndroid SDKは不要):
   - `npx eas-cli login`(無料のExpoアカウント)
   - `npx eas-cli build:configure`
   - `npx eas-cli build --profile preview --platform android`
   - ビルド完了後、EASが表示するリンク/QRコードから実機にAPKをインストールする。
4. バックエンドを起動する(`src/server` で `npm start`、DBコンテナも起動しておくこと)。
5. 開発機のWi-Fiネットワークプロファイルが「プライベート」になっていることを確認する(Windowsの既定は「パブリック」で、外部デバイスからの着信をブロックする)。あわせて、ポート3000への着信を許可するWindowsファイアウォールの受信ルールを追加する。
6. インストールしたアプリをそのまま開く(Metroの起動は不要)。

iOSはまだ未対応です(実機インストールには有料のApple Developerアカウントが必要)が、同じ `expo-location` の設定で対応可能です。

## 別のPCで開発を再開する手順

このプロジェクトは `OneDrive` 配下のフォルダで開発しており、OneDriveがファイル全体(コード・`node_modules`・`.env` を含む)を自動的に他のPCへ同期する。ただし、以下の2点はOneDriveの同期対象外・対象外に近いため、新しいPCでは別途対応が必要:

1. **Dockerのコンテナ本体とDBボリュームの中身**はOneDriveで同期されるプロジェクトフォルダの外(Docker Desktop自身のWSL2ディスク)に保存されるため、新しいPCでは作り直しが必要(現時点ではテストデータのみのため、作り直しで問題ない)。
2. **`.git` フォルダをOneDrive経由で複数PC間同期に使うのはリスクがある**(2台のPCがほぼ同時に書き込むと、OneDriveのファイル単位の同期がGitの内部ファイルを壊すことがある)。現状このリポジトリにはリモート(GitHub等)を設定していないため、確実に安全な移行方法としては、リモートリポジトリを作成して `git push`/`git pull` で転送することを推奨する。

以下はWindows + OneDrive同期を使う場合の、コピー&ペーストで実行できる具体的な手順(PowerShell)。

### 1. OneDriveのセットアップ(先に開始し、裏で同期させておく)
- 新しいPCでOneDriveアプリを開き、**同じMicrosoftアカウント**でサインインする(Windows 11なら標準搭載済み)。
- サインイン後、`AI\Claude` フォルダ(`cycling-tracking-app` を含む)が同期されるのを待つ。`node_modules` を含めると数百MB〜1GB程度あるため時間がかかる。同期完了前でも次の手順(ソフトのインストール)は並行して進めてよい。
- **重要**: OneDriveの「ファイルオンデマンド」機能により、同期直後はファイルがクラウド上のプレースホルダーのままのことがある。フォルダを右クリック→「常にこのデバイスに保持する」を選択し、実体をダウンロードさせておくこと(そうしないと `npm install` やDockerがファイルを見つけられない)。

### 2. 必要なソフトウェアをインストールする(PowerShellを管理者権限で開いて実行)
```powershell
# Git
winget install --id Git.Git -e --source winget

# Node.js(このプロジェクトでの動作確認済みバージョン: v24系)
winget install --id OpenJS.NodeJS -e --source winget

# WSL2(Dockerに必要。未導入の場合)
wsl --install
# ↑実行後、再起動を求められたら再起動する
```
再起動後、続けて:
```powershell
# Docker Desktop(WSL2バックエンドを使用)
winget install --id Docker.DockerDesktop -e --source winget
```
インストール後、Docker Desktopを一度起動し、初回セットアップ(ライセンス同意・WSL2バックエンド使用の確認)を済ませる。

モバイルアプリをビルドする場合は、ローカルにAndroid SDK等は不要(EASのクラウドビルドを使うため)。ただし `npx eas-cli login` で既存のExpoアカウント(owner: `endy_jun`)にログインする必要がある。

### 3. インストール確認(新しいPowerShellウィンドウを開いて)
```powershell
git --version
node -v
npm -v
docker --version
docker compose version
```

### 4. コードの引き継ぎを確認する
- **日常的な引き継ぎはOneDriveの同期に依存する**(追加作業はほぼ不要。`.env` や `node_modules` もそのまま複製される)。ただし**2台のPCで同時に編集・実行しない**こと。片方のPCでの変更がOneDrive上で「同期済み」になってから、もう片方のPCで作業を始めること。
- OneDriveの同期が完了していることを確認してから、プロジェクトへ移動して履歴を確認する:
  ```powershell
  cd "$env:USERPROFILE\OneDrive\AI\Claude\cycling-tracking-app"
  git log --oneline -5
  git status
  ```
  このPCで見たのと同じコミット履歴が表示されればOK(`.git`もOneDrive経由で同期されている)。
- **GitHubにも定期的にバックアップ・同期している(2026-08-07に設定済み)**: このリポジトリ(`cycling-tracking-app`フォルダ)は、`OneDrive/AI/Claude` 全体を管理するGitリポジトリの一部(サブディレクトリ)になっている。他の無関係なプロジェクト(SBI-investment-tracker等)を含めずに `cycling-tracking-app` フォルダだけをGitHubのプライベートリポジトリ(`https://github.com/junen2001-ui/cycling-tracking-app`)に反映するため、通常の `git push` ではなく **`git subtree` を使う**:
  ```powershell
  # OneDrive/AI/Claude ディレクトリ(cycling-tracking-appの一つ上の階層)で実行する
  git add cycling-tracking-app
  git commit -m "..."
  git subtree push --prefix=cycling-tracking-app origin master
  ```
  新しいPC側で最新版を取得する場合(通常はOneDrive同期で十分だが、GitHub側にしか無い変更を取り込みたい場合):
  ```powershell
  git subtree pull --prefix=cycling-tracking-app origin master --squash
  ```
  `.env` はGit管理対象外(秘密情報のため、`.gitignore`で除外)なので、GitHub経由では引き継がれない。OneDriveの同期に含まれる実ファイルをそのまま使うか、`src/server/.env.example` / `src/mobile/.env.example` をコピーして値を入力し直すこと。

### 5. Dockerコンテナ(DB)を作り直す
```powershell
cd "$env:USERPROFILE\OneDrive\AI\Claude\cycling-tracking-app\src\server"
docker compose up -d
npm install
npm run init-db
```
**注意**: DBのコンテナ本体とボリュームの中身はOneDriveで同期されるプロジェクトフォルダの外(Docker Desktop自身のWSL2ディスク)に保存されるため、新しいPCでは必ず作り直しが必要。現時点ではテストデータのみなので作り直しで問題ない。もし本番相当のデータを引き継ぎたくなった場合は、移行元PCで `docker exec cycling-tracking-db pg_dump -U postgres cycling_tracking > backup.sql` としてバックアップを取り、移行先で復元する。

### 6. `.env`の確認
OneDrive同期で既に存在しているはずなので確認だけ:
```powershell
Test-Path .env
```
`False` の場合は、このPCの `.env` の中身(`AUTH_SECRET`・`DATABASE_URL`)を安全な方法で手動コピーしてくる(gitには含まれないため)。

### 7. サーバー起動・動作確認
```powershell
npm start
```
別のPowerShellウィンドウで:
```powershell
curl http://127.0.0.1:3000/api/participants
```
またはブラウザで `http://127.0.0.1:3000/admin.html` を開き、管理画面が表示されることを確認する。

### 8. モバイルアプリ側を使う場合
```powershell
cd "$env:USERPROFILE\OneDrive\AI\Claude\cycling-tracking-app\src\mobile"
npm install
npx eas-cli login
```

### 9. 実機(スマホ)でテストする場合のネットワーク設定
```powershell
# Wi-Fiプロファイルを「プライベート」に変更
Get-NetConnectionProfile
Set-NetConnectionProfile -InterfaceAlias "<↑で確認したインターフェース名>" -NetworkCategory Private

# ポート3000への着信を許可
New-NetFirewallRule -DisplayName "Cycling Tracking Dev Server (port 3000)" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Any

# 新しいPCのLAN IPを確認
ipconfig | Select-String "IPv4"
```
確認したIPを `src/mobile/.env` と `src/mobile/eas.json`(`build.preview.env.EXPO_PUBLIC_API_BASE_URL`)に設定し、IPが変わっていれば `preview` プロファイルのAPKを再ビルドする。
