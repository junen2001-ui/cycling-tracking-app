from __future__ import annotations

import streamlit as st
import plotly.express as px

from japanese_stock_screener import build_screener_dataframe
from growth_investment_frame import build_growth_frame_candidates, get_growth_candidate_source, get_growth_frame_ticker_list, load_growth_candidate_file
from tse_prime_list import fetch_tse_prime_candidates


st.set_page_config(page_title='東証プライム割安&財務健全スクリーニング', layout='wide')

st.title('東証プライム 割安＆財務健全スクリーニング')
st.markdown(
    '高市政権の成長投資枠候補の中から、PER/PBR/ROE/自己資本比率/配当利回りを比較し、' 
    '割安感と健全性を可視化します。'
)

with st.expander('使い方'): 
    st.markdown(
        '''
- 銘柄コードをカンマ区切りで入力するか、CSV をアップロードしてください。
- 東証プライムの銘柄コードには `.T` を付けずに入力できます（例: 7203, 8035）。
- 取得できる指標は Yahoo Finance の公開データを利用します。
- 「東証プライム候補リストを自動取得」ボタンで JPX 公式のデータを利用できます。
- ダウンロードボタンで結果を CSV 形式で保存できます。
        '''
    )

if 'candidate_text' not in st.session_state:
    st.session_state.candidate_text = ''

if 'candidate_df' not in st.session_state:
    st.session_state.candidate_df = None

growth_candidate_file = st.file_uploader('成長投資枠候補リスト（CSV）をアップロード', type=['csv'], help='公式成長投資枠リストをお持ちの場合はこちらにアップしてください。')
if growth_candidate_file is not None:
    try:
        growth_candidate_df = load_growth_candidate_file(growth_candidate_file)
        st.session_state.growth_candidate_df = growth_candidate_df
        st.success(f'アップロードされた候補リストを読み込みました。{len(growth_candidate_df)} 銘柄')
    except Exception as exc:
        st.error('候補リストの読み込みに失敗しました。 ' + str(exc))
        st.session_state.growth_candidate_df = None

if st.button('東証プライム候補リストを自動取得'):
    with st.spinner('JPX 公式データを取得中...'):
        try:
            candidate_df = fetch_tse_prime_candidates()
            st.session_state.candidate_df = candidate_df
            st.session_state.candidate_text = ', '.join(candidate_df['ticker'].str.replace('.T', '').tolist())
            st.success(f'{len(candidate_df)} 件の東証プライム候補を取得しました。')
        except Exception as exc:
            st.session_state.candidate_df = None
            st.error('候補リストの取得に失敗しました。 ' + str(exc))

if st.button('成長投資枠候補トップ100を取得'):
    with st.spinner('成長投資枠候補を抽出中...'):
        try:
            candidate_df = build_growth_frame_candidates(
                limit=100,
                candidate_df=st.session_state.get('growth_candidate_df'),
            )
            st.session_state.candidate_df = candidate_df
            st.session_state.candidate_text = ', '.join(candidate_df['ticker'].str.replace('.T', '').tolist())
            st.session_state.candidate_source = get_growth_candidate_source()
            st.success(f'{len(candidate_df)} 件の成長投資枠候補を抽出しました。候補ソース: {st.session_state.candidate_source}')
        except Exception as exc:
            st.session_state.candidate_df = None
            st.error('成長投資枠候補の抽出に失敗しました。 ' + str(exc))

if st.session_state.candidate_df is not None:
    st.subheader('自動取得した候補リスト（上位100件）')
    if 'candidate_source' in st.session_state:
        st.caption(f'候補ソース: {st.session_state.candidate_source}')
    display_cols = [c for c in ['ticker', 'name', 'industry', 'industry17_name', 'industry33_name', 'market_group'] if c in st.session_state.candidate_df.columns]
    st.dataframe(st.session_state.candidate_df[display_cols].head(100), use_container_width=True)

ticker_text = st.text_area('銘柄コード（カンマ区切り）', value=st.session_state.candidate_text or '7203, 8035, 9432, 7974')
uploaded_file = st.file_uploader('CSV ファイルをアップロード', type=['csv'])

if uploaded_file is not None:
    import pandas as pd

    uploaded_df = pd.read_csv(uploaded_file)
    if 'ticker' in uploaded_df.columns:
        ticker_text = ','.join(map(str, uploaded_df['ticker'].dropna().tolist()))
    elif uploaded_df.shape[1] >= 1:
        ticker_text = ','.join(map(str, uploaded_df.iloc[:, 0].dropna().tolist()))

if st.button('指標を取得して比較'): 
    tickers = [item.strip() for item in ticker_text.split(',') if item.strip()]
    if not tickers:
        st.warning('銘柄コードを入力してください。')
    else:
        with st.spinner('データ取得中...'): 
            df = build_screener_dataframe(tickers)

        if df.empty:
            st.error('銘柄データを取得できませんでした。')
        else:
            st.metric('対象銘柄数', len(df))
            st.dataframe(df.drop(columns=['Score Details']), use_container_width=True)

            if 'industry' in df.columns and df['industry'].notna().sum() >= 2:
                industry_summary = (
                    df.groupby('industry')[['PER', 'PBR', 'ROE', 'Debt/Equity', 'Dividend Yield', 'Self Capital Ratio (%)']]
                    .mean()
                    .round(3)
                    .reset_index()
                )
                st.subheader('同業他社平均比較')
                st.dataframe(industry_summary, use_container_width=True)

            chart_metrics = ['PER', 'PBR', 'ROE', 'Debt/Equity', 'Dividend Yield', 'Self Capital Ratio (%)']
            selected_metrics = st.multiselect('比較する指標', chart_metrics, default=chart_metrics[:4])

            if selected_metrics:
                chart_df = df[['ticker', 'name'] + selected_metrics].copy()
                chart_df = chart_df.melt(id_vars=['ticker', 'name'], value_vars=selected_metrics, var_name='metric', value_name='value')
                fig = px.bar(
                    chart_df,
                    x='ticker',
                    y='value',
                    color='metric',
                    barmode='group',
                    title='銘柄別指標比較',
                    labels={'value': '値', 'ticker': '銘柄コード'},
                )
                st.plotly_chart(fig, use_container_width=True)

            st.download_button('CSV をダウンロード', data=df.to_csv(index=False).encode('utf-8-sig'), file_name='screener_results.csv', mime='text/csv')
