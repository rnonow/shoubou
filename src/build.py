# src/ から gas/index.html（Apps Script用）と demo.html（お試し版）を作る
import pathlib
here = pathlib.Path(__file__).parent; root = here.parent
css = (here / "style.css").read_text(); js = (here / "app.js").read_text()
def page(cfg, title):
    return f"""<!DOCTYPE html>
<html lang="ja"><head>
<base target="_top">
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{title}</title>
<style>
{css}</style>
<script>{cfg}</script>
</head><body>
<header><span id="team">🚒 消防団</span><span id="who"></span></header>
<div id="demo" hidden>お試しモード：データはこの端末だけに保存されます</div>
<main id="app"><p class="muted">読み込み中…</p></main>
<nav id="nav" hidden>
  <button data-tab="notices">📢<br>お知らせ</button>
  <button data-tab="events">📅<br>イベント</button>
  <button data-tab="dispatches">🔥<br>出動記録</button>
  <button data-tab="ledger">💴<br>収支簿</button>
  <button data-tab="members">👥<br>団員</button>
</nav>
<div id="toast" hidden></div>
<script>
{js}</script>
</body></html>
"""
gas_cfg = 'window.APP_CONFIG = { MODE: "gas", APP_URL: <?= appUrl ?>, FOCUS_EVENT: <?= focusEvent ?>, TOKEN: <?= token ?>, INITIAL: <?= initial ?>, TEAM_NAME: <?= teamName ?> };'
(root / "gas" / "index.html").write_text(page(gas_cfg, "消防団連絡アプリ"))
(root / "demo.html").write_text(page('window.APP_CONFIG = { MODE: "demo", TEAM_NAME: "消防団" };', "消防団連絡アプリ（お試し）"))
print("built")
