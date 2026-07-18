from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable

import pandas as pd

from japanese_stock_screener import fetch_company_fundamentals
from tse_prime_list import fetch_tse_prime_candidates

GROWTH_INDUSTRY_KEYWORDS = [
    '情報',
    '通信',
    '半導体',
    '電子部品',
    '精密機器',
    '機械',
    '電気機器',
    '化学',
    '薬',
    '医薬',
    'バイオ',
    'AI',
    'DX',
    '再生可能',
    '素材',
    '医療',
]

GROWTH_CANDIDATE_CSV = Path(__file__).resolve().parent.parent / 'sample-data' / 'growth_investment_candidates.csv'

EXCLUDE_KEYWORDS = [
    '銀行',
    '証券',
    '保険',
    '不動産',
    'ゴム',
    '石油',
    '海運',
    '紙',
    '食品',
    '小売',
    '商社',
    '運輸',
    '飲料',
]


def _build_growth_pattern(keywords: Iterable[str]) -> re.Pattern[str]:
    escaped = [re.escape(keyword) for keyword in keywords if keyword]
    return re.compile('|'.join(escaped), flags=re.IGNORECASE)


GROWTH_PATTERN = _build_growth_pattern(GROWTH_INDUSTRY_KEYWORDS)
EXCLUDE_PATTERN = _build_growth_pattern(EXCLUDE_KEYWORDS)


def select_growth_industries(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    mask_growth = (
        df['industry17_name'].astype(str).str.contains(GROWTH_PATTERN, na=False)
        | df['industry33_name'].astype(str).str.contains(GROWTH_PATTERN, na=False)
        | df['industry'].astype(str).str.contains(GROWTH_PATTERN, na=False)
    )
    mask_exclude = (
        df['industry17_name'].astype(str).str.contains(EXCLUDE_PATTERN, na=False)
        | df['industry33_name'].astype(str).str.contains(EXCLUDE_PATTERN, na=False)
        | df['industry'].astype(str).str.contains(EXCLUDE_PATTERN, na=False)
    )
    return df[mask_growth & ~mask_exclude].reset_index(drop=True)


def load_default_growth_candidate_list() -> pd.DataFrame:
    if GROWTH_CANDIDATE_CSV.exists():
        return load_growth_candidate_file(GROWTH_CANDIDATE_CSV)
    return pd.DataFrame(columns=['ticker'])


def get_growth_candidate_source() -> str:
    if GROWTH_CANDIDATE_CSV.exists():
        return str(GROWTH_CANDIDATE_CSV)
    return 'JPX 東証プライム候補リスト + 成長キーワード絞り込み'


def build_growth_frame_candidates(limit: int | None = None, candidate_df: pd.DataFrame | None = None) -> pd.DataFrame:
    if candidate_df is None:
        candidate_df = load_default_growth_candidate_list()

    if candidate_df.empty:
        df = fetch_tse_prime_candidates()
        df = select_growth_industries(df)
    else:
        df = candidate_df.copy()

    if df.empty:
        return df

    rows: list[dict[str, object]] = []
    for ticker in df['ticker'].tolist():
        fundamentals = fetch_company_fundamentals(ticker)
        market_group = None
        if 'market_group_name' in df.columns:
            market_group = df.loc[df['ticker'] == ticker, 'market_group_name'].iloc[0]

        rows.append({
            'ticker': fundamentals.ticker,
            'name': fundamentals.name,
            'industry': fundamentals.industry,
            'sector': fundamentals.sector,
            'market_group': market_group,
            'PER': fundamentals.per,
            'PBR': fundamentals.pbr,
            'ROE': fundamentals.roe,
            'Debt/Equity': fundamentals.debt_to_equity,
            'Dividend Yield': fundamentals.dividend_yield,
            'Self Capital Ratio (%)': fundamentals.self_capital_ratio,
            'Market Cap': fundamentals.market_cap,
            'Score': fundamentals.score,
            'Score Details': fundamentals.score_details,
        })

    result = pd.DataFrame(rows)
    result = result.sort_values(
        by=['Score', 'ROE', 'Dividend Yield', 'PER', 'PBR'],
        ascending=[False, False, False, True, True],
        na_position='last',
    )
    if limit is not None:
        return result.head(limit).reset_index(drop=True)
    return result.reset_index(drop=True)


def get_growth_frame_ticker_list(limit: int | None = None) -> list[str]:
    df = build_growth_frame_candidates(limit=limit)
    return df['ticker'].tolist()


def load_growth_candidate_file(path: str | Path | Any) -> pd.DataFrame:
    df = pd.read_csv(path, dtype=str)
    if 'ticker' not in df.columns and 'code' in df.columns:
        df['ticker'] = df['code'].astype(str).str.zfill(4) + '.T'
    elif 'ticker' in df.columns:
        df['ticker'] = df['ticker'].astype(str).str.replace(r'\.T$', '', regex=True).str.zfill(4) + '.T'
    return df
