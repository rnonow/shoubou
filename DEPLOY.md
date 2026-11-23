# GitHub から自動で反映する設定（一度だけ）

この設定をすると、このリポジトリの `main` にプログラムの変更が入るたびに、
Apps Script へ自動で送られ、**今のウェブアプリが新バージョンに更新** されます。URLは変わりません。

所要時間はおよそ15分です。**Google 側の作業はすべて団専用アカウントで** 行ってください（個人アカウントでは行わない）。

---

## 1. Apps Script API をオンにする

1. 団専用アカウントでログインした状態で https://script.google.com/home/usersettings を開く。
2. **Google Apps Script API** を **オン** にする。

## 2. 2つのIDを控える

Apps Script の編集画面（スプレッドシート → 拡張機能 → Apps Script）で：

- **スクリプトID**：左の ⚙（プロジェクトの設定）→「ID」の **スクリプトID** をコピー
- **デプロイID**：右上の **デプロイ → デプロイを管理** → 今使っているウェブアプリを選ぶ → **デプロイID** をコピー
  （`AKfycb…` で始まる長い文字列。URLの `/s/` と `/exec` の間と同じものです）

## 3. clasp のログイン情報を作る（ブラウザだけでできます）

clasp は Google が出している Apps Script 用の道具です。GitHub の「Codespaces」を使えば、パソコンに何も入れずに作業できます。

1. GitHub でこのリポジトリを開き、緑の **Code** ボタン → **Codespaces** タブ → **Create codespace on main**。
   しばらくすると、ブラウザ上に編集画面が開きます。下の方に **ターミナル** があります。
2. ターミナルに次を貼り付けて Enter：
   ```
   npx -y @google/clasp@2.4.2 login
   ```
3. 長いURLが表示されるので、Ctrl（Macは⌘）を押しながらクリックして開く。
   **団専用アカウント** を選び、「許可」を押す。
4. 許可したあと、ブラウザに「このサイトにアクセスできません」（localhost）と表示されます。これで正常です。
   その画面の **アドレス欄のURLを全部コピー** する（`http://localhost:…` で始まるもの）。
5. Codespaces に戻り、ターミナル右上の **＋** で2つ目のターミナルを開いて、次のように入力して Enter：
   ```
   curl "ここにコピーしたURLを貼る"
   ```
   1つ目のターミナルに `Authorization successful` と出れば成功です。
6. 次を入力して Enter し、表示された `{` から `}` まで **全部** をコピーする：
   ```
   cat ~/.clasprc.json
   ```
   ※これは団専用アカウントの「合鍵」です。LINEやメールに貼らないでください。

## 4. GitHub に3つの値を登録する

リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で、次の3つを登録します。

| Name | Secret に入れるもの |
|---|---|
| `CLASPRC_JSON` | 手順3-6でコピーした `{ … }` 全部 |
| `SCRIPT_ID` | 手順2のスクリプトID |
| `DEPLOYMENT_ID` | 手順2のデプロイID |

## 5. Codespace を削除する

合鍵が残らないよう、https://github.com/codespaces を開き、作った Codespace の「…」→ **Delete** で削除します。

## 6. 動くか試す

1. リポジトリの **Actions** タブ → 左の **「Apps Script へ反映」** → **Run workflow** → 緑の **Run workflow**。
2. 1〜2分で緑のチェック ✅ になれば完了です。
   Apps Script の「デプロイを管理」を見ると、バージョンが1つ増えています。アプリのURLはそのままです。

---

## うまくいかないとき

- **赤い ✖ で `User has not enabled the Apps Script API`**：手順1を団専用アカウントでやり直す。数分待ってから再実行。
- **`invalid_grant` や認証エラー**：団専用アカウントのパスワードを変えた、など。手順3と5をやり直して `CLASPRC_JSON` を登録し直す。
- **黄色い警告で「スキップしました」**：Secrets がまだ登録されていません（手順4）。
- 自動反映を使い始めたら、Apps Script の画面で直接プログラムを書き換えないでください。次の反映で上書きされます。
