from __future__ import annotations

import argparse
from pathlib import Path

from credentials import load_credentials, mask_password
from data_loader import aggregate_daily_values
from excel_writer import write_excel_report


def parse_args() -> argparse.Namespace:
    default_input = str(Path(__file__).resolve().parents[1] / 'InputData' / 'New_file.csv')
    parser = argparse.ArgumentParser(description='SBI 投資データを読み込み、Excel レポートを生成します。')
    parser.add_argument('--input', '-i', nargs='+', default=[default_input], help=f'CSV ファイルまたは CSV フォルダのパス。複数指定可。デフォルト: {default_input}')
    parser.add_argument('--output', '-o', required=True, help='出力先 Excel ファイルのパス。')
    parser.add_argument('--credentials', '-c', help='ID とパスワードを含むファイルのパス（JSON または 2 行テキスト）。')
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_paths = args.input
    output_path = Path(args.output)

    credentials = None
    if args.credentials:
        credentials = load_credentials(Path(args.credentials))
        print('認証情報を読み込みました。')
        print(f"user_id={credentials['user_id']}, password={mask_password(credentials['password'])}")
        print('現在のバージョンでは SBI へのログインは実行しません。')

    print('読み込み中...', input_paths)
    daily_rows = aggregate_daily_values(input_paths)
    if not daily_rows:
        raise SystemExit('日次データが見つかりませんでした。')

    print('Excel を生成中...', output_path)
    write_excel_report(output_path, daily_rows)
    print(f'完了: {output_path}')


if __name__ == '__main__':
    main()
