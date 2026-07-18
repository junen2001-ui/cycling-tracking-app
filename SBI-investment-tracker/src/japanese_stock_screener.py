from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)


@dataclass
class CompanyFundamentals:
    ticker: str
    name: str
    industry: str | None
    sector: str | None
    market_cap: float | None
    per: float | None
    pbr: float | None
    roe: float | None
    debt_to_equity: float | None
    dividend_yield: float | None
    current_price: float | None
    self_capital_ratio: float | None
    score: int
    score_details: dict[str, int]


def to_japanese_ticker(symbol: str) -> str:
    symbol = symbol.strip()
    if symbol.endswith('.T') or symbol.endswith('.JP'):
        return symbol
    return f'{symbol}.T'


def safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def compute_self_capital_ratio(balance_sheet: pd.DataFrame) -> float | None:
    if balance_sheet is None or balance_sheet.empty:
        return None

    try:
        latest = balance_sheet.iloc[:, 0]
        total_assets = safe_float(latest.get('Total Assets') or latest.get('Total assets') or latest.get('TotalAssets'))
        total_equity = safe_float(latest.get('Total Stockholder Equity') or latest.get('Total Stockholders Equity') or latest.get('Total Equity') or latest.get('TotalStockholderEquity'))
        if total_assets and total_equity and total_assets != 0:
            return round(total_equity / total_assets * 100, 1)
    except Exception:
        logger.exception('自己資本比率の計算に失敗しました。')
    return None


def score_metrics(per: float | None, pbr: float | None, roe: float | None, debt_to_equity: float | None, dividend_yield: float | None, self_capital_ratio: float | None) -> tuple[int, dict[str, int]]:
    detail = {
        'per': 0,
        'pbr': 0,
        'roe': 0,
        'de': 0,
        'dividend': 0,
        'self_capital_ratio': 0,
    }

    if per is not None:
        if per <= 12:
            detail['per'] = 3
        elif per <= 15:
            detail['per'] = 2
        elif per <= 18:
            detail['per'] = 1

    if pbr is not None:
        if 0.3 < pbr <= 0.8:
            detail['pbr'] = 3
        elif 0.8 < pbr <= 1:
            detail['pbr'] = 2
        elif 1 < pbr <= 1.5:
            detail['pbr'] = 1

    if roe is not None:
        if roe >= 12:
            detail['roe'] = 3
        elif roe >= 8:
            detail['roe'] = 2
        elif roe >= 5:
            detail['roe'] = 1

    if debt_to_equity is not None:
        if debt_to_equity < 0.5:
            detail['de'] = 3
        elif debt_to_equity < 1:
            detail['de'] = 2
        elif debt_to_equity < 2:
            detail['de'] = 1

    if dividend_yield is not None and dividend_yield >= 0.02:
        detail['dividend'] = 1
        if dividend_yield >= 0.03:
            detail['dividend'] = 2

    if self_capital_ratio is not None:
        if self_capital_ratio >= 50:
            detail['self_capital_ratio'] = 3
        elif self_capital_ratio >= 40:
            detail['self_capital_ratio'] = 2
        elif self_capital_ratio >= 30:
            detail['self_capital_ratio'] = 1

    total = sum(detail.values())
    return total, detail


def fetch_company_fundamentals(symbol: str) -> CompanyFundamentals:
    jp_symbol = to_japanese_ticker(symbol)
    ticker = yf.Ticker(jp_symbol)

    info = ticker.info or {}
    balance_sheet = ticker.balance_sheet

    per = safe_float(info.get('trailingPE') or info.get('forwardPE') or info.get('trailingPegRatio'))
    pbr = safe_float(info.get('priceToBook') or info.get('bookValue'))
    roe = safe_float(info.get('returnOnEquity'))
    debt_to_equity = safe_float(info.get('debtToEquity') or info.get('totalDebt') and info.get('bookValue'))
    dividend_yield = safe_float(info.get('dividendYield'))
    market_cap = safe_float(info.get('marketCap'))
    current_price = safe_float(info.get('currentPrice') or info.get('previousClose'))
    industry = info.get('industry')
    sector = info.get('sector')
    name = info.get('longName') or info.get('shortName') or jp_symbol

    self_capital_ratio = compute_self_capital_ratio(balance_sheet)

    score, details = score_metrics(per, pbr, roe, debt_to_equity, dividend_yield, self_capital_ratio)

    return CompanyFundamentals(
        ticker=jp_symbol,
        name=name,
        industry=industry,
        sector=sector,
        market_cap=market_cap,
        per=per,
        pbr=pbr,
        roe=roe,
        debt_to_equity=debt_to_equity,
        dividend_yield=dividend_yield,
        current_price=current_price,
        self_capital_ratio=self_capital_ratio,
        score=score,
        score_details=details,
    )


def build_screener_dataframe(tickers: list[str]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for symbol in tickers:
        try:
            fundamentals = fetch_company_fundamentals(symbol)
            rows.append({
                'ticker': fundamentals.ticker,
                'name': fundamentals.name,
                'industry': fundamentals.industry,
                'sector': fundamentals.sector,
                'market_cap': fundamentals.market_cap,
                'current_price': fundamentals.current_price,
                'PER': fundamentals.per,
                'PBR': fundamentals.pbr,
                'ROE': fundamentals.roe,
                'Debt/Equity': fundamentals.debt_to_equity,
                'Dividend Yield': fundamentals.dividend_yield,
                'Self Capital Ratio (%)': fundamentals.self_capital_ratio,
                'Score': fundamentals.score,
                'Score Details': fundamentals.score_details,
            })
        except Exception:
            logger.exception('Failed to fetch fundamentals for %s', symbol)

    df = pd.DataFrame(rows)
    if df.empty:
        return df

    df['Market Cap (B JPY)'] = df['market_cap'].apply(lambda v: round(v / 1_000_000_000, 2) if v else None)
    df = df.sort_values(['Score', 'PER', 'PBR'], ascending=[False, True, True])
    df = df[
        [
            'ticker',
            'name',
            'industry',
            'sector',
            'Market Cap (B JPY)',
            'current_price',
            'PER',
            'PBR',
            'ROE',
            'Debt/Equity',
            'Dividend Yield',
            'Self Capital Ratio (%)',
            'Score',
            'Score Details',
        ]
    ]
    return df


def compare_metrics(df: pd.DataFrame, metrics: list[str]) -> pd.DataFrame:
    return df[['ticker', 'name'] + metrics].copy()
