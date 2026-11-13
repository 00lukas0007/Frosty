// Frosty-Widget für Scriptable
// Komplett einfügen, nichts ändern. Beim ersten Start in Scriptable
// fragt das Skript nach deinem GitHub-Token (derselbe wie in der App).

const FILE = "frostspur.json";
const TOKEN_KEY = "frostspur-token";
const GIST_KEY = "frostspur-gist";
const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), "frostspur-cache.json");

const C = {
  bg: Color.dynamic(new Color("#ffffff"), new Color("#111e28")),
  fg: Color.dynamic(new Color("#0f1c26"), new Color("#e8f0f5")),
  muted: Color.dynamic(new Color("#566876"), new Color("#93a6b3")),
  line: Color.dynamic(new Color("#a6b8c5"), new Color("#3d5262")),
  ice: Color.dynamic(new Color("#1c93c8"), new Color("#5fc7f2")),
  ember: Color.dynamic(new Color("#e2571a"), new Color("#ff8a4a")),
};

// ---- Streak-Logik, identisch mit der App ----
const MAX=3, MILESTONES=[7,30,100];
const pad=n=>String(n).padStart(2,'0');
const keyOf=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const parseKey=k=>{const p=k.split('-').map(Number);return new Date(p[0],p[1]-1,p[2],12)};
const addDays=(k,n)=>{const d=parseKey(k);d.setDate(d.getDate()+n);return keyOf(d)};

function streakEnding(h,end){
  const D=new Set(h.done),F=new Set(h.frozen);
  let d=end,n=0;
  for(let i=0;i<20000;i++){
    if(D.has(d))n++;else if(!F.has(d))break;
    d=addDays(d,-1);
  }
  return n;
}
function currentStreak(h,today){
  return streakEnding(h,h.done.indexOf(today)>=0?today:addDays(today,-1));
}

/* Resolves every day before today that is still open: freezes missed days where
   the vault covers the whole gap, otherwise lets the streak end. */
function rollover(S,today){
  const y=addDays(today,-1),events=[];
  let changed=false;
  const order=S.habits.map(h=>{
    const all=h.done.concat(h.frozen).filter(k=>k<=y).sort();
    const last=all[all.length-1];
    return {h:h,s:last?streakEnding(h,last):0};
  }).sort((a,b)=>b.s-a.s);
  order.forEach(o=>{
    const h=o.h;
    if(addDays(h.checked,1)>y)return;
    const D=new Set(h.done);
    let d=addDays(h.checked,1);
    while(d<=y){
      if(D.has(d)){d=addDays(d,1);continue;}
      let r=0,e=d;
      while(e<=y&&!D.has(e)){r++;e=addDays(e,1);}
      const prev=addDays(d,-1);
      if(D.has(prev)||h.frozen.indexOf(prev)>=0){
        const before=streakEnding(h,prev);
        if(S.freezes>=r){
          for(let k=0;k<r;k++)h.frozen.push(addDays(d,k));
          S.freezes-=r;
          events.push({k:'use',h:h.name,n:before,r:r});
        }else{
          events.push({k:'lost',h:h.name,n:before});
        }
      }
      d=e;
    }
    h.checked=y;
    changed=true;
  });
  return {changed:changed,events:events};
}

/* One drop attempt when a habit is completed for the day. */
function rollFor(S,h,today,rnd){
  if(S.freezes>=MAX)return null;
  const s=currentStreak(h,today);
  if(MILESTONES.indexOf(s)>=0){S.freezes++;return {k:'milestone',h:h.name,n:s};}
  if(h.chance>0&&s>=h.after){
    if(rnd()*100<h.chance){S.freezes++;return {k:'earn',h:h.name,n:s};}
  }
  return null;
}

// ---- Token ----
async function askToken() {
  const a = new Alert();
  a.title = "GitHub-Token";
  a.message = "Füge denselben Token ein wie in der App. Er beginnt mit ghp_.";
  a.addSecureTextField("ghp_…", "");
  a.addAction("Speichern");
  a.addCancelAction("Abbrechen");
  const i = await a.presentAlert();
  if (i === -1) return false;
  const t = a.textFieldValue(0).trim();
  if (!t) return false;
  Keychain.set(TOKEN_KEY, t);
  if (Keychain.contains(GIST_KEY)) Keychain.remove(GIST_KEY);
  return true;
}

async function menu() {
  if (!Keychain.contains(TOKEN_KEY)) return (await askToken()) ? "preview" : "cancel";
  const a = new Alert();
  a.title = "Frosty";
  a.addAction("Vorschau anzeigen");
  a.addAction("Token ändern");
  a.addCancelAction("Abbrechen");
  const i = await a.presentSheet();
  if (i === -1) return "cancel";
  if (i === 1) return (await askToken()) ? "preview" : "cancel";
  return "preview";
}

// ---- GitHub ----
async function gh(path, token) {
  const r = new Request("https://api.github.com" + path);
  r.headers = {
    "Authorization": "Bearer " + token,
    "Accept": "application/vnd.github+json",
    "User-Agent": "Frosty-Widget",
  };
  const json = await r.loadJSON();
  const code = r.response ? r.response.statusCode : 0;
  if (code === 401) throw new Error("GitHub kennt den Token nicht. Öffne das Skript und füge ihn neu ein.");
  if (code === 404) { const e = new Error("Nicht gefunden."); e.missing = true; throw e; }
  if (code >= 400) throw new Error("GitHub antwortet mit Fehler " + code + ".");
  return json;
}

async function findGist(token) {
  const list = await gh("/gists?per_page=100", token);
  const g = (Array.isArray(list) ? list : []).find(x => x && x.files && x.files[FILE]);
  if (!g) throw new Error("Noch keine Daten. Verbinde zuerst die App mit GitHub.");
  Keychain.set(GIST_KEY, g.id);
  return g.id;
}

async function load(token) {
  let id = Keychain.contains(GIST_KEY) ? Keychain.get(GIST_KEY) : await findGist(token);
  let g;
  try {
    g = await gh("/gists/" + id, token);
  } catch (e) {
    if (!e.missing) throw e;
    id = await findGist(token);
    g = await gh("/gists/" + id, token);
  }
  const f = g.files && g.files[FILE];
  if (!f) throw new Error("Datei fehlt im Speicher.");
  let content = f.content;
  if (f.truncated) content = await new Request(f.raw_url).loadString();
  return JSON.parse(content);
}

// ---- Daten für die Anzeige ----
function prepare(raw) {
  const S = JSON.parse(JSON.stringify(raw));
  const dayStart = Math.max(0, Math.min(6, Math.round(Number(S.dayStart) || 0)));
  const today = keyOf(new Date(Date.now() - dayStart * 3600000));
  S.freezes = Math.max(0, Number(S.freezes) || 0);
  S.habits = (Array.isArray(S.habits) ? S.habits : []).map(h => Object.assign({}, h, {
    done: Array.isArray(h.done) ? h.done : [],
    frozen: Array.isArray(h.frozen) ? h.frozen : [],
    checked: h.checked || addDays(h.created || today, -1),
  }));
  // Vorschau auf das, was die App beim nächsten Öffnen mit verpassten Tagen macht
  rollover(S, today);
  const items = S.habits.map((h, i) => ({
    name: String(h.name || "Habit"),
    done: h.done.indexOf(today) >= 0,
    streak: currentStreak(h, today),
    i: i,
  }));
  // Offene Habits zuerst, sonst Reihenfolge wie in der App
  items.sort((a, b) => (a.done - b.done) || (a.i - b.i));
  return { items, freezes: S.freezes, url: raw.appUrl || null };
}

// ---- Widget ----
function sym(name, size) {
  const s = SFSymbol.named(name);
  s.applyFont(Font.systemFont(size));
  return s.image;
}

function addIcon(stack, name, size, color) {
  const img = stack.addImage(sym(name, size));
  img.imageSize = new Size(size, size);
  img.tintColor = color;
  return img;
}

function header(w, v, label) {
  const s = w.addStack();
  s.layoutHorizontally();
  s.centerAlignContent();
  const t = s.addText(label);
  t.font = Font.semiboldSystemFont(12);
  t.textColor = C.muted;
  t.lineLimit = 1;
  s.addSpacer();
  addIcon(s, "snowflake", 12, C.ice);
  s.addSpacer(3);
  const n = s.addText(String(v.freezes));
  n.font = Font.boldSystemFont(13);
  n.textColor = C.ice;
}

function list(w, v, max, suffix) {
  const done = v.items.filter(i => i.done).length;
  header(w, v, "Heute " + done + "/" + v.items.length + suffix);
  w.addSpacer(8);
  if (!v.items.length) {
    const t = w.addText("Noch keine Habits. Leg in der App eins an.");
    t.font = Font.systemFont(13);
    t.textColor = C.muted;
    w.addSpacer();
    return;
  }
  const shown = v.items.slice(0, v.items.length > max ? max - 1 : max);
  shown.forEach((it, idx) => {
    if (idx) w.addSpacer(5);
    const r = w.addStack();
    r.layoutHorizontally();
    r.centerAlignContent();
    addIcon(r, it.done ? "checkmark.circle.fill" : "circle", 16, it.done ? C.ember : C.line);
    r.addSpacer(8);
    const nm = r.addText(it.name);
    nm.font = Font.mediumSystemFont(14);
    nm.textColor = it.done ? C.muted : C.fg;
    nm.lineLimit = 1;
    r.addSpacer();
    addIcon(r, it.streak > 0 ? "flame.fill" : "flame", 12, it.streak > 0 ? C.ember : C.line);
    r.addSpacer(3);
    const st = r.addText(String(it.streak));
    st.font = Font.boldSystemFont(14);
    st.textColor = C.fg;
  });
  const rest = v.items.length - shown.length;
  if (rest > 0) {
    w.addSpacer(5);
    const m = w.addText("+ " + rest + " weitere");
    m.font = Font.mediumSystemFont(12);
    m.textColor = C.muted;
  }
  w.addSpacer();
}

function small(w, v, suffix) {
  const done = v.items.filter(i => i.done).length;
  const total = v.items.length;
  header(w, v, "Heute" + suffix);
  w.addSpacer();
  const big = w.addText(done + "/" + total);
  big.font = Font.boldSystemFont(38);
  big.textColor = C.fg;
  big.minimumScaleFactor = 0.6;
  const sub = w.addText(total && done === total ? "Alles erledigt" : "erledigt");
  sub.font = Font.mediumSystemFont(13);
  sub.textColor = C.muted;
  w.addSpacer();
  const best = v.items.reduce((m, i) => Math.max(m, i.streak), 0);
  const r = w.addStack();
  r.layoutHorizontally();
  r.centerAlignContent();
  addIcon(r, best > 0 ? "flame.fill" : "flame", 12, best > 0 ? C.ember : C.line);
  r.addSpacer(4);
  const b = r.addText("Beste Streak " + best);
  b.font = Font.semiboldSystemFont(12);
  b.textColor = C.fg;
  b.lineLimit = 1;
  b.minimumScaleFactor = 0.8;
}

function message(w, text) {
  const t = w.addText("Frosty");
  t.font = Font.boldSystemFont(15);
  t.textColor = C.fg;
  w.addSpacer(6);
  const m = w.addText(text);
  m.font = Font.systemFont(13);
  m.textColor = C.muted;
  m.minimumScaleFactor = 0.7;
  w.addSpacer();
}

function build(data, error, stale) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(14, 16, 14, 16);
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  if (!data || !Array.isArray(data.habits)) {
    message(w, error || "Keine Daten.");
    return w;
  }
  const v = prepare(data);
  if (v.url) w.url = v.url;
  const suffix = stale ? " · offline" : "";
  const fam = config.widgetFamily || "medium";
  if (fam === "small") small(w, v, suffix);
  else if (fam === "large" || fam === "extraLarge") list(w, v, 10, suffix);
  else list(w, v, 4, suffix);
  return w;
}

// ---- Start ----
async function main() {
  if (!config.runsInWidget) {
    const action = await menu();
    if (action === "cancel") return;
  }
  const token = Keychain.contains(TOKEN_KEY) ? Keychain.get(TOKEN_KEY) : null;
  let data = null, error = null, stale = false;
  if (token) {
    try {
      data = await load(token);
      fm.writeString(CACHE, JSON.stringify(data));
    } catch (e) {
      error = String((e && e.message) || e);
    }
  } else {
    error = "Öffne das Skript einmal in Scriptable und füge deinen Token ein.";
  }
  if (!data && fm.fileExists(CACHE)) {
    try { data = JSON.parse(fm.readString(CACHE)); stale = true; } catch (e) {}
  }
  const widget = build(data, error, stale);
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
}

await main();
Script.complete();
