from __future__ import annotations

import csv
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

DATE_HEADERS = {'date', '日付', '取引日', '約定日'}
CATEGORY_HEADERS = {'category', 'asset type', '資産種別', 'account', '勘定科目'}
VALUE_HEADERS = {'value', 'market value', '時価', '評価額', '時価評価額'}
PRICE_HEADERS = {'price', '単価', '値段'}
QUANTITY_HEADERS = {'quantity', '数量', '口数', '株数'}

CATEGORY_MAP = {
    'nisa': 'NISA',
    'つみたてnisa': 'NISA',
    'nisa口座': 'NISA',
    '投資信託': '投資信託',
    'etf': '投資信託',
    '個別株': '個別株',
    '現物株': '個別株',
    'stock': '個別株',
    'other': 'その他',
}

DEFAULT_CATEGORIES = ['NISA', '投資信託', '個別株', 'その他']


def find_column(header: str, candidates: set[str]) -> bool:
    normalized = header.strip().lower()
    return normalized in candidates


def normalize_category(value: str) -> str:
    cleaned = value.strip().lower().replace(' ', '').replace('_', '')
    if cleaned in CATEGORY_MAP:
        return CATEGORY_MAP[cleaned]
    if 'nisa' in cleaned:
        return 'NISA'
    if '投資信託' in cleaned or 'etf' in cleaned:
        return '投資信託'
    if '株' in cleaned or 'stock' in cleaned:
        return '個別株'
    if cleaned == '':
        return 'その他'
    return 'その他'


def parse_date(value: str) -> datetime.date:
    value = value.strip()
    for fmt in ('%Y-%m-%d', '%Y/%m/%d', '%Y.%m.%d', '%m/%d/%Y', '%Y%m%d'):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    raise ValueError(f'対応していない日付形式です: {value}')


def parse_float(value: str) -> Optional[float]:
    if value is None:
        return None
    text = value.strip().replace(',', '').replace('¥', '').replace('円', '')
    if text == '':
        return None
    try:
        return float(text)
    except ValueError:
        return None


def discover_files(input_paths: Iterable[str]) -> list[Path]:
    files: list[Path] = []
    for raw_path in input_paths:
        path = Path(raw_path)
        if path.is_dir():
            for child in sorted(path.glob('*.csv')):
                if child.is_file():
                    files.append(child)
        elif path.is_file():
            files.append(path)
    return files


def identify_columns(header_row: Sequence[str]) -> Dict[str, int]:
    columns: Dict[str, int] = {}
    for index, header in enumerate(header_row):
        normalized = header.strip().lower()
        if normalized in DATE_HEADERS:
            columns['date'] = index
        elif normalized in CATEGORY_HEADERS:
            columns['category'] = index
        elif normalized in VALUE_HEADERS:
            columns['value'] = index
        elif normalized in PRICE_HEADERS:
            columns['price'] = index
        elif normalized in QUANTITY_HEADERS:
            columns['quantity'] = index
    return columns


def read_transactions(file_path: Path) -> list[tuple[datetime.date, str, float]]:
    transactions: list[tuple[datetime.date, str, float]] = []
    with file_path.open(newline='', encoding='utf-8-sig') as csvfile:
        reader = csv.reader(csvfile)
        rows = list(reader)
    if not rows:
        return transactions

    header = rows[0]
    columns = identify_columns(header)
    if 'date' not in columns:
        raise ValueError(f'CSV に日付列が見つかりません: {file_path}')
    if 'value' not in columns and not ('price' in columns and 'quantity' in columns):
        raise ValueError(f'CSV に評価額列または単価・数量列が必要です: {file_path}')

    for row in rows[1:]:
        if not row or all(cell.strip() == '' for cell in row):
            continue
        date_cell = row[columns['date']].strip()
        if not date_cell:
            continue
        date = parse_date(date_cell)
        category = 'その他'
        if 'category' in columns:
            category = normalize_category(row[columns['category']])
        value = None
        if 'value' in columns:
            value = parse_float(row[columns['value']])
        if value is None and 'price' in columns and 'quantity' in columns:
            price = parse_float(row[columns['price']])
            quantity = parse_float(row[columns['quantity']])
            if price is not None and quantity is not None:
                value = price * quantity
        if value is None:
            continue
        transactions.append((date, category, value))
    return transactions


def aggregate_daily_values(input_paths: Iterable[str]) -> list[dict[str, object]]:
    files = discover_files(input_paths)
    if not files:
        raise ValueError('入力 CSV ファイルが見つかりません。')

    daily_map: dict[datetime.date, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for file_path in files:
        for date, category, value in read_transactions(file_path):
            daily_map[date][category] += value

    all_dates = sorted(daily_map.keys())
    rows: list[dict[str, object]] = []
    previous_total = 0.0
    for date in all_dates:
        totals: dict[str, float] = {category: 0.0 for category in DEFAULT_CATEGORIES}
        for category, value in daily_map[date].items():
            totals[category] = totals.get(category, 0.0) + value
        total_value = sum(totals.values())
        change = total_value - previous_total if previous_total != 0.0 else 0.0
        previous_total = total_value
        row = {
            'date': date,
            'total_value': total_value,
            'change': change,
            'NISA': totals['NISA'],
            '投資信託': totals['投資信託'],
            '個別株': totals['個別株'],
            'その他': totals['その他'],
        }
        rows.append(row)

    return rows
