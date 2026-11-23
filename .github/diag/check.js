// 公開中のアプリを実際のブラウザ（Safariと同じWebKit / Chrome）で開き、起動の様子を記録する（調査用）
const pw = require('playwright');
const url = process.env.APP_URL;
(async () => {
  for (const [name, dev] of [['webkit', 'iPhone 13'], ['chromium', null]]) {
    const b = await pw[name].launch();
    const ctx = await b.newContext(dev ? pw.devices[dev] : {});
    const p = await ctx.newPage();
    const logs = [];
    p.on('console', (m) => logs.push('console.' + m.type() + ': ' + m.text().slice(0, 300)));
    p.on('pageerror', (e) => logs.push('pageerror: ' + e.message.slice(0, 300)));
    p.on('requestfailed', (r) => logs.push('requestfailed: ' + r.url().replace(/\?.*/, '').slice(0, 120) + ' ' + (r.failure() || {}).errorText));
    p.on('response', (r) => { if (r.status() >= 400) logs.push('http ' + r.status() + ' ' + r.url().replace(/\?.*/, '').slice(0, 120)); });
    try { await p.goto(url, { waitUntil: 'load', timeout: 60000 }); } catch (e) { logs.push('goto: ' + e.message.slice(0, 200)); }
    await p.waitForTimeout(45000);
    console.log('===== ' + name);
    for (const f of p.frames()) {
      try {
        const r = await f.evaluate(() => ({
          stage: window.__stage, booted: window.__booted, cfg: !!window.APP_CONFIG,
          scripts: [...document.scripts].map((s) => (s.src ? 'src' : 'inline') + ':' + s.text.length),
          big: [...document.scripts].filter((s) => s.text.length > 20000 && s.text.includes('__stage')).map((s) => ({ head: s.text.slice(0, 300), tail: s.text.slice(-600) })),
          text: document.body ? document.body.innerText.replace(/\s+/g, ' ').slice(0, 300) : '',
        }));
        console.log('frame', f.url().replace(/\?.*/, '').slice(0, 90), JSON.stringify(r));
      } catch (e) { console.log('frame err', e.message.slice(0, 120)); }
    }
    console.log(logs.join('\n'));
    await b.close();
  }
})();
