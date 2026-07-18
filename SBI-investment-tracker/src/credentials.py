from __future__ import annotations

import json
from pathlib import Path
from typing import Dict

CredentialDict = Dict[str, str]


def load_credentials(path: Path) -> CredentialDict:
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f'Credentials file not found: {path}')

    if path.suffix.lower() == '.json':
        with path.open('r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError('Credentials JSON must contain an object.')
        user_id = data.get('user_id') or data.get('id') or data.get('username')
        password = data.get('password') or data.get('pass')
    else:
        text = path.read_text(encoding='utf-8').splitlines()
        if len(text) < 2:
            raise ValueError('Credentials file must contain user_id on the first line and password on the second line.')
        user_id = text[0].strip()
        password = text[1].strip()

    if not user_id or not password:
        raise ValueError('Credentials file must contain both user_id and password.')

    return {'user_id': str(user_id), 'password': str(password)}


def mask_password(password: str) -> str:
    return '*' * len(password)
