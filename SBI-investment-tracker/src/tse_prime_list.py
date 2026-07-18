from __future__ import annotations

import logging
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)

JPX_TOPIX_LIST_PAGE = 'https://www.jpx.co.jp/markets/statistics-equities/misc/01.html'

COLUMN_NAMES = [
    'date',
    'code',
    'name',
    'industry',
    'industry33',
    'industry33_name',
    'industry17',
    'industry17_name',
    'market_group',
    'market_group_name',
]


class _XlsLinkParser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__()
        self.base_url = base_url
        self.xls_url: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str]]) -> None:
        if tag != 'a':
            return

        for key, value in attrs:
            if key == 'href' and value and 'data_j.xls' in value:
                self.xls_url = urllib.parse.urljoin(self.base_url, value)
                return


def fetch_jpx_topix_xls_url() -> str:
    with urllib.request.urlopen(JPX_TOPIX_LIST_PAGE, timeout=20) as response:
        html = response.read().decode('utf-8', errors='ignore')

    parser = _XlsLinkParser(JPX_TOPIX_LIST_PAGE)
    parser.feed(html)
    if not parser.xls_url:
        raise RuntimeError('JPX の TOPIX 銘柄リスト Excel のダウンロード先が見つかりませんでした。')
    return parser.xls_url


def download_jpx_topix_xls() -> bytes:
    url = fetch_jpx_topix_xls_url()
    with urllib.request.urlopen(url, timeout=20) as response:
        return response.read()


def parse_jpx_topix_xls(raw_bytes: bytes) -> pd.DataFrame:
    df = pd.read_excel(BytesIO(raw_bytes), engine='xlrd', header=0)

    if df.shape[1] != len(COLUMN_NAMES):
        raise ValueError('JPX Excel の列数が予想と異なります。列数=' + str(df.shape[1]))

    df.columns = COLUMN_NAMES
    df = df.dropna(subset=['code']).copy()
    df['code'] = df['code'].astype(str).str.strip()
    df = df[df['code'].str.match(r'^\d+$')].copy()
    df['code'] = df['code'].str.zfill(4)
    df['name'] = df['name'].astype(str).str.strip()
    df['industry'] = df['industry'].astype(str).str.strip()
    df['industry33_name'] = df['industry33_name'].astype(str).str.strip()
    df['industry17_name'] = df['industry17_name'].astype(str).str.strip()
    df['market_group_name'] = df['market_group_name'].astype(str).str.strip()
    df['ticker'] = df['code'] + '.T'
    return df


def filter_prime_candidates(df: pd.DataFrame) -> pd.DataFrame:
    if 'market_group_name' not in df.columns:
        raise ValueError('market_group_name 列が存在しません。')

    candidate_df = df[df['market_group_name'].notna()].copy()
    candidate_df = candidate_df[candidate_df['market_group_name'] != '-']
    candidate_df = candidate_df[~candidate_df['name'].str.contains(r'ETF|ETN|上場投信|上場投資信託|ETF／ETN', na=False, case=False)]
    candidate_df = candidate_df.sort_values(['code'])
    return candidate_df.reset_index(drop=True)


def fetch_tse_prime_candidates() -> pd.DataFrame:
    raw_bytes = download_jpx_topix_xls()
    df = parse_jpx_topix_xls(raw_bytes)
    return filter_prime_candidates(df)


def get_tse_prime_ticker_list(limit: int | None = None) -> list[str]:
    df = fetch_tse_prime_candidates()
    tickers = df['code'].astype(str).str.zfill(4).tolist()
    if limit is not None:
        return tickers[:limit]
    return tickers


def save_tse_prime_candidates_csv(path: str | Path) -> None:
    df = fetch_tse_prime_candidates()
    df.to_csv(path, index=False, encoding='utf-8-sig')
