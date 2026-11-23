"use strict";
const CFG = window.APP_CONFIG || {};
const DEMO = CFG.MODE !== "gas";
const KINDS = ["火災", "救助", "水害・災害", "警戒", "捜索", "訓練", "その他"];
const TOKEN_KEY = "shobodan_token", CACHE_KEY = "shobodan_cache_v2";
// 登録（token）は「ページのURL（?k=…）」と「端末内の保存」の両方に持つ。
// iPhone などではアプリを閉じると端末内の保存が消えることがあるので、URL側が本命。
let token = CFG.TOKEN || safeGet(TOKEN_KEY) || "";
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function setToken(t) {
  token = t || "";
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {}
  // 画面上部のURLを書き換える（ホーム画面に追加・ブックマークするとこのURLが保存される）
  if (!DEMO && window.google?.script?.history) google.script.history.replace(null, t ? { k: t } : {}, "");
}
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const state = { data: null, tab: "events", year: new Date().getFullYear(), past: false, focusEvent: null, pending: 0 };

// ---------- 通信 ----------
// サーバーは常に「全データ」を返す。画面はそれを state.data に持ち、タブ切替などでは通信しない。
function call(action, body = {}) {
  if (DEMO) return new Promise((ok, ng) => setTimeout(() => { try { ok(mock(action, body)); } catch (e) { ng(e); } }, 150));
  return new Promise((ok, ng) => {
    google.script.run
      .withSuccessHandler(ok)
      .withFailureHandler((e) => ng(new Error(String(e && e.message || e).replace(/^Error:\s*/, ""))))
      .api(action, body, token);
  });
}
function busy(d) { state.pending += d; $("#sync").hidden = state.pending <= 0; }
function setData(d) {
  if (!d || !d.me) return;
  state.data = d;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch {}
  render();
}
async function sync() {
  busy(1);
  try {
    const d = await call("sync");
    if (!d.me) { // 登録が消された・無効になった
      setToken(""); try { localStorage.removeItem(CACHE_KEY); } catch {} state.data = null; $("#nav").hidden = true; return showJoin();
    }
    setData(d);
  } catch (e) { toast("更新できませんでした：" + e.message); }
  finally { busy(-1); }
}
/** 画面を先に書き換え（optimistic）、裏でサーバーに送る。失敗したら最新データに戻す */
async function mutate(action, body, optimistic) {
  if (optimistic && state.data) {
    const draft = JSON.parse(JSON.stringify(state.data));
    optimistic(draft); state.data = draft; render();
  }
  busy(1);
  try { const d = await call(action, body); setData(d); return d.result; }
  catch (e) { toast(e.message); sync(); throw e; }
  finally { busy(-1); }
}

// ---------- お試しモード用の偽サーバー（localStorage） ----------
function mock(action, b) {
  const db = JSON.parse(localStorage.demoDB || "null") || seed();
  const meId = "demo-me";
  let me = db.members.find((m) => m.id === meId) || null;
  let result = { ok: true };
  const ev = (id) => db.events.find((e) => e.id === id);
  if (action === "notices.image") return { data: (db.imgs || {})[b.file_id] };
  if (action !== "sync") {
    if (action === "join") {
      if (b.code !== db.code) throw new Error("参加コードが違います（お試しモードは " + db.code + "）");
      if (!me) { me = { id: meId, name: b.name || "あなた", is_admin: true }; db.members.push(me); }
      result = { token: "demo" };
    } else switch (action) {
      case "members.rename": me.name = b.name; break;
      case "members.setAdmin": db.members.find((m) => m.id === b.id).is_admin = !!b.is_admin; break;
      case "settings.setJoinCode": if (String(b.code).length < 4) throw new Error("参加コードは4文字以上にしてください。"); db.code = b.code; break;
      case "members.setRole": db.members.forEach((m) => { if (m.role === b.role) m.role = ""; if (m.id === b.id) m.role = b.role; }); break;
      case "members.transferAdmin": db.members.find((m) => m.id === b.id).is_admin = true; me.is_admin = false; break;
      case "notices.add": result = { id: String(++db.seq) }; db.notices = db.notices || [];
        db.imgs = db.imgs || {};
        db.notices.push({ id: result.id, title: b.title, body: b.body, created_by: meId, created_at: new Date().toISOString(),
          image_ids: (b.images || []).map((im, i) => { const fid = "f" + result.id + "_" + i; db.imgs[fid] = im.data; return fid; }) }); break;
      case "notices.delete": db.notices = db.notices.filter((n) => n.id !== b.id); break;
      case "members.logoutAll": result = { ok: true, count: db.members.length - 1 }; break;
      case "members.remove": db.members = db.members.filter((m) => m.id !== b.id); break;
      case "dispatches.add": result = { id: String(++db.seq) };
        db.dispatches.push({ id: result.id, date: b.date, start_time: b.start_time, end_time: b.end_time, kind: b.kind, place: b.place, note: b.note, created_by: meId, dispatch_members: (b.member_ids || []).map((x) => ({ member_id: x })) }); break;
      case "dispatches.delete": db.dispatches = db.dispatches.filter((d) => d.id !== b.id); break;
      case "events.add": result = { id: String(++db.seq) };
        db.events.push({ id: result.id, title: b.title, starts_at: b.starts_at, ends_at: b.ends_at, place: b.place, note: b.note, created_by: meId, rsvps: [] }); break;
      case "events.delete": db.events = db.events.filter((e) => e.id !== b.id); break;
      case "events.rsvp": { const e = ev(b.event_id);
        e.rsvps = e.rsvps.filter((r) => r.member_id !== meId).concat({ member_id: meId, status: b.status, comment: b.comment }); break; }
      default: throw new Error("unknown " + action);
    }
    localStorage.demoDB = JSON.stringify(db);
  }
  if (!me) return { me: null };
  return JSON.parse(JSON.stringify({ me, members: db.members, events: db.events, dispatches: db.dispatches, notices: db.notices || [], join_code: db.code, result }));
}
function seed() {
  const names = ["佐藤", "鈴木", "高橋", "田中", "伊藤", "渡辺", "山本"];
  const members = names.map((n, i) => ({ id: "m" + i, name: n, is_admin: i === 0, role: ["部長", "副部長", "会計"][i] || "" }));
  const d = (off) => new Date(Date.now() + off * 864e5);
  const ymd = (x) => x.toISOString().slice(0, 10);
  const at = (off, h) => { const x = d(off); x.setHours(h, 0, 0, 0); return x.toISOString(); };
  return {
    seq: 100, code: "1234", members,
    dispatches: [
      { id: "1", date: ymd(d(-3)), start_time: "02:15", end_time: "05:40", kind: "火災", place: "○○町2丁目 倉庫", note: "建物火災。放水、残火処理。", created_by: "m0", dispatch_members: ["m0", "m2", "m3", "m5"].map((x) => ({ member_id: x })) },
      { id: "2", date: ymd(d(-20)), start_time: "14:00", end_time: "16:10", kind: "捜索", place: "△△山 登山口", note: "行方不明者捜索。2時間で発見。", created_by: "m1", dispatch_members: ["m1", "m2", "m4"].map((x) => ({ member_id: x })) },
    ],
    events: [
      { id: "10", title: "年末夜警", starts_at: at(14, 19), ends_at: at(14, 22), place: "第1分団詰所", note: "防寒着持参", created_by: "m0", rsvps: [{ member_id: "m0", status: "yes" }, { member_id: "m2", status: "yes" }, { member_id: "m4", status: "no", comment: "仕事のため" }, { member_id: "m5", status: "maybe" }] },
      { id: "11", title: "ポンプ操法 訓練", starts_at: at(5, 8), ends_at: at(5, 12), place: "小学校グラウンド", note: "", created_by: "m1", rsvps: [{ member_id: "m1", status: "yes" }] },
    ],
  };
}

// ---------- 共通 ----------
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2500); }
const fmtDate = (iso) => new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
const hm = (iso) => new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
/** イベントの日時表示：12/7(月) 19:00〜22:00（日をまたぐと「翌」） */
function fmtRange(s, e) {
  if (!e) return fmtDate(s);
  const sd = new Date(s), ed = new Date(e);
  const days = Math.round((new Date(ed.toDateString()) - new Date(sd.toDateString())) / 864e5);
  return fmtDate(s) + "〜" + (days === 0 ? "" : days === 1 ? "翌" : fmtDate(e).replace(/\s.*$/, " ")) + hm(e);
}
/** 出動の時間表示：19:05〜21:30 */
function fmtTimes(d) {
  if (!d.start_time && !d.end_time) return "";
  const next = d.start_time && d.end_time && d.end_time < d.start_time ? "翌" : "";
  return `${d.start_time || "?"}〜${next}${d.end_time || ""}`;
}
const me = () => state.data.me;
const nameOf = (id) => state.data.members.find((m) => m.id === id)?.name ?? "（退団）";
const ROLES = ["部長", "副部長", "会計"];
const roleTag = (m) => (m && m.role ? ` <span class="role">${esc(m.role)}</span>` : "");
/** 名前＋役職（HTML） */
const label = (idOrMember) => { const m = typeof idOrMember === "string" ? state.data.members.find((x) => x.id === idOrMember) : idOrMember; return m ? esc(m.name) + roleTag(m) : "（退団）"; };
const roleOrder = (m) => { const i = ROLES.indexOf(m.role); return i < 0 ? 99 : i; };
const canEdit = (createdBy) => createdBy === me().id || me().is_admin;
const tmpId = () => "tmp" + Date.now();
const ignore = () => {}; // 失敗時の表示は mutate が行う

// ---------- 起動 ----------
function boot() {
  $("#team").textContent = "🚒 " + (CFG.TEAM_NAME || "消防団");
  $("header").insertAdjacentHTML("beforeend", '<span id="sync" hidden>更新中…</span>');
  if (DEMO) $("#demo").hidden = false;
  const focus = CFG.FOCUS_EVENT || new URLSearchParams(location.search).get("event");
  if (focus) { state.focusEvent = String(focus); state.tab = "events"; }
  document.querySelectorAll("#nav button").forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; state.focusEvent = null; render(); window.scrollTo(0, 0); }));
  if (!token) return showJoin();
  if (!CFG.TOKEN) setToken(token); // 端末内にだけ残っていた登録をURLにも反映
  else try { localStorage.setItem(TOKEN_KEY, token); } catch {}
  // サーバーが埋め込んだデータ、なければ前回のデータですぐ表示して、裏で最新に更新
  let first = null;
  try { first = CFG.INITIAL ? JSON.parse(CFG.INITIAL) : JSON.parse(safeGet(CACHE_KEY) || "null"); } catch {}
  if (first && first.me) { CFG.INITIAL ? setData(first) : ((state.data = first), render()); }
  if (!CFG.INITIAL) sync();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && state.data) sync(); });
}
function showJoin() {
  $("#app").innerHTML = `<div class="card"><h2>団員登録</h2>
    <p class="muted">はじめて使うときだけ、団から聞いた参加コードを入力してください。${DEMO ? "（お試しモードは 1234）" : ""}<br>登録はこの端末（このブラウザ）に記憶されます。<br><b>前に登録したことがある人は、前と同じ名前</b>で入ると、これまでの記録がそのまま使えます。</p>
    <label>名前（団内で呼ばれている名前）</label><input id="jn">
    <label>参加コード</label><input id="jc" inputmode="numeric">
    <p><button class="btn" id="jb">登録する</button></p></div>`;
  $("#jb").onclick = async () => {
    $("#jb").disabled = true; $("#jb").textContent = "登録中…";
    try {
      const d = await call("join", { name: $("#jn").value, code: $("#jc").value });
      setToken(d.result.token);
      setData(d);
      if (!DEMO) showSaveTip(d.result.rejoined ? true : undefined);
    } catch (e) { toast(e.message); $("#jb").disabled = false; $("#jb").textContent = "登録する"; }
  };
}
function showSaveTip(rejoined) {
  const box = document.createElement("div");
  box.className = "card"; box.id = "savetip"; box.style.border = "2px solid #06c755";
  box.innerHTML = `<h3>${rejoined === true ? "おかえりなさい。前の登録を引き継ぎました" : rejoined === false ? "この端末を保存する" : "登録できました"}</h3>
    <p>次から参加コードを入れなくて済むように、<b>今のこの画面を</b>保存してください。</p>
    <p class="muted">・iPhone（Safari）：下の共有ボタン □↑ →「ホーム画面に追加」<br>
    ・Android（Chrome）：右上の ︙ →「ホーム画面に追加」<br>
    ・LINEの中で開いている場合：右下の … →「ブラウザで開く」してから上の方法で</p>
    <p class="muted">このリンクはあなた専用です。グループには送らないでください。</p>
    <button class="btn small" id="tipok">わかった</button>`;
  document.getElementById("savetip")?.remove(); $("#app").before(box); window.scrollTo(0, 0);
  $("#tipok").onclick = () => box.remove();
}
function render() {
  if (!state.data) return;
  $("#nav").hidden = false;
  $("#who").textContent = me().name + (me().is_admin ? "（管理者）" : "");
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
  // 入力途中の内容は書き換えで消えないよう退避して戻す
  const keep = {}; document.querySelectorAll("#app input, #app textarea, #app select").forEach((i) => { if (i.id) keep[i.id] = i.type === "checkbox" ? i.checked : i.value; });
  const open = [...document.querySelectorAll("#app details[open]")].map((d) => d.id);
  const focused = document.activeElement && document.activeElement.id;
  ({ notices: renderNotices, events: renderEvents, dispatches: renderDispatches, members: renderMembers })[state.tab]();
  Object.entries(keep).forEach(([id, v]) => { const i = document.getElementById(id); if (i && i.dataset.keep !== "no") { if (i.type === "checkbox") i.checked = v; else i.value = v; } });
  open.forEach((id) => { const d = id && document.getElementById(id); if (d) d.open = true; });
  if (focused) document.getElementById(focused)?.focus();
}

// ---------- イベント ----------
function renderEvents() {
  const now = Date.now(), day = 864e5;
  const events = state.data.events
    .filter((e) => { const t = new Date(e.ends_at || e.starts_at).getTime(); return state.past ? t < now && t >= now - 365 * day : t >= now - day; })
    .sort((a, b) => state.past ? b.starts_at.localeCompare(a.starts_at) : a.starts_at.localeCompare(b.starts_at));
  const myAns = (e) => e.rsvps.find((r) => r.member_id === me().id);
  const html = events.map((e) => {
    const by = { yes: [], maybe: [], no: [] };
    e.rsvps.forEach((r) => by[r.status]?.push(r));
    const answered = new Set(e.rsvps.map((r) => r.member_id));
    const none = state.data.members.filter((m) => !answered.has(m.id));
    const mine = myAns(e);
    const tags = (list, cls) => list.map((r) => `<span class="tag ${cls}">${label(r.member_id)}${r.comment ? "：" + esc(r.comment) : ""}</span>`).join("");
    const tmp = e.id.startsWith("tmp");
    return `<div class="card" id="ev${e.id}" ${state.focusEvent === e.id ? 'style="outline:3px solid #c62828"' : ""}>
      <div class="spread"><h3>${esc(e.title)}</h3>${canEdit(e.created_by) && !tmp ? `<button class="btn sub small" data-del-ev="${e.id}">削除</button>` : ""}</div>
      <div class="muted">🕒 ${fmtRange(e.starts_at, e.ends_at)}${e.place ? "　📍" + esc(e.place) : ""}</div>
      ${e.note ? `<div style="margin-top:6px;white-space:pre-wrap">${esc(e.note)}</div>` : ""}
      ${tmp ? '<p class="muted">保存中…</p>' : `
      <div class="rsvp" data-ev="${e.id}">
        ${[["yes", "参加"], ["maybe", "未定"], ["no", "不参加"]].map(([s, l]) => `<button class="${s} ${mine?.status === s ? "on" : ""}" data-s="${s}">${l}</button>`).join("")}
      </div>
      <input id="cm${e.id}" placeholder="ひとこと（任意：遅れます 等）" data-cm="${e.id}" value="${esc(mine?.comment)}">`}
      <div style="margin-top:8px;font-size:13px">
        <div>参加 <b>${by.yes.length}</b>　未定 <b>${by.maybe.length}</b>　不参加 <b>${by.no.length}</b>　未回答 <b>${none.length}</b></div>
        <div>${tags(by.yes, "yes")}${tags(by.maybe, "maybe")}${tags(by.no, "no")}${none.map((m) => `<span class="tag none">${label(m)}</span>`).join("")}</div>
      </div>
      ${tmp ? "" : `<p class="row"><button class="btn line small" data-share="${e.id}">LINEで出欠を呼びかける</button></p>`}
    </div>`;
  }).join("");
  $("#app").innerHTML = `
    <details class="card" id="newev"><summary>＋ イベントを作る</summary>
      <label>タイトル</label><input id="et" placeholder="例：年末夜警">
      <label>日付</label><input type="date" id="ed">
      <div class="row"><div style="flex:1"><label>開始</label><input type="time" id="es"></div><div style="flex:1"><label>終了</label><input type="time" id="ee"></div></div>
      <label>場所</label><input id="ep">
      <label>メモ</label><textarea id="en" placeholder="持ち物・集合など"></textarea>
      <p><button class="btn" id="eb">作成する</button></p></details>
    <div class="spread"><h2>${state.past ? "過去のイベント" : "これからのイベント"}</h2>
      <button class="btn sub small" id="tp">${state.past ? "これからを見る" : "過去を見る"}</button></div>
    ${html || '<p class="muted">イベントはまだありません。</p>'}`;
  $("#tp").onclick = () => { state.past = !state.past; render(); };
  $("#eb").onclick = async () => {
    if (!$("#et").value || !$("#ed").value || !$("#es").value) return toast("タイトル・日付・開始時間を入れてください");
    const start = new Date($("#ed").value + "T" + $("#es").value);
    let end = null;
    if ($("#ee").value) { end = new Date($("#ed").value + "T" + $("#ee").value); if (end <= start) end.setDate(end.getDate() + 1); } // 終了が開始より前なら翌日
    const body = { title: $("#et").value, starts_at: start.toISOString(), ends_at: end ? end.toISOString() : "", place: $("#ep").value, note: $("#en").value };
    ["et", "ed", "es", "ee", "ep", "en"].forEach((id) => ($("#" + id).value = "")); $("#newev").open = false;
    state.past = false;
    const p = mutate("events.add", body, (d) => d.events.push({ id: tmpId(), ...body, created_by: d.me.id, rsvps: [] }));
    p.catch(ignore);
    if (confirm("作成しました。LINEのグループに出欠の呼びかけを送りますか？")) { const r = await p; share(r.id); }
  };
  const answer = (id, patch) => {
    const e = state.data.events.find((x) => x.id === id); const mine = myAns(e) || {};
    const body = { event_id: id, status: patch.status ?? mine.status, comment: patch.comment ?? mine.comment ?? "" };
    if (!body.status) return toast("先に 参加／未定／不参加 を選んでください");
    mutate("events.rsvp", body, (d) => {
      const ev = d.events.find((x) => x.id === id);
      ev.rsvps = ev.rsvps.filter((r) => r.member_id !== d.me.id).concat({ member_id: d.me.id, status: body.status, comment: body.comment });
    }).catch(ignore);
  };
  document.querySelectorAll(".rsvp button").forEach((b) => (b.onclick = () => {
    const id = b.parentElement.dataset.ev;
    answer(id, { status: b.dataset.s, comment: document.getElementById("cm" + id).value });
  }));
  document.querySelectorAll("[data-cm]").forEach((i) => (i.onchange = () => answer(i.dataset.cm, { comment: i.value })));
  document.querySelectorAll("[data-del-ev]").forEach((b) => (b.onclick = () => {
    if (!confirm("このイベントを削除しますか？")) return;
    const id = b.dataset.delEv;
    mutate("events.delete", { id }, (d) => (d.events = d.events.filter((x) => x.id !== id))).catch(ignore);
  }));
  document.querySelectorAll("[data-share]").forEach((b) => (b.onclick = () => share(b.dataset.share)));
  if (state.focusEvent) { document.getElementById("ev" + state.focusEvent)?.scrollIntoView({ block: "center" }); }
}

async function share(eventId) {
  const e = state.data.events.find((x) => x.id === eventId);
  if (!e) return;
  const url = (DEMO ? location.href.split("?")[0] : CFG.APP_URL) + "?event=" + e.id;
  const text = `【出欠確認】${e.title}\n🕒 ${fmtRange(e.starts_at, e.ends_at)}${e.place ? "\n📍 " + e.place : ""}\n\n参加・不参加はこちらから回答してください👇\n${url}`;
  if (/iPhone|iPad|Android/i.test(navigator.userAgent)) {
    window.open("https://line.me/R/share?text=" + encodeURIComponent(text), "_blank");
  } else {
    try { await navigator.clipboard.writeText(text); toast("呼びかけ文をコピーしました。LINEのグループに貼り付けてください"); }
    catch { prompt("この文面をコピーしてLINEに貼り付けてください", text); }
  }
}

// ---------- 出動記録 ----------
function renderDispatches() {
  const list = state.data.dispatches.filter((d) => d.date.startsWith(String(state.year))).sort((a, b) => (b.date + (b.start_time || "")).localeCompare(a.date + (a.start_time || "")));
  const count = {}; const kinds = {};
  list.forEach((d) => { kinds[d.kind] = (kinds[d.kind] || 0) + 1; d.dispatch_members.forEach((x) => (count[x.member_id] = (count[x.member_id] || 0) + 1)); });
  const thisYear = new Date().getFullYear();
  const years = [thisYear, thisYear - 1, thisYear - 2];
  $("#app").innerHTML = `
    <details class="card" id="newd"><summary>＋ 出動を記録する</summary>
      <label>日付</label><input type="date" id="dd" value="${new Date().toLocaleDateString("sv-SE")}">
      <div class="row"><div style="flex:1"><label>出動（開始）</label><input type="time" id="dts"></div><div style="flex:1"><label>引き揚げ（終了）</label><input type="time" id="dte"></div></div>
      <label>種別</label><select id="dk">${KINDS.map((k) => `<option>${k}</option>`).join("")}</select>
      <label>場所</label><input id="dp" placeholder="例：○○町2丁目">
      <label>出動した団員</label>
      <div class="checks">${state.data.members.map((m) => `<label><input type="checkbox" id="dm_${m.id}" value="${m.id}" ${m.id === me().id ? "checked" : ""}>${label(m)}</label>`).join("")}</div>
      <label>内容・メモ</label><textarea id="dn" placeholder="活動内容、使用資機材など"></textarea>
      <p><button class="btn" id="db">記録する</button></p></details>
    <div class="spread"><h2>出動記録</h2><select id="yr" data-keep="no" style="width:auto">${years.map((y) => `<option ${y === state.year ? "selected" : ""}>${y}</option>`).join("")}</select></div>
    <div class="card"><h3>${state.year}年の集計　計 ${list.length} 件</h3>
      <div>${Object.entries(kinds).map(([k, n]) => `<span class="tag">${esc(k)} ${n}</span>`).join("") || '<span class="muted">なし</span>'}</div>
      <details id="dstat" style="margin-top:8px"><summary>団員ごとの出動回数</summary><table>
        ${state.data.members.map((m) => ({ m, n: count[m.id] || 0 })).sort((a, b) => b.n - a.n).map(({ m, n }) => `<tr><td>${label(m)}</td><td class="n">${n} 回</td></tr>`).join("")}
      </table></details></div>
    ${list.map((d) => `<div class="card">
      <div class="spread"><div><span class="kind">${esc(d.kind)}</span>　${esc(d.date)}${fmtTimes(d) ? "　" + esc(fmtTimes(d)) : ""}</div>${canEdit(d.created_by) && !d.id.startsWith("tmp") ? `<button class="btn sub small" data-del-d="${d.id}">削除</button>` : ""}</div>
      ${d.place ? `<div class="muted">📍 ${esc(d.place)}</div>` : ""}
      ${d.note ? `<div style="margin-top:6px;white-space:pre-wrap">${esc(d.note)}</div>` : ""}
      <div style="margin-top:6px">${d.dispatch_members.map((x) => `<span class="tag">${label(x.member_id)}</span>`).join("")}</div>
      <div class="muted" style="margin-top:4px">${d.id.startsWith("tmp") ? "保存中…" : "記録：" + esc(nameOf(d.created_by))}</div></div>`).join("") || '<p class="muted">記録はまだありません。</p>'}`;
  $("#yr").onchange = (e) => { state.year = Number(e.target.value); render(); };
  $("#db").onclick = () => {
    const member_ids = [...document.querySelectorAll(".checks input:checked")].map((i) => i.value);
    const body = { date: $("#dd").value, start_time: $("#dts").value, end_time: $("#dte").value, kind: $("#dk").value, place: $("#dp").value, note: $("#dn").value, member_ids };
    if (!body.date) return toast("日付を入れてください");
    $("#dp").value = $("#dn").value = $("#dts").value = $("#dte").value = ""; $("#newd").open = false;
    state.year = Number(body.date.slice(0, 4));
    mutate("dispatches.add", body, (d) => d.dispatches.push({ id: tmpId(), ...body, created_by: d.me.id, dispatch_members: member_ids.map((x) => ({ member_id: x })) })).catch(ignore);
    toast("記録しました");
  };
  document.querySelectorAll("[data-del-d]").forEach((b) => (b.onclick = () => {
    if (!confirm("この記録を削除しますか？")) return;
    const id = b.dataset.delD;
    mutate("dispatches.delete", { id }, (d) => (d.dispatches = d.dispatches.filter((x) => x.id !== id))).catch(ignore);
  }));
}

// ---------- お知らせ ----------
const imgCache = {}; // file_id -> dataURL（この画面を開いている間だけ）
/** 写真を縮小してJPEGにする（通信量とドライブ容量を抑える） */
function shrinkImage(file, max = 1600, quality = 0.8) {
  return new Promise((ok, ng) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      ok(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); ng(new Error("写真を読み込めませんでした")); };
    img.src = url;
  });
}
function loadImages() {
  document.querySelectorAll("img[data-fid]").forEach(async (el) => {
    const fid = el.dataset.fid;
    if (imgCache[fid]) { el.src = imgCache[fid]; return; }
    if (el.dataset.loading) return; el.dataset.loading = "1";
    try {
      const r = await call("notices.image", { notice_id: el.dataset.nid, file_id: fid });
      imgCache[fid] = r.data;
      document.querySelectorAll(`img[data-fid="${fid}"]`).forEach((x) => (x.src = r.data));
    } catch (e) { el.alt = "読み込めませんでした"; }
  });
}
function showImage(src) {
  const ov = document.createElement("div"); ov.className = "overlay";
  ov.innerHTML = `<img src="${src}"><p>タップで閉じる</p>`; ov.onclick = () => ov.remove(); document.body.append(ov);
}
let pendingImages = []; // 投稿前に選んだ写真（dataURL）
function renderNotices() {
  const list = (state.data.notices || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  const fmt = (iso) => new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  $("#app").innerHTML = `
    <details class="card" id="newn"><summary>＋ お知らせを書く</summary>
      <label>タイトル</label><input id="nt" placeholder="例：12月 部長会のお知らせ">
      <label>本文</label><textarea id="nb" placeholder="内容（任意）"></textarea>
      <label>資料の写真（${6}枚まで）</label>
      <input type="file" id="nf" accept="image/*" multiple data-keep="no">
      <div class="thumbs" id="npv">${pendingImages.map((d, i) => `<span class="thumb"><img src="${d}"><button data-rmimg="${i}">×</button></span>`).join("")}</div>
      <p><button class="btn" id="nbtn">投稿する</button></p></details>
    <h2>お知らせ</h2>
    ${list.map((n) => {
      const tmp = n.id.startsWith("tmp");
      const canFix = canEdit(n.created_by) && !tmp;
      return `<div class="card">
      <div class="spread"><h3>${esc(n.title)}</h3>${canFix ? `<button class="btn sub small" data-del-n="${n.id}">削除</button>` : ""}</div>
      <div class="muted">${fmt(n.created_at)}　${label(n.created_by)}</div>
      ${n.body ? `<div style="margin-top:6px;white-space:pre-wrap">${esc(n.body)}</div>` : ""}
      ${n.image_ids.length ? `<div class="thumbs">${n.image_ids.map((fid) => tmp ? `<span class="thumb"><img src="${esc(fid)}"></span>` : `<span class="thumb"><img data-nid="${n.id}" data-fid="${esc(fid)}" alt="読み込み中…"></span>`).join("")}</div>` : ""}
      ${tmp ? '<p class="muted">送信中…（写真があると少し時間がかかります）</p>' : ""}
    </div>`; }).join("") || '<p class="muted">お知らせはまだありません。</p>'}`;
  $("#nf").onchange = async (e) => {
    const files = [...e.target.files];
    if (pendingImages.length + files.length > 6) toast("写真は6枚までです");
    for (const f of files.slice(0, 6 - pendingImages.length)) {
      try { pendingImages.push(await shrinkImage(f)); } catch (err) { toast(err.message); }
    }
    render();
  };
  document.querySelectorAll("[data-rmimg]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); pendingImages.splice(Number(b.dataset.rmimg), 1); render(); }));
  $("#nbtn").onclick = () => {
    const title = $("#nt").value.trim(); if (!title) return toast("タイトルを入れてください");
    const body = { title, body: $("#nb").value, images: pendingImages.map((d) => ({ data: d })) };
    const previews = pendingImages.slice();
    pendingImages = []; $("#nt").value = $("#nb").value = ""; $("#newn").open = false;
    mutate("notices.add", body, (d) => { d.notices = d.notices || []; d.notices.push({ id: tmpId(), title, body: body.body, image_ids: previews, created_by: d.me.id, created_at: new Date().toISOString() }); })
      .then(() => toast("投稿しました")).catch(ignore);
  };
  document.querySelectorAll("[data-del-n]").forEach((b) => (b.onclick = () => {
    if (!confirm("このお知らせを削除しますか？（写真も削除されます）")) return;
    const id = b.dataset.delN;
    mutate("notices.delete", { id }, (d) => (d.notices = d.notices.filter((x) => x.id !== id))).catch(ignore);
  }));
  document.querySelectorAll("img[data-fid], .thumb img").forEach((im) => (im.onclick = () => im.src && showImage(im.src)));
  loadImages();
}

// ---------- 団員 ----------
function renderMembers() {
  const ms = state.data.members.slice().sort((a, b) => roleOrder(a) - roleOrder(b));
  $("#app").innerHTML = `
    <div class="card"><h3>自分の表示名</h3><div class="row"><input id="mn" value="${esc(me().name)}" style="flex:1"><button class="btn small" id="mb">変更</button></div></div>
    ${DEMO ? "" : `<div class="card"><h3>毎回コードを聞かれるときは</h3><p class="muted">この画面をホーム画面に追加（ブックマーク）すると、次から入力不要になります。</p><button class="btn sub small" id="savebtn">保存のしかたを見る</button></div>`}
    <h2>団員一覧（${ms.length}人）</h2>
    <div class="card"><table>${ms.map((m) => `<tr><td>${label(m)}${m.is_admin ? ' <span class="tag">管理者</span>' : ""}</td>
      <td class="n">${me().is_admin && m.id !== me().id ? `<button class="btn sub small" data-adm="${m.id}" data-v="${m.is_admin ? "" : "1"}">${m.is_admin ? "管理者を外す" : "管理者にする"}</button> <button class="btn sub small" data-rm="${m.id}">外す</button>` : ""}</td></tr>`).join("")}</table></div>
    <p class="muted">新しい団員には、このアプリのURLと参加コードを伝えてください。知らない名前があれば、管理者が「外す」で削除できます。</p>
    ${me().is_admin ? `<div class="card"><h3>参加コード（管理者だけに表示）</h3>
      <p class="muted">今のコード：<b>${esc(state.data.join_code)}</b><br>URLが団の外に漏れたときは変更してください。登録済みの団員はそのまま使えます。</p>
      <div class="row"><input id="nc" placeholder="新しい参加コード（4文字以上）" style="flex:1"><button class="btn small" id="ncb">変更</button></div></div>
    <div class="card"><h3>役職（管理者だけが変更できます）</h3>
      <p class="muted">各役職は1人だけです。別の人を選ぶと、前の人からは外れます。管理者の権限とは別です。</p>
      ${ROLES.map((r) => { const cur = ms.find((m) => m.role === r); return `<div class="row" style="margin:4px 0"><span style="width:4.5em">${r}</span>
        <select data-role="${r}" data-keep="no" style="flex:1"><option value="">（なし）</option>${ms.map((m) => `<option value="${m.id}" ${cur && cur.id === m.id ? "selected" : ""}>${esc(m.name)}${m.role && m.role !== r ? `（今は${esc(m.role)}）` : ""}</option>`).join("")}</select></div>`; }).join("")}
    </div>
    <div class="card"><h3>管理者を引き継ぐ（管理者だけに表示）</h3>
      <p class="muted">選んだ人が管理者になり、<b>あなたは一般の団員</b>になります。記録はそのまま残ります。<br>
      管理者を増やしたいだけなら、上の一覧の「管理者にする」を使ってください。<br>
      団専用Googleアカウントの引き継ぎは、手順書（SETUP.md）のチェックリストも一緒に行ってください。</p>
      <div class="row"><select id="tsel" style="flex:1"><option value="">次の管理者を選ぶ</option>${ms.filter((m) => m.id !== me().id).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}</select>
      <button class="btn small" id="tbtn">引き継ぐ</button></div></div>
    <div class="card"><h3>全員をログアウト（管理者だけに表示）</h3>
      <p class="muted">あなた以外の全員が、次に開いたときに参加コードの入力からやり直しになります。同じ名前で入り直せば、記録や出欠はそのまま残ります。<br>
      知らない人に入られたかもしれないときは、先に参加コードを変えてから使ってください。</p>
      <button class="btn sub" id="lo">全員をログアウトする</button></div>` : ""}`;
  if (!DEMO) $("#savebtn").onclick = () => showSaveTip(false);
  $("#mb").onclick = () => {
    const name = $("#mn").value.trim(); if (!name) return;
    mutate("members.rename", { name }, (d) => { d.me.name = name; d.members.find((m) => m.id === d.me.id).name = name; }).catch(ignore);
    toast("変更しました");
  };
  if (me().is_admin) $("#ncb").onclick = () => {
    const code = $("#nc").value.trim(); if (code.length < 4) return toast("参加コードは4文字以上にしてください");
    $("#nc").value = "";
    mutate("settings.setJoinCode", { code }, (d) => (d.join_code = code)).catch(ignore);
    toast("参加コードを変更しました");
  };
  document.querySelectorAll("[data-role]").forEach((s) => (s.onchange = () => {
    const role = s.dataset.role, id = s.value;
    mutate("members.setRole", { role, id }, (d) => d.members.forEach((m) => {
      if (m.role === role && m.id !== id) m.role = "";
      if (m.id === id) m.role = role;
      if (m.id === d.me.id) d.me.role = m.role;
    })).then(() => toast(id ? `${nameOf(id)} さんを${role}にしました` : `${role}を空席にしました`)).catch(ignore);
  }));
  if (me().is_admin) $("#tbtn").onclick = () => {
    const id = $("#tsel").value; if (!id) return toast("次の管理者を選んでください");
    if (!confirm(`${nameOf(id)} さんに管理者を引き継ぎます。\nあなたは一般の団員になり、管理者の画面は見えなくなります。よろしいですか？`)) return;
    mutate("members.transferAdmin", { id }, (d) => { d.members.forEach((m) => { if (m.id === id) m.is_admin = true; if (m.id === d.me.id) m.is_admin = false; }); d.me.is_admin = false; })
      .then(() => toast(`${nameOf(id)} さんに引き継ぎました`)).catch(ignore);
  };
  if (me().is_admin) $("#lo").onclick = () => {
    if (!confirm("あなた以外の全員をログアウトします。よろしいですか？")) return;
    mutate("members.logoutAll", {}).then((r) => toast(`${r.count}人をログアウトしました`)).catch(ignore);
  };
  document.querySelectorAll("[data-adm]").forEach((b) => (b.onclick = () => {
    const id = b.dataset.adm, v = !!b.dataset.v;
    mutate("members.setAdmin", { id, is_admin: v }, (d) => (d.members.find((m) => m.id === id).is_admin = v)).catch(ignore);
  }));
  document.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => {
    const id = b.dataset.rm;
    if (!confirm(nameOf(id) + " さんを団員から外しますか？")) return;
    mutate("members.remove", { id }, (d) => (d.members = d.members.filter((m) => m.id !== id))).catch(ignore);
  }));
}

boot();
