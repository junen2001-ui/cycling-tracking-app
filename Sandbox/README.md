# ペットボトル シューティング（MVP）

ローカルで最小限の実行手順。

1. 簡易サーバーを起動して `index.html` を配信します（モジュールを使っているため、ファイルを直接開くと動かない場合があります）。

Windows PowerShell の例:

```powershell
# Python がある場合
python -m http.server 8000

# または npm の http-server
npx http-server . -p 8000
```

2. ブラウザで次にアクセス:

```
http://localhost:8000/Sandbox/index.html
```

3. 操作:
- 移動: 矢印キー
- 射撃: スペース
- 中身切替: `C`（water / air）
- 変形（短時間）: `V`

次のステップ: アセット追加、敵パターン拡張、スコア・ライフ実装、サウンド追加。
