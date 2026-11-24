# src/ から gas/index.html（Apps Script用）と demo.html（お試し版）を作る
import pathlib
here = pathlib.Path(__file__).parent; root = here.parent
css = (here / "style.css").read_text(); js = (here / "app.js").read_text(); guard = (here / "guard.html").read_text()
# Apps Script は配信時に「/* … */」をコメントとして削るので、文字列や正規表現の中に /* や */ があるとプログラムが壊れる。
# /** … */ のコメントはここで消し、残っていたら作るのをやめる。
import re
js = re.sub(r"^\s*/\*\*.*?\*/\s*$", "", js, flags=re.M)
for name, src in (("app.js", js), ("guard.html", guard), ("style.css", css)):
    if name != "style.css" and ("/*" in src or "*/" in src):
        raise SystemExit(f"{name} に /* か */ が残っています（Apps Script が削ってしまうので書き換えてください）")
def page(cfg, title):
    return f"""<!DOCTYPE html>
<html lang="ja"><head>
<base target="_top">
<meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{title}</title>
<style>
{css}</style>
<script>{cfg}</script>
</head><body>
<header><span id="team">🚒 消防団</span><span id="who"></span></header>
<div id="demo" hidden>お試しモード：データはこの端末だけに保存されます</div>
<main id="app"><div class="loading"><div class="spin"></div><p>読み込み中…</p><p class="muted">開くまでに数秒かかることがあります</p></div></main>
<nav id="nav" hidden>
  <button data-tab="notices"><span class="ic">📢</span>お知らせ</button>
  <button data-tab="events"><span class="ic">📅</span>イベント</button>
  <button data-tab="dispatches"><span class="ic">🔥</span>出動記録</button>
  <button data-tab="ledger"><span class="ic">💴</span>収支簿</button>
  <button data-tab="members"><span class="ic">👥</span>団員</button>
</nav>
<div id="toast" hidden></div>
{guard}<script>
{js}</script>
</body></html>
"""
gas_cfg = 'window.APP_CONFIG = { MODE: "gas", APP_URL: <?= appUrl ?>, FOCUS_EVENT: <?= focusEvent ?>, TOKEN: <?= token ?>, INITIAL: <?= initial ?>, BOOT_ERROR: <?= bootError ?>, TEAM_NAME: <?= teamName ?> };'
(root / "gas" / "index.html").write_text(page(gas_cfg, "消防団連絡アプリ"))
(root / "demo.html").write_text(page('window.APP_CONFIG = { MODE: "demo", TEAM_NAME: "消防団" };', "消防団連絡アプリ（お試し）"))
print("built")
