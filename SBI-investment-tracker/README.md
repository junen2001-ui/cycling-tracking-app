# SBI投資データ Excel レポート

SBI証券の手動出力 CSV を読み込み、日次の資産推移データを Excel ファイルとして出力し、Excel 内にグラフを作成する Python プロジェクトです。

## 概要

このプロジェクトは以下を実現します。

- SBI の CSV ファイルを読み込む
- 日付ごとに NISA / 投資信託 / 個別株 の評価額を集計する
- 日次増減を計算する
- Excel (`.xlsx`) に集計表を書き込む
- Excel 内に折れ線グラフを追加する

## 使い方

1. Python 3.8 以上を用意します。
2. 必要ライブラリをインストールします。

```powershell
python -m pip install -r requirements.txt
```

3. CSV ファイルを `sample-data` フォルダなどに置きます。
4. 必要に応じて認証情報ファイル `credentials.json` を用意します。
5. 次のコマンドで Excel を生成します。

```powershell
python src/main.py --input sample-data/sample.csv --output output/daily_report.xlsx
```

複数 CSV ファイルを渡す場合:

```powershell
python src/main.py --input sample-data/sample.csv sample-data/other.csv --output output/daily_report.xlsx
```

認証情報ファイルを使う場合:

```powershell
python src/main.py --input sample-data/sample.csv --output output/daily_report.xlsx --credentials credentials.json
```

`credentials.json` は次のような形式です。

```json
{
  "user_id": "your_sbi_user_id",
  "password": "your_sbi_password"
}
```

現在のバージョンでは、認証情報ファイルを読み込むだけで、SBI への自動ログインは行いません。将来の API 連携や自動化機能を追加するための準備として使います。

入力にフォルダを指定すると、フォルダ内の `*.csv` をすべて読み込みます。

## CSV フォーマット

以下の列名を持つ CSV に対応しています。日本語・英語の列名を混在しても自動判別します。

- `date` / `日付` / `取引日`
- `category` / `資産種別` / `asset type`
- `value` / `時価` / `評価額`
- `quantity` / `数量`
- `price` / `単価`
- `ticker` / `銘柄`

`value` がない場合は、`quantity * price` で計算します。

カテゴリは次の 3 つを優先して扱います。

- `NISA`
- `投資信託`
- `個別株`

その他のカテゴリは `その他` として集計します。

## Excel ファイルの内容

生成される Excel ファイルには以下が含まれます。

- `Daily Summary` シート: 日次の評価額、増減、カテゴリ別評価額
- シート内に日次推移グラフ

## 東証プライム 割安・財務健全スクリーナー

このリポジトリに、新しい Python ベースの銘柄スクリーニングアプリを追加しました。東証プライム銘柄の中から、以下の指標を中心に比較できます。

- PER
- PBR
- ROE
- 自己資本比率
- 配当利回り
- 財務健全性スコア

### 使い方

1. `requirements.txt` を更新して必要なパッケージをインストールします。

```powershell
python -m pip install -r requirements.txt
```

2. `sample-data/growth_investment_candidates.csv` などに銘柄コードを準備します。
3. 以下のコマンドで Streamlit アプリを起動します。

```powershell
streamlit run src/streamlit_screener.py
```

4. ブラウザで銘柄コードを入力するか、CSV をアップロードして比較します。

### データソース

- **Yahoo Finance（無料）** を基盤として、`yfinance` で株価と主要なファンダメンタル指標を取得します。
- 日本株の財務指標は、Yahoo Finance のデータ提供範囲に依存します。
- `yfinance` は無料で利用でき、東証プライム銘柄にも対応しますが、必要に応じて EDINET や公式開示資料を補完することをおすすめします。

### 東証プライム候補リストの自動取得

- `src/tse_prime_list.py` で JPX 公式サイトから最新の TOPIX 銘柄リストをダウンロードし、東証プライム候補を自動生成します。
- `src/streamlit_screener.py` には「東証プライム候補リストを自動取得」ボタンを追加しました。
- これにより、候補銘柄リストを手動で用意することなく、JPX 公開データを元にした自動スクリーニングが可能です。

## SBI API の状況

現時点では、SBI証券の一般公開された汎用口座データ取得 API は確認できませんでした。SBI には先物・オプション向けの API や、Excel 統合のための連携サービス（例: ネオトレ API for Excel）の情報が存在しますが、NISA/投資信託/個別株の口座評価額を直接取得する公開 API は公式サイトで明示されていないようです。

このスクリプトは現在、手動 CSV 取り込み方式を前提としています。

## 自動実行

Windows Task Scheduler で次のようなコマンドを実行することで、日次の Excel レポートを自動生成できます。

```powershell
python "C:\path\to\SBI-investment-tracker\src\main.py" --input "C:\path\to\csv-folder" --output "C:\path\to\output\daily_report.xlsx"
```

`--input` にフォルダを指定すると、フォルダ内のすべての CSV ファイルを読み込みます。
