import csv
import json
from io import StringIO
from pathlib import Path
from datetime import datetime
import pandas as pd

DATE_FORMATS = ('%Y-%m-%d', '%Y/%m/%d', '%Y.%m.%d', '%m/%d/%Y', '%y/%m/%d')

def parse_date(value):
    if not isinstance(value, str):
        return None
    value = value.strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def parse_float(value):
    if value is None:
        return None
    text = str(value).strip().replace(',', '').replace('¥', '').replace('円', '').replace('+', '')
    if text == '':
        return None
    try:
        return float(text)
    except ValueError:
        return None


def load_csv(csv_path):
    """CSVファイルを読み込む - SBI ポートフォリオレポート形式対応"""
    csv_path = Path(csv_path)
    text = csv_path.read_text(encoding='cp932', errors='replace')
    reader = csv.reader(StringIO(text))
    
    rows = list(reader)
    records = []
    
    # SBI レポート構造: セクションを行番号で定義
    # L9-15: 個別株データ（L16が見出し）
    # L21-25: 投資信託（特定預り）（L26が見出し）
    # L31: 投資信託（成長投資枠）（L32が見出し）
    # L37, L43-44: 投資信託（つみたて投資枠）（L38, L45が見出し）
    
    sections = [
        (8, 16, '個別株'),              # 行9-15（0-indexed: 8-15）
        (20, 26, '投資信託(特定預り)'),  # 行21-25（0-indexed: 20-25）
        (30, 32, '投資信託(成長投資枠)'), # 行31（0-indexed: 30）
        (35, 38, '投資信託(つみたて投資枠)'), # 行36-37, 43-44（0-indexed: 35-37, 42-44）
    ]
    
    for start, end, category in sections:
        for i in range(start, min(end, len(rows))):
            row = rows[i]
            if len(row) < 2 or not row[0].strip():
                continue
            
            ticker = row[0].strip()
            date_str = row[1].strip() if len(row) > 1 else ''
            
            # ヘッダ行や合計行をスキップ
            if any(x in ticker for x in ['ファンド名', '銘柄', '資産額', '年利率', '合計', '数量', 'コード']):
                continue
            
            # 末尾の有効な数値を資産額として使う
            value = None
            for j in range(len(row) - 1, 1, -1):
                val = parse_float(row[j])
                if val is not None and val > 0:
                    value = val
                    break
            
            if value is not None and value > 0:
                # 日付をパース
                if date_str and date_str != '----/--/--':
                    parsed_date = parse_date(date_str)
                    if parsed_date is None:
                        continue
                else:
                    parsed_date = datetime.now().date()
                
                records.append({
                    'date': parsed_date,
                    'ticker': ticker,
                    'category': category,
                    'value': value,
                })
    
    # つみたて投資枠の追加セクション（L43-44）
    for i in range(42, min(45, len(rows))):
        row = rows[i]
        if len(row) < 2 or not row[0].strip():
            continue
        
        ticker = row[0].strip()
        date_str = row[1].strip() if len(row) > 1 else ''
        
        if any(x in ticker for x in ['ファンド名', '銘柄', '資産額', '合計']):
            continue
        
        value = None
        for j in range(len(row) - 1, 1, -1):
            val = parse_float(row[j])
            if val is not None and val > 0:
                value = val
                break
        
        if value is not None and value > 0:
            parsed_date = datetime.now().date() if date_str == '----/--/--' else parse_date(date_str)
            if parsed_date or date_str == '----/--/--':
                records.append({
                    'date': parsed_date or datetime.now().date(),
                    'ticker': ticker,
                    'category': '投資信託(つみたて投資枠)',
                    'value': value,
                })
    
    if not records:
        raise ValueError(f'CSV に解析可能なデータが見つかりません: {csv_path}')
    
    df = pd.DataFrame(records)
    df['date'] = pd.to_datetime(df['date'])
    return df

def calculate_daily_assets(df):
    """日付ごとの資産合計を計算"""
    daily_total = df.groupby('date')['value'].sum().reset_index()
    daily_total = daily_total.sort_values('date')
    return daily_total

def calculate_category_assets(df):
    """カテゴリ別の資産を計算"""
    category_total = df.groupby('category')['value'].sum().reset_index()
    return category_total

def calculate_ticker_assets(df):
    """銘柄別の資産を計算"""
    ticker_total = df.groupby('ticker')['value'].sum().reset_index()
    return ticker_total

def generate_html(csv_path, output_path):
    """HTMLを生成"""
    df = load_csv(csv_path)
    
    # データ計算
    daily_assets = calculate_daily_assets(df)
    category_assets = calculate_category_assets(df)
    ticker_assets = calculate_ticker_assets(df)
    
    # JSONに変換
    dates = daily_assets['date'].dt.strftime('%Y-%m-%d').tolist()
    values = daily_assets['value'].tolist()
    
    categories = category_assets['category'].tolist()
    category_values = category_assets['value'].tolist()
    
    tickers = ticker_assets['ticker'].tolist()
    ticker_values = ticker_assets['value'].tolist()
    
    total_assets = df['value'].sum()
    
    # HTMLテンプレート
    html_template = f"""<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SBI 資産推移グラフ</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js"></script>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }}
        
        .container {{
            max-width: 1400px;
            margin: 0 auto;
        }}
        
        header {{
            background: white;
            padding: 30px;
            border-radius: 10px;
            margin-bottom: 30px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }}
        
        h1 {{
            color: #333;
            margin-bottom: 10px;
        }}
        
        .total-assets {{
            font-size: 28px;
            color: #667eea;
            font-weight: bold;
        }}
        
        .chart-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }}
        
        .chart-card {{
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }}
        
        .chart-card h2 {{
            color: #333;
            font-size: 18px;
            margin-bottom: 15px;
            border-bottom: 2px solid #667eea;
            padding-bottom: 10px;
        }}
        
        canvas {{
            max-height: 400px;
        }}
        
        .table-card {{
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            margin-bottom: 20px;
        }}
        
        .table-card h2 {{
            color: #333;
            font-size: 18px;
            margin-bottom: 15px;
            border-bottom: 2px solid #667eea;
            padding-bottom: 10px;
        }}
        
        table {{
            width: 100%;
            border-collapse: collapse;
        }}
        
        th {{
            background: #f5f5f5;
            padding: 12px;
            text-align: left;
            font-weight: 600;
            color: #333;
            border-bottom: 2px solid #ddd;
        }}
        
        td {{
            padding: 12px;
            border-bottom: 1px solid #eee;
        }}
        
        tr:hover {{
            background: #f9f9f9;
        }}
        
        .value {{
            text-align: right;
            font-weight: 500;
        }}
        
        footer {{
            text-align: center;
            color: white;
            padding: 20px;
            font-size: 12px;
        }}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>SBI 投資ポートフォリオ分析</h1>
            <div class="total-assets">総資産: ¥{total_assets:,.0f}</div>
            <p style="color: #666; margin-top: 10px;">更新日時: {datetime.now().strftime('%Y年%m月%d日 %H:%M:%S')}</p>
        </header>
        
        <div class="chart-grid">
            <div class="chart-card">
                <h2>日次資産推移</h2>
                <canvas id="dailyChart"></canvas>
            </div>
            
            <div class="chart-card">
                <h2>カテゴリ別資産構成</h2>
                <canvas id="categoryChart"></canvas>
            </div>
            
            <div class="chart-card">
                <h2>銘柄別資産構成</h2>
                <canvas id="tickerChart"></canvas>
            </div>
        </div>
        
        <div class="table-card">
            <h2>カテゴリ別詳細</h2>
            <table>
                <thead>
                    <tr>
                        <th>カテゴリ</th>
                        <th class="value">資産額</th>
                        <th class="value">割合</th>
                    </tr>
                </thead>
                <tbody>
"""
    
    for i, cat in enumerate(categories):
        percentage = (category_values[i] / total_assets) * 100
        html_template += f"""                    <tr>
                        <td>{cat}</td>
                        <td class="value">¥{category_values[i]:,.0f}</td>
                        <td class="value">{percentage:.1f}%</td>
                    </tr>
"""
    
    html_template += f"""                </tbody>
            </table>
        </div>
        
        <div class="table-card">
            <h2>銘柄別詳細</h2>
            <table>
                <thead>
                    <tr>
                        <th>銘柄</th>
                        <th class="value">資産額</th>
                        <th class="value">割合</th>
                    </tr>
                </thead>
                <tbody>
"""
    
    for i, ticker in enumerate(tickers):
        percentage = (ticker_values[i] / total_assets) * 100
        html_template += f"""                    <tr>
                        <td>{ticker}</td>
                        <td class="value">¥{ticker_values[i]:,.0f}</td>
                        <td class="value">{percentage:.1f}%</td>
                    </tr>
"""
    
    html_template += """                </tbody>
            </table>
        </div>
        
        <footer>
            <p>このレポートは自動生成されました。投資の判断にはご自身の判断をご使用ください。</p>
        </footer>
    </div>
    
    <script>
        // 日次資産推移チャート
        const dailyCtx = document.getElementById('dailyChart').getContext('2d');
        new Chart(dailyCtx, {
            type: 'line',
            data: {
                labels: """ + json.dumps(dates) + """,
                datasets: [{
                    label: '総資産',
                    data: """ + json.dumps(values) + """,
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102, 126, 234, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointBackgroundColor: '#667eea',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            font: { size: 12 }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        ticks: {
                            callback: function(value) {
                                return '¥' + value.toLocaleString('ja-JP');
                            }
                        }
                    }
                }
            }
        });
        
        // カテゴリ別円グラフ
        const categoryCtx = document.getElementById('categoryChart').getContext('2d');
        const categoryColors = ['#667eea', '#764ba2', '#f093fb', '#4facfe'];
        new Chart(categoryCtx, {
            type: 'doughnut',
            data: {
                labels: """ + json.dumps(categories) + """,
                datasets: [{
                    data: """ + json.dumps(category_values) + """,
                    backgroundColor: categoryColors,
                    borderColor: '#fff',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return '¥' + context.parsed.y.toLocaleString('ja-JP');
                            }
                        }
                    }
                }
            }
        });
        
        // 銘柄別円グラフ
        const tickerCtx = document.getElementById('tickerChart').getContext('2d');
        const tickerColors = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b', '#fa709a', '#fee140', '#30b0fe'];
        new Chart(tickerCtx, {
            type: 'doughnut',
            data: {
                labels: """ + json.dumps(tickers) + """,
                datasets: [{
                    data: """ + json.dumps(ticker_values) + """,
                    backgroundColor: tickerColors,
                    borderColor: '#fff',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return '¥' + context.parsed.y.toLocaleString('ja-JP');
                            }
                        }
                    }
                }
            }
        });
    </script>
</body>
</html>
"""
    
    # HTMLファイルを出力
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(html_template, encoding='utf-8')
    
    print(f"✅ HTMLを生成しました: {output_file}")
    return str(output_file)

if __name__ == "__main__":
    csv_path = Path(__file__).parent.parent / "InputData" / "New_file.csv"
    output_path = Path(__file__).parent.parent / "output" / "asset_report.html"
    generate_html(str(csv_path), str(output_path))
