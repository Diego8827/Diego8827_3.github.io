"use strict";
/* ROUDI · servidor de tienda y administración. Sin dependencias: solo Node.js 18 o superior. */
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const PORT = +process.env.PORT || 3000;
const DATA = path.join(__dirname, "datos"), UP = path.join(DATA, "uploads"), FILE = path.join(DATA, "db.json"), PUB = path.join(__dirname, "publico");
const COLS = ["products", "categories", "promos", "orders", "customers", "suppliers", "points", "expenses", "log", "config", "drivers"];
fs.mkdirSync(UP, { recursive: true });

let db = { users: {}, cols: {}, seq: 0 };
try { db = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) {}
db.users = db.users || {}; db.cols = db.cols || {}; db.seq = db.seq || 0;
COLS.forEach(c => db.cols[c] = db.cols[c] || {});
const BK = path.join(DATA, "respaldos"); fs.mkdirSync(BK, { recursive: true });
function backup() { try { if (!fs.existsSync(FILE)) return; fs.copyFileSync(FILE, path.join(BK, "db-" + new Date().toISOString().slice(0, 10) + ".json")); fs.readdirSync(BK).sort().slice(0, -14).forEach(x => fs.unlinkSync(path.join(BK, x))); } catch (e) { console.error("Respaldo:", e.message); } }
backup(); setInterval(backup, 6 * 36e5).unref();
function save() { const t = FILE + ".tmp"; fs.writeFileSync(t, JSON.stringify(db)); fs.renameSync(t, FILE); }
const hash = (p, s) => crypto.scryptSync(p, s, 64).toString("hex");
function mkUser(user, name, role, pass) {
  const salt = crypto.randomBytes(16).toString("hex"), id = "u" + crypto.randomBytes(4).toString("hex");
  db.users[id] = { id, user, name, role, salt, hash: hash(pass, salt) }; return id;
}
function checkPass(u, p) {
  const h = Buffer.from(hash(String(p), u.salt), "hex"), k = Buffer.from(u.hash, "hex");
  return h.length === k.length && crypto.timingSafeEqual(h, k);
}
function setPass(u, p) { u.salt = crypto.randomBytes(16).toString("hex"); u.hash = hash(p, u.salt); }

/* Primer inicio o recuperación del administrador principal */
if (process.argv.includes("--reset-admin") || !Object.keys(db.users).length) {
  const p = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString("base64url");
  const u = Object.values(db.users).find(x => x.user === "admin");
  if (u) { setPass(u, p); u.role = "admin"; } else mkUser("admin", "Administrador", "admin", p);
  save();
  console.log("\n  ACCESO DE ADMINISTRADOR\n  Usuario:    admin\n  Contraseña: " + p + "\n  Cámbiala al entrar, en Configuración.\n");
  if (process.argv.includes("--reset-admin")) process.exit(0);
}

const bad = (code, msg) => Object.assign(new Error(msg), { code });
const sess = new Map(), fails = new Map(), orderHits = new Map();
const ID = /^[A-Za-z0-9_.-]{1,60}$/;
const SLOTS = ["09:00–11:00", "11:00–13:00", "15:00–17:00", "17:00–19:00"];
const dayLP = t => new Date(t).toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });
function send(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); }
function raw(req, limit) {
  return new Promise((ok, no) => {
    const a = []; let n = 0;
    req.on("data", c => { n += c.length; if (n > limit) { no(bad(413, "Archivo o solicitud demasiado grande")); req.destroy(); } else a.push(c); });
    req.on("end", () => ok(Buffer.concat(a))); req.on("error", no);
  });
}
async function json(req) { const b = await raw(req, 1e6); try { const o = JSON.parse(b.toString() || "{}"); if (!o || typeof o !== "object") throw 0; return o; } catch (e) { throw bad(400, "Datos no válidos"); } }
function getSess(req) {
  const m = /(?:^|; )sid=([a-f0-9]+)/.exec(req.headers.cookie || ""), s = m && sess.get(m[1]);
  if (!s || s.exp < Date.now()) return null; return Object.assign({ token: m[1] }, s);
}
function addLog(user, action, detail) {
  const id = "l" + Date.now().toString(36) + crypto.randomBytes(2).toString("hex");
  db.cols.log[id] = { t: Date.now(), by: user, action, detail: String(detail || "") };
  const ks = Object.keys(db.cols.log); if (ks.length > 5000) ks.sort().slice(0, ks.length - 5000).forEach(k => delete db.cols.log[k]);
}
const clean = o => { const r = Object.assign({}, o); delete r.id; return r; };
const list = c => Object.keys(db.cols[c]).map(id => Object.assign({ id }, db.cols[c][id]));

/* Precios y promociones (misma lógica que el panel) */
function promoOn(pr, p, now) {
  if (!pr.active || (pr.start && new Date(pr.start) > now) || (pr.end && new Date(pr.end) < now)) return false;
  return (pr.targets || []).some(t => t === "p:" + p.id || t === "c:" + p.cat);
}
function livePrice(p) {
  const now = new Date(); let best = +p.promo > 0 ? +p.promo : +p.price;
  Object.values(db.cols.promos).forEach(pr => { if (promoOn(pr, p, now)) best = Math.min(best, Math.max(0, pr.type === "pct" ? p.price * (1 - pr.value / 100) : p.price - pr.value)); });
  return Math.round(Math.min(best, +p.price) * 100) / 100;
}
function publicData() {
  const cfg = db.cols.config.main || {};
  const products = Object.keys(db.cols.products).map(id => Object.assign({ id }, db.cols.products[id])).filter(p => p.status === "publicado").map(p => {
    const lp = livePrice(p), cat = db.cols.categories[p.cat];
    return { id: p.id, n: p.name, d: p.desc || "", p: +p.price, o: lp < +p.price ? lp : null, c: cat ? cat.name : "Otros", img: (p.photos || [])[0] || "", avail: p.avail, stock: p.avail === "stock" ? +p.stock : null };
  });
  return { payText: cfg.payText || "", qr: cfg.qrUrl || "", slots: SLOTS, today: dayLP(Date.now()), whatsapp: cfg.whatsapp || "", bannerText: cfg.bannerText || "", heroTitle: cfg.heroTitle || "", heroText: cfg.heroText || "", footerText: cfg.footerText || "", products, points: list("points").filter(p => p.active).map(p => p.name + (p.address ? " · " + p.address : "")) };
}
function newOrder(b, ip) {
  const h = (orderHits.get(ip) || []).filter(t => t > Date.now() - 6e5); if (h.length >= 8) throw bad(429, "Demasiados pedidos seguidos. Intenta en unos minutos.");
  h.push(Date.now()); orderHits.set(ip, h);
  const name = String(b.name || "").trim().slice(0, 80); if (!name) throw bad(400, "Escribe tu nombre");
  const phone = String(b.phone || "").replace(/[^\d+]/g, "").slice(0, 20); if (phone.replace(/\D/g, "").length < 7) throw bad(400, "Escribe un celular válido");
  const dd = String(b.date || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(dd) || dd < dayLP(Date.now()) || dd > dayLP(Date.now() + 15 * 864e5)) throw bad(400, "Elige una fecha de entrega válida");
  if (SLOTS.indexOf(b.slot) < 0) throw bad(400, "Elige un horario de entrega");
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 30) throw bad(400, "El carrito está vacío");
  const lines = []; let sub = 0, tot = 0;
  b.items.forEach(i => {
    const p = db.cols.products[i.id], q = Math.floor(+i.qty);
    if (!p || p.status !== "publicado" || !(q >= 1 && q <= 99)) throw bad(400, "Un producto ya no está disponible");
    if (p.avail === "stock" && q > +p.stock) throw bad(409, "Stock insuficiente de «" + p.name + "» (quedan " + p.stock + ")");
    const pp = Object.assign({ id: i.id }, p), up = livePrice(pp);
    lines.push({ pid: i.id, name: p.name, qty: q, list: +p.price, price: up, cost: +p.cost + (+p.extra || 0) }); sub += q * p.price; tot += q * up;
  });
  const seq = Math.max(db.seq, ...Object.values(db.cols.orders).map(o => o.seq || 0)) + 1, num = "R-" + String(seq).padStart(5, "0");
  if (db.cols.orders[num]) throw bad(409, "Intenta de nuevo");
  lines.forEach(l => { const p = db.cols.products[l.pid]; if (p.avail === "stock") p.stock = +p.stock - l.qty; });
  const pay = String(b.pay || "").toLowerCase(), pt = String(b.point || "").slice(0, 120);
  const pid = Object.keys(db.cols.points).find(k => pt.indexOf(db.cols.points[k].name) === 0) || "";
  const cid = "c" + phone.replace(/\D/g, ""); if (!db.cols.customers[cid]) db.cols.customers[cid] = { name, phone, email: "", address: "" };
  db.seq = seq;
  db.cols.orders[num] = { seq, num, date: Date.now(), customer: cid, customerName: name, lines, subtotal: sub, discount: sub - tot, total: tot, payment: pay === "qr" ? "QR" : ["efectivo", "transferencia", "tarjeta"].includes(pay) ? pay : "efectivo", status: "pendiente", phone, deliveryDate: dd, slot: b.slot, driver: "", point: pid, pointName: pt || "—", origin: "tienda" };
  addLog("tienda", "Pedido recibido desde la tienda", num); save();
  return { num, total: tot };
}

async function api(req, res, p, m) {
  const ip = req.socket.remoteAddress || "x";
  if (p === "/api/public" && m === "GET") return send(res, 200, publicData());
  if (p === "/api/public/pedido" && m === "POST") return send(res, 200, newOrder(await json(req), ip));
  if (p === "/api/public/seguimiento" && m === "GET") {
    const q = new URL(req.url, "http://x").searchParams, num = String(q.get("num") || "").trim().toUpperCase(), tel = String(q.get("tel") || "").replace(/\D/g, "");
    const h = (orderHits.get("s" + ip) || []).filter(t => t > Date.now() - 6e5); if (h.length >= 20) throw bad(429, "Demasiadas consultas. Intenta en unos minutos."); h.push(Date.now()); orderHits.set("s" + ip, h);
    const o = db.cols.orders[num];
    if (!o || !o.phone || tel.length < 7 || String(o.phone).replace(/\D/g, "").slice(-8) !== tel.slice(-8)) throw bad(404, "No encontramos un pedido con esos datos");
    return send(res, 200, { num: o.num, status: o.status, date: o.deliveryDate || "", slot: o.slot || "", point: o.pointName || "", total: o.total, lines: o.lines.map(l => l.qty + "× " + l.name) });
  }
  if (p === "/api/login" && m === "POST") {
    const f = fails.get(ip) || { n: 0, t: 0 }; if (f.n >= 5 && Date.now() - f.t < 6e5) throw bad(429, "Demasiados intentos. Espera 10 minutos.");
    const b = await json(req), u = Object.values(db.users).find(x => x.user === String(b.user || "").trim().toLowerCase());
    if (!u || !checkPass(u, b.pass)) { fails.set(ip, { n: f.n + 1, t: Date.now() }); throw bad(401, "Usuario o contraseña incorrectos"); }
    fails.delete(ip); const t = crypto.randomBytes(24).toString("hex");
    sess.set(t, { id: u.id, user: u.user, name: u.name, role: u.role, exp: Date.now() + 8 * 36e5 });
    res.setHeader("Set-Cookie", "sid=" + t + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800" + (req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""));
    addLog(u.user, "Inició sesión", ""); save(); return send(res, 200, { user: u.user, name: u.name, role: u.role });
  }
  const s = getSess(req); if (!s) throw bad(401, "Sesión no iniciada");
  if (m !== "GET" && req.headers["x-roudi"] !== "1") throw bad(403, "Solicitud no permitida");
  const admin = s.role === "admin";
  if (p === "/api/admin/backup" && m === "GET") { if (!admin) throw bad(403, "Solo un administrador puede descargar respaldos"); addLog(s.user, "Descargó respaldo", ""); save(); return send(res, 200, { generado: new Date().toISOString(), cols: db.cols }); }
  if (p === "/api/me") return send(res, 200, { user: s.user, name: s.name, role: s.role });
  if (p === "/api/logout" && m === "POST") { sess.delete(s.token); addLog(s.user, "Cerró sesión", ""); save(); res.setHeader("Set-Cookie", "sid=; Max-Age=0; Path=/"); return send(res, 200, {}); }
  if (p === "/api/admin/all" && m === "GET") { const o = {}; COLS.forEach(c => { if (c !== "log" || admin) o[c] = list(c); }); return send(res, 200, o); }
  let r = /^\/api\/admin\/(\w+)\/([^/]+)$/.exec(p);
  if (r) {
    const c = r[1], id = decodeURIComponent(r[2]);
    if (COLS.indexOf(c) < 0 || !ID.test(id)) throw bad(400, "Ruta no válida");
    if (m === "GET") { if (!db.cols[c][id]) throw bad(404, "No existe"); return send(res, 200, db.cols[c][id]); }
    if (c === "log") { if (m === "POST" || m === "PUT") return send(res, 200, {}); throw bad(403, "El registro no se puede modificar"); }
    if (c === "config" && !admin) throw bad(403, "Solo un administrador puede cambiar la configuración");
    const ex = db.cols[c][id], d = m === "DELETE" ? null : clean(await json(req));
    if (m === "PUT") { if (c === "orders" && ex) throw bad(409, "Ese pedido ya existe"); db.cols[c][id] = d; }
    else if (m === "PATCH") { if (!ex) throw bad(404, "No existe"); Object.assign(ex, d); }
    else if (m === "DELETE") { if (!ex) throw bad(404, "No existe"); delete db.cols[c][id]; }
    else throw bad(405, "Método no permitido");
    const x = d || ex || {}; addLog(s.user, (m === "DELETE" ? "Eliminó" : m === "PUT" ? "Guardó" : "Actualizó") + " en " + c, x.name || x.num || id);
    save(); return send(res, 200, {});
  }
  if (p === "/api/password" && m === "POST") {
    const b = await json(req), u = db.users[s.id]; if (!u || !checkPass(u, b.old)) throw bad(400, "La contraseña actual no es correcta");
    if (String(b.new || "").length < 8) throw bad(400, "La nueva contraseña debe tener al menos 8 caracteres");
    setPass(u, String(b.new)); addLog(s.user, "Cambió su contraseña", ""); save(); return send(res, 200, {});
  }
  if (p === "/api/upload" && m === "POST") {
    const ext = (/\.(jpe?g|png|webp|gif)$/i.exec(String(req.headers["x-filename"] || "")) || [])[1]; if (!ext) throw bad(400, "Solo imágenes JPG, PNG, WEBP o GIF");
    const b = await raw(req, 6e6), name = crypto.randomBytes(8).toString("hex") + "." + ext.toLowerCase();
    fs.writeFileSync(path.join(UP, name), b); return send(res, 200, { url: "/uploads/" + name });
  }
  if (p.indexOf("/api/users") === 0) {
    if (!admin) throw bad(403, "Solo un administrador puede gestionar usuarios");
    if (p === "/api/users" && m === "GET") return send(res, 200, Object.values(db.users).map(u => ({ id: u.id, user: u.user, name: u.name, role: u.role })));
    if (p === "/api/users" && m === "POST") {
      const b = await json(req), us = String(b.user || "").trim().toLowerCase();
      if (!/^[a-z0-9_.-]{3,30}$/.test(us)) throw bad(400, "Usuario: 3 a 30 letras minúsculas, números, punto o guion");
      if (Object.values(db.users).some(u => u.user === us)) throw bad(409, "Ese usuario ya existe");
      if (String(b.pass || "").length < 8) throw bad(400, "La contraseña debe tener al menos 8 caracteres");
      mkUser(us, String(b.name || us).slice(0, 60), b.role === "admin" ? "admin" : "editor", String(b.pass)); addLog(s.user, "Creó usuario", us); save(); return send(res, 200, {});
    }
    r = /^\/api\/users\/(\w+)(\/password)?$/.exec(p); const u = r && db.users[r[1]]; if (!u) throw bad(404, "No existe");
    if (r[2] && m === "POST") { const b = await json(req); if (String(b.pass || "").length < 8) throw bad(400, "Mínimo 8 caracteres"); setPass(u, String(b.pass)); addLog(s.user, "Restableció contraseña de", u.user); save(); return send(res, 200, {}); }
    if (!r[2] && m === "DELETE") {
      if (u.id === s.id) throw bad(400, "No puedes eliminar tu propio usuario");
      delete db.users[u.id]; sess.forEach((v, k) => { if (v.id === u.id) sess.delete(k); }); addLog(s.user, "Eliminó usuario", u.user); save(); return send(res, 200, {});
    }
  }
  throw bad(404, "No encontrado");
}

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
function serve(req, res, p) {
  p = decodeURIComponent(p); if (p === "/") p = "/index.html"; if (p === "/admin") p = "/admin.html";
  const base = p.indexOf("/uploads/") === 0 ? UP : PUB, rel = p.indexOf("/uploads/") === 0 ? p.slice(9) : p;
  const f = path.normalize(path.join(base, rel));
  if (f.indexOf(base) !== 0 || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("No encontrado"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Cache-Control": p === "/admin.html" ? "no-store" : "public, max-age=300" });
  fs.createReadStream(f).pipe(res);
}
http.createServer(async (req, res) => {
  try { const p = new URL(req.url, "http://x").pathname; if (p.indexOf("/api/") === 0) await api(req, res, p, req.method); else serve(req, res, p); }
  catch (e) { if (!e.code) console.error(e); if (!res.headersSent) send(res, e.code || 500, { error: e.code ? e.message : "Error del servidor" }); }
}).listen(PORT, () => console.log("ROUDI en marcha: http://localhost:" + PORT + "  ·  Administración: http://localhost:" + PORT + "/admin"));
