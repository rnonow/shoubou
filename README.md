# shoubou

消防団の連絡アプリ（出動記録・イベント出欠）。Googleスプレッドシート＋Apps Scriptで動きます。費用はかかりません。

- 初めて設定する：[SETUP.md](SETUP.md)
- GitHub から自動で反映する設定：[DEPLOY.md](DEPLOY.md)
- 設定なしで画面を試す：`demo.html` をダウンロードしてブラウザで開く（参加コード `1234`）

## ファイル

| 場所 | 中身 |
|---|---|
| `gas/Code.gs` | サーバー側の処理（Apps Script） |
| `gas/index.html` | 画面（`src/` から自動生成。直接は編集しない） |
| `gas/appsscript.json` | Apps Script の設定（タイムゾーン・公開範囲） |
| `src/` | 画面の元ファイル。編集したら `python3 src/build.py` |
| `.github/workflows/deploy.yml` | main への変更を Apps Script に自動反映 |
