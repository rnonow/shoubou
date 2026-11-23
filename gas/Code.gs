/**
 * 消防団連絡アプリ（Googleスプレッドシート版）
 * スプレッドシートの「拡張機能 → Apps Script」に貼り付けて使う。
 * データは同じスプレッドシートの各シートに保存される。
 */

var SHEETS = {
  members:   ['id', 'name', 'token', 'is_admin', 'created_at'],
  // 列は必ず「末尾に追加」する（既存データの位置を変えないため）
  dispatches:['id', 'date', 'kind', 'place', 'note', 'member_ids', 'created_by', 'created_at', 'start_time', 'end_time'],
  events:    ['id', 'title', 'starts_at', 'place', 'note', 'created_by', 'created_at', 'ends_at'],
  rsvps:     ['event_id', 'member_id', 'status', 'comment', 'updated_at'],
};
var SHEET_NAMES = { members: '団員', dispatches: '出動記録', events: 'イベント', rsvps: '出欠' };
var SETTINGS = '設定';

/** 最初に1回だけ実行する：シートを作る */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (key) {
    var sh = ss.getSheetByName(SHEET_NAMES[key]) || ss.insertSheet(SHEET_NAMES[key]);
    sh.getRange(1, 1, 1, SHEETS[key].length).setValues([SHEETS[key]]).setFontWeight('bold');
    sh.getRange('A:Z').setNumberFormat('@'); // 日付などが勝手に変換されないよう文字列で保存
    sh.setFrozenRows(1);
  });
  var st = ss.getSheetByName(SETTINGS) || ss.insertSheet(SETTINGS, 0);
  st.getRange('A:B').setNumberFormat('@');
  if (!st.getRange('B1').getValue()) {
    st.getRange('A1:B3').setValues([
      ['参加コード', String(Math.floor(100000 + Math.random() * 900000))],
      ['団の名前', '消防団'],
      ['', '※参加コードは管理者がアプリの「団員」タブからも変更できます'],
    ]);
  }
  var s1 = ss.getSheetByName('シート1'); if (s1 && ss.getSheets().length > 1 && s1.getLastRow() === 0) ss.deleteSheet(s1);
  clearCache();
  Logger.log('準備完了。参加コード: ' + st.getRange('B1').getValue());
}

function doGet(e) {
  var t = HtmlService.createTemplateFromFile('index');
  var p = (e && e.parameter) || {};
  t.focusEvent = p.event || '';
  // 登録はURLの k=… に持たせる（iPhoneなどではアプリを閉じると端末内の保存が消えることがあるため）
  t.token = p.k || '';
  // 最初の画面に必要なデータを一緒に埋め込み、開いてすぐ表示できるようにする
  var first = t.token ? sync_(t.token) : null;
  t.initial = first && first.me ? JSON.stringify(first) : '';
  t.appUrl = ScriptApp.getService().getUrl();
  t.teamName = setting_(2) || '消防団';
  return t.evaluate()
    .setTitle(t.teamName + ' 連絡アプリ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---------- データ操作の共通部品 ----------
function sheet_(key) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES[key]); }
function setting_(row) { var st = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTINGS); return st ? String(st.getRange(row, 2).getValue()).trim() : ''; }
function rows_(key) {
  var sh = sheet_(key), cols = SHEETS[key], n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, cols.length).getValues().map(function (r, i) {
    var o = { _row: i + 2 };
    cols.forEach(function (c, j) { o[c] = r[j] === '' ? '' : String(r[j]); });
    return o;
  });
}
function append_(key, obj) {
  var sh = sheet_(key), cols = SHEETS[key];
  if (sh.getLastColumn() < cols.length) { // 列が増えた後の初回だけ見出しを補う
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.getRange('A:Z').setNumberFormat('@');
  }
  sh.appendRow(SHEETS[key].map(function (c) { return obj[c] == null ? '' : String(obj[c]); }));
}
function update_(key, row, obj) {
  var cols = SHEETS[key];
  sheet_(key).getRange(row, 1, 1, cols.length).setValues([cols.map(function (c) { return obj[c] == null ? '' : String(obj[c]); })]);
}
function deleteWhere_(key, pred) {
  var sh = sheet_(key), list = rows_(key);
  for (var i = list.length - 1; i >= 0; i--) if (pred(list[i])) sh.deleteRow(list[i]._row);
}
function newId_() { return Utilities.getUuid().slice(0, 8); }
function now_() { return new Date().toISOString(); }
function pubMember_(m) { return { id: m.id, name: m.name, is_admin: m.is_admin === 'true' }; }
function fail_(msg) { throw new Error(msg); }
// 1人の団員が複数の端末（スマホのブラウザとLINE内ブラウザなど）で使えるよう、token 列はカンマ区切りで複数持てる
function hasToken_(m, token) { return !!token && String(m.token || '').split(',').indexOf(token) >= 0; }
function findByToken_(list, token) { return token ? list.filter(function (m) { return hasToken_(m, token); })[0] : null; }
function normName_(s) { return String(s || '').normalize('NFKC').replace(/\s+/g, ''); }
var MAX_DEVICES = 5;

// ---------- 画面から呼ばれる入口 ----------
// 画面は action='sync' で全データを1回で受け取り、変更系の操作も最新の全データを返す。
// 読み取りはキャッシュ（CacheService）から返すので、スプレッドシートを毎回読まない。
var CACHE_KEY = 'snapshot_v2';

function api(action, body, token) {
  body = body || {};
  if (action === 'sync') return sync_(token);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var result;
  try {
    result = mutate_(action, body, token);
    CacheService.getScriptCache().remove(CACHE_KEY);
  } finally { lock.releaseLock(); }
  var out = sync_(result && result.token || token);
  out.result = result;
  return out;
}

/** スプレッドシート全体を読み込む（キャッシュがあればそれを使う） */
function load_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CACHE_KEY);
  if (hit) return JSON.parse(hit);
  var d = {
    members: rows_('members'), events: rows_('events'), rsvps: rows_('rsvps'), dispatches: rows_('dispatches'),
    join_code: setting_(1), team_name: setting_(2),
  };
  var json = JSON.stringify(d);
  if (json.length < 95000) cache.put(CACHE_KEY, json, 21600); // 最大6時間。書き込みがあれば即消す
  return d;
}

function sync_(token) {
  var d = load_();
  var me = findByToken_(d.members, token);
  if (!me) return { me: null };
  var byEvent = {};
  d.rsvps.forEach(function (r) {
    (byEvent[r.event_id] = byEvent[r.event_id] || []).push({ member_id: r.member_id, status: r.status, comment: r.comment });
  });
  var out = {
    me: pubMember_(me),
    members: d.members.map(pubMember_),
    events: d.events.map(function (e) {
      return { id: e.id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, place: e.place, note: e.note, created_by: e.created_by, rsvps: byEvent[e.id] || [] };
    }),
    dispatches: d.dispatches.map(function (x) {
      return { id: x.id, date: x.date, start_time: x.start_time, end_time: x.end_time, kind: x.kind, place: x.place, note: x.note, created_by: x.created_by,
               dispatch_members: x.member_ids ? x.member_ids.split(',').map(function (m) { return { member_id: m }; }) : [] };
    }),
    team_name: d.team_name,
  };
  if (me.is_admin === 'true') out.join_code = d.join_code;
  return out;
}

/** 変更系の操作（ロック中に実行） */
function mutate_(action, b, token) {
  var members = rows_('members');
  var me = findByToken_(members, token);

  if (action === 'join') {
    var code = setting_(1);
    if (!code || String(b.code || '').trim() !== code) fail_('参加コードが違います。');
    var name = String(b.name || '').trim(); if (!name) fail_('名前を入れてください。');
    var newToken = Utilities.getUuid();
    // 同じ名前の団員がいれば、その人として入り直す（記録・出欠・管理者権限を引き継ぐ）
    var same = members.filter(function (x) { return normName_(x.name) === normName_(name); })[0];
    if (same) {
      var toks = String(same.token || '').split(',').filter(String);
      toks.push(newToken);
      same.token = toks.slice(-MAX_DEVICES).join(',');
      update_('members', same._row, same);
      return { token: newToken, rejoined: true };
    }
    var m = { id: newId_(), name: name, token: newToken, is_admin: members.length === 0 ? 'true' : 'false', created_at: now_() };
    append_('members', m);
    return { token: m.token };
  }

  if (!me) fail_('登録が確認できません。もう一度参加コードを入力してください。');
  var isAdmin = me.is_admin === 'true';
  var canEdit = function (createdBy) { return createdBy === me.id || isAdmin; };
  var adminOnly = function () { if (!isAdmin) fail_('管理者だけができる操作です。'); };

  switch (action) {
    case 'members.rename':
      if (!String(b.name || '').trim()) fail_('名前を入れてください。');
      me.name = String(b.name).trim(); update_('members', me._row, me); return { ok: true };

    case 'members.remove':
      adminOnly(); deleteWhere_('members', function (m) { return m.id === b.id; }); return { ok: true };

    case 'members.setAdmin':
      adminOnly();
      var t = members.filter(function (m) { return m.id === b.id; })[0]; if (!t) fail_('団員が見つかりません。');
      if (!b.is_admin && members.filter(function (m) { return m.is_admin === 'true' && m.id !== t.id; }).length === 0) fail_('管理者が1人もいなくなるため外せません。');
      t.is_admin = b.is_admin ? 'true' : 'false'; update_('members', t._row, t); return { ok: true };

    case 'members.transferAdmin': // 管理者を引き継ぐ：相手を管理者にして、自分は一般団員になる
      adminOnly();
      var to = members.filter(function (m) { return m.id === b.id; })[0];
      if (!to) fail_('団員が見つかりません。');
      if (to.id === me.id) fail_('自分自身には引き継げません。');
      to.is_admin = 'true'; update_('members', to._row, to);
      me.is_admin = 'false'; update_('members', me._row, me);
      return { ok: true, to: to.name };

    case 'members.logoutAll': // 全員をログアウト（自分のこの端末だけ残す）。団員の記録は消えない
      adminOnly();
      var sh = sheet_('members');
      if (members.length) {
        var col = SHEETS.members.indexOf('token') + 1;
        sh.getRange(2, col, members.length, 1).setValues(members.map(function (x) { return [x.id === me.id ? token : '']; }));
      }
      return { ok: true, count: members.length - 1 };

    case 'settings.setJoinCode':
      adminOnly();
      var c = String(b.code || '').trim(); if (c.length < 4) fail_('参加コードは4文字以上にしてください。');
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTINGS).getRange('B1').setValue(c);
      return { ok: true };

    case 'dispatches.add':
      if (!b.date || !b.kind) fail_('日付と種別は必須です。');
      var d = { id: newId_(), date: b.date, start_time: b.start_time, end_time: b.end_time, kind: b.kind, place: b.place, note: b.note,
                member_ids: (b.member_ids || []).join(','), created_by: me.id, created_at: now_() };
      append_('dispatches', d); return { id: d.id };

    case 'dispatches.delete':
      var dd = rows_('dispatches').filter(function (x) { return x.id === b.id; })[0];
      if (!dd) return { ok: true };
      if (!canEdit(dd.created_by)) fail_('記録した本人か管理者だけが削除できます。');
      sheet_('dispatches').deleteRow(dd._row); return { ok: true };

    case 'events.add':
      if (!b.title || !b.starts_at) fail_('タイトルと日時は必須です。');
      var ev = { id: newId_(), title: b.title, starts_at: b.starts_at, ends_at: b.ends_at, place: b.place, note: b.note, created_by: me.id, created_at: now_() };
      append_('events', ev); return { id: ev.id };

    case 'events.delete':
      var ee = rows_('events').filter(function (x) { return x.id === b.id; })[0];
      if (!ee) return { ok: true };
      if (!canEdit(ee.created_by)) fail_('作成した本人か管理者だけが削除できます。');
      deleteWhere_('rsvps', function (r) { return r.event_id === b.id; });
      sheet_('events').deleteRow(ee._row); return { ok: true };

    case 'events.rsvp':
      if (['yes', 'no', 'maybe'].indexOf(b.status) < 0) fail_('回答が不正です。');
      var cur = rows_('rsvps').filter(function (r) { return r.event_id === b.event_id && r.member_id === me.id; })[0];
      var rec = { event_id: b.event_id, member_id: me.id, status: b.status, comment: b.comment || '', updated_at: now_() };
      if (cur) update_('rsvps', cur._row, rec); else append_('rsvps', rec);
      return { ok: true };
  }
  fail_('不明な操作です: ' + action);
}

/** スプレッドシートを手で書き換えたら自動でキャッシュを消す */
function onEdit() { clearCache(); }

/** スプレッドシートを手で直接書き換えたあとは、これを実行するとすぐ画面に反映される（放っておいても6時間で反映） */
function clearCache() { CacheService.getScriptCache().remove(CACHE_KEY); }
