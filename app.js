"use strict";

/* ============================================================
   CONFIGURACIÓN
   API_URL: dirección del backend FastAPI (debe ser HTTPS si la página está en GitHub Pages).
   Para probar sin editar código abre la página una vez con  ?api=https://tu-tunel.ngrok.app
   (se guarda en el navegador). Con  ?api=  vacío se borra y vuelve al modo demostración.
   ============================================================ */
const HELP_CONTACT = null;  // ej. "https://wa.me/52951XXXXXXX"

const db = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};
const API_URL = (() => {
  const q = new URLSearchParams(location.search).get("api");
  if (q !== null) db.set("api", q.replace(/\/+$/, "") || null);
  return db.get("api", null);
})();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ============================ Utilidades ============================ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const money = n => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const num = n => +Number(n).toFixed(2);
let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = "es-MX"; u.rate = 0.95;
  speechSynthesis.speak(u);
}

/* ============================================================
   CAPA DE DATOS
   Con API_URL usa el backend (contratos de backend/schemas.py).
   Sin API_URL funciona en modo demostración con localStorage.
   ============================================================ */
async function http(path, opts = {}) {
  let r;
  try {
    r = await fetch(API_URL + path, { ...opts, headers: { "ngrok-skip-browser-warning": "1", ...(opts.headers || {}) } });
  } catch { throw new Error("No hay conexión con el servidor. Revisa tu internet e intenta de nuevo."); }
  if (!r.ok) {
    let d = ""; try { d = (await r.json()).detail; } catch {}
    throw new Error((typeof d === "string" && d) || "El servidor no respondió bien (" + r.status + ").");
  }
  return r.json();
}
const JSON_POST = body => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const DEMO = [
  { codigo: "7501000000011", nombre: "Refresco 600 ml", precio: 18, stock: 24 },
  { codigo: "7501000000028", nombre: "Arroz 1 kg", precio: 32.5, stock: 10 },
  { codigo: "7501000000035", nombre: "Galletas surtidas", precio: 22, stock: 3 },
  { codigo: "7501000000042", nombre: "Agua 1 L", precio: 12, stock: 40 },
];
const api = {
  // GET /inventory -> [{nombre, cantidad, precio}]. El backend aún no manda código de barras.
  async listarProductos() {
    if (!API_URL) return db.get("productos", DEMO).map(p => ({ ...p, id: p.codigo || p.nombre }));
    try {
      const ps = await http("/inventory"), sold = db.get("vendidoLocal", {});
      const out = ps.map(p => ({ id: p.nombre, codigo: null, nombre: p.nombre, precio: p.precio ?? 0, sinPrecio: p.precio == null,
        stock: Math.max(0, (p.cantidad || 0) - (sold[p.nombre] || 0)) }));
      db.set("cacheProductos", out); return out;
    } catch (e) { toast(e.message); return db.get("cacheProductos", []); }
  },
  // Movimientos: el backend aún no tiene endpoint; se guardan en este dispositivo.
  async listarMovimientos() { return db.get("movimientos", []); },

  // POST /ticket/parse (multipart "file") -> ParsedTicket
  async leerTicket(blob) {
    if (API_URL) { const fd = new FormData(); fd.append("file", blob, "ticket.jpg"); return http("/ticket/parse", { method: "POST", body: fd }); }
    await new Promise(r => setTimeout(r, 900));
    return { items: [{ nombre: "Refresco 600 ml", cantidad: 12, precio: 15, confianza: 0.95, crudo: "REFR 600ML 12" },
      { nombre: "Arros 1kg", cantidad: 5, precio: 28, confianza: 0.5, crudo: "ARROS 1K 5" }], total: 320, fecha: null,
      advertencias: ["Modo demostración: estos datos son de ejemplo."] };
  },
  // POST /inventory/bulk_add {items} -> Resultado
  async guardarEntrada(items, proveedor) {
    let r;
    if (API_URL) r = await http("/inventory/bulk_add", JSON_POST({ items }));
    else {
      const ps = db.get("productos", DEMO);
      items.forEach(i => { const p = ps.find(x => norm(x.nombre) === norm(i.nombre)); p ? p.stock += i.cantidad : ps.push({ codigo: "", nombre: i.nombre, precio: i.precio || 0, stock: i.cantidad }); });
      db.set("productos", ps);
      const lote = Date.now() % 1e9, lotes = db.get("lotes", {}); lotes[lote] = items; db.set("lotes", lotes);
      r = { ok: true, mensaje: `Listo. Se guardaron ${items.length} productos.`, lote };
    }
    if (r.ok) { const l = db.get("movimientos", []); l.unshift({ id: uid(), tipo: "entrada", fecha: new Date().toISOString(), n: items.length, proveedor, lote: r.lote }); db.set("movimientos", l); }
    return r;
  },
  // POST /inventory/undo/{lote} -> Resultado
  async deshacer(lote) {
    let r;
    if (API_URL) r = await http("/inventory/undo/" + lote, { method: "POST" });
    else {
      const lotes = db.get("lotes", {}), items = lotes[lote] || [], ps = db.get("productos", DEMO);
      items.forEach(i => { const p = ps.find(x => norm(x.nombre) === norm(i.nombre)); if (p) p.stock = Math.max(0, p.stock - i.cantidad); });
      db.set("productos", ps); r = { ok: true, mensaje: "Listo. Se deshizo la entrada.", lote };
    }
    if (r.ok) db.set("movimientos", db.get("movimientos", []).filter(m => m.lote !== lote));
    return r;
  },
  // Ventas: el backend aún no tiene endpoint (TODO POST /sales). Por ahora se descuentan en este dispositivo.
  async crearVenta(v) {
    if (API_URL) { const s = db.get("vendidoLocal", {}); v.items.forEach(i => s[i.nombre] = (s[i.nombre] || 0) + i.cantidad); db.set("vendidoLocal", s); }
    else {
      const ps = db.get("productos", DEMO);
      v.items.forEach(i => { const p = ps.find(x => (x.codigo || x.nombre) === i.id); if (p) p.stock = Math.max(0, p.stock - i.cantidad); });
      db.set("productos", ps);
    }
    const l = db.get("movimientos", []); l.unshift({ id: uid(), tipo: "venta", fecha: new Date().toISOString(), ...v }); db.set("movimientos", l);
  },
};

let catalogo = [], carrito = [];
const refresh = async () => { catalogo = await api.listarProductos(); };

/* ============================ Accesibilidad ============================ */
let size = db.get("size", 1);
const applySize = () => { document.documentElement.dataset.size = size; db.set("size", size); };
$("#sizeUp").onclick = () => { size = Math.min(2, size + 1); applySize(); };
$("#sizeDown").onclick = () => { size = Math.max(0, size - 1); applySize(); };
const setContrast = on => { document.documentElement.classList.toggle("hc", on); $("#contrast").setAttribute("aria-pressed", on); db.set("hc", on); };
$("#contrast").onclick = () => setContrast(!db.get("hc", false));
applySize(); setContrast(db.get("hc", false));
$("#fileLabel").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#photoFile").click(); } });

/* ============================ Navegación ============================ */
let current = "recibir";
function goTab(name, sub) {
  current = name;
  $$(".tabs button").forEach(x => x.setAttribute("aria-selected", x.dataset.tab === name));
  $$(".panel").forEach(p => p.hidden = p.id !== "tab-" + name);
  if (name !== "vender") scanner.stop();
  if (name !== "recibir") photo.stop();
  if (name === "registro") { if (sub) setSub(sub); renderRegistro(); refresh().then(renderRegistro); }
}
$$(".tabs button").forEach(b => b.addEventListener("click", () => goTab(b.dataset.tab)));

/* ============================ Cámara compartida ============================ */
function makeCamera(video) {
  let stream = null;
  return {
    get active() { return !!stream; },
    async start() {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("La cámara requiere HTTPS y un navegador compatible.");
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      video.srcObject = stream; video.hidden = false; await video.play();
    },
    stop() { stream?.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null; video.hidden = true; },
  };
}

/* ============================ RECIBIR: foto -> revisar -> confirmar -> deshacer ============================ */
let photoBlob = null, review = null, lastLote = null;
const photo = (() => {
  const cam = makeCamera($("#photoVideo"));
  const show = blob => { photoBlob = blob; const img = $("#photoPreview"); img.src = URL.createObjectURL(blob); img.hidden = false; $("#photoEmpty").hidden = true; };
  $("#photoOpen").onclick = async () => {
    try { await cam.start(); $("#photoPreview").hidden = true; $("#photoEmpty").hidden = true; $("#photoSnap").hidden = false; $("#photoOpen").hidden = true; }
    catch (e) { toast(e.message || "No se pudo abrir la cámara. Puedes subir una imagen."); }
  };
  $("#photoSnap").onclick = () => {
    const v = $("#photoVideo"), c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight; c.getContext("2d").drawImage(v, 0, 0);
    c.toBlob(b => { show(b); photo.stop(); toast("Foto tomada. Toca «Leer ticket»."); }, "image/jpeg", 0.85);
  };
  $("#photoFile").onchange = e => { if (e.target.files[0]) { cam.stop(); show(e.target.files[0]); } };
  return { stop() { cam.stop(); $("#photoSnap").hidden = true; $("#photoOpen").hidden = false; } };
})();

function resetRecibir() {
  photoBlob = null; review = null; $("#photoPreview").hidden = true; $("#photoEmpty").hidden = false; $("#proveedor").value = "";
  $("#reviewBox").hidden = true; $("#captureBox").hidden = false;
}
$("#guardarEntrada").onclick = async () => {
  if (!photoBlob) return toast("Primero toma o sube una foto del ticket.");
  const b = $("#guardarEntrada"); b.disabled = true; b.textContent = "Leyendo el ticket…";
  $("#undoBox").hidden = true;
  try {
    const t = await api.leerTicket(photoBlob);
    review = { items: t.items.map(i => ({ ...i })), proveedor: $("#proveedor").value.trim() };
    const dudas = review.items.filter(i => i.confianza < 0.7).length;
    $("#reviewHint").textContent = [
      review.items.length ? `Encontré ${review.items.length} productos. Revisa que estén bien.` : "No encontré productos. Agrégalos a mano o toma otra foto.",
      dudas ? `Los marcados «Revise este» (${dudas}) pueden estar mal.` : "",
      t.total != null ? `Total del ticket: ${money(t.total)}.` : "", t.fecha ? `Fecha: ${t.fecha}.` : "", ...(t.advertencias || []),
    ].filter(Boolean).join(" ");
    $("#captureBox").hidden = true; $("#reviewBox").hidden = false; renderReview();
  } catch (e) { toast(e.message || "No pude leer el ticket. Intenta con más luz."); }
  finally { b.disabled = false; b.textContent = "Leer ticket"; }
};
function renderReview() {
  $("#reviewList").innerHTML = review.items.map((it, i) => `
    <li class="rev-li ${it.confianza < 0.7 ? "warn" : ""}">
      ${it.confianza < 0.7 ? '<span class="tag low">Revise este</span>' : ""}
      <div class="rev">
        <div class="n"><label for="rn${i}">Producto</label><input id="rn${i}" type="text" data-i="${i}" data-k="nombre" value="${esc(it.nombre)}"></div>
        <div><label for="rc${i}">Cantidad</label><input id="rc${i}" type="number" inputmode="decimal" min="0" step="any" data-i="${i}" data-k="cantidad" value="${it.cantidad}"></div>
        <div><label for="rp${i}">Precio</label><input id="rp${i}" type="number" inputmode="decimal" min="0" step="any" data-i="${i}" data-k="precio" value="${it.precio ?? ""}"></div>
      </div>
      <button class="btn ghost" data-del="${i}">Quitar este producto</button>
    </li>`).join("");
}
$("#reviewList").addEventListener("input", e => {
  const el = e.target, i = el.dataset.i; if (i === undefined) return;
  const it = review.items[i], k = el.dataset.k;
  it[k] = k === "nombre" ? el.value : k === "cantidad" ? (parseFloat(el.value) || 0) : (el.value === "" ? null : parseFloat(el.value));
});
$("#reviewList").addEventListener("click", e => {
  const b = e.target.closest("[data-del]"); if (!b) return;
  review.items.splice(+b.dataset.del, 1); renderReview();
});
$("#reviewAdd").onclick = () => {
  review.items.push({ nombre: "", cantidad: 1, precio: null, confianza: 1, crudo: "" }); renderReview();
  $("#rn" + (review.items.length - 1)).focus();
};
$("#reviewCancel").onclick = resetRecibir;
$("#reviewOk").onclick = async () => {
  const items = review.items.filter(i => i.nombre.trim()).map(i => ({ ...i, nombre: i.nombre.trim() }));
  if (!items.length) return toast("No hay productos para guardar.");
  if (items.some(i => !(i.cantidad > 0))) return toast("Revisa las cantidades: deben ser mayores que cero.");
  const b = $("#reviewOk"); b.disabled = true; b.textContent = "Guardando…";
  try {
    const r = await api.guardarEntrada(items, review.proveedor);
    if (!r.ok) return toast(r.mensaje || "No se pudo guardar.");
    lastLote = r.lote; resetRecibir(); refresh();
    $("#undoMsg").textContent = r.mensaje; $("#undoBox").hidden = r.lote == null;
    if ($("#ttsOn").checked) speak(r.mensaje);
    toast(r.mensaje);
  } catch (e) { toast(e.message); }
  finally { b.disabled = false; b.textContent = "Confirmar y guardar"; }
};
$("#undoBtn").onclick = async () => {
  try {
    const r = await api.deshacer(lastLote); toast(r.mensaje);
    if (r.ok) { $("#undoBox").hidden = true; refresh(); }
  } catch (e) { toast(e.message); }
};

/* ============================ VENDER ============================ */
let pendingCode = null;
const scanner = (() => {
  const video = $("#scanVideo"), cam = makeCamera(video);
  let detector = null, timer = null, lastCode = "", lastAt = 0;
  async function loop() {
    if (!cam.active) return;
    try {
      const f = await detector.detect(video), now = Date.now();
      if (f[0] && (f[0].rawValue !== lastCode || now - lastAt > 2000)) { lastCode = f[0].rawValue; lastAt = now; addByCode(lastCode); }
    } catch {}
    timer = setTimeout(loop, 250);
  }
  const o = {
    async start() {
      if (!("BarcodeDetector" in window)) return toast("Este navegador no lee códigos con la cámara. Usa el campo manual o Chrome/Edge.");
      try {
        detector ||= new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"] });
        await cam.start(); $("#scanEmpty").hidden = true; $("#reticle").hidden = false; $("#scanToggle").textContent = "Cerrar cámara"; loop();
      } catch (e) { toast(e.message || "No se pudo abrir la cámara."); }
    },
    stop() { clearTimeout(timer); cam.stop(); $("#reticle").hidden = true; $("#scanEmpty").hidden = false; $("#scanToggle").textContent = "Abrir cámara"; },
  };
  $("#scanToggle").onclick = () => cam.active ? o.stop() : o.start();
  return o;
})();

/* El backend aún no guarda códigos de barras: un código nuevo se vincula una vez a un producto y se recuerda en este dispositivo. */
const findCode = c => { c = String(c).trim(); const m = db.get("codigos", {}); return catalogo.find(p => p.codigo === c) || catalogo.find(p => p.nombre === m[c]); };
function addProduct(p, qty = 1) {
  const it = carrito.find(i => i.id === p.id);
  if ((it?.cantidad || 0) + qty > p.stock) { toast("No hay suficientes existencias de " + p.nombre); return false; }
  it ? it.cantidad += qty : carrito.push({ id: p.id, nombre: p.nombre, precio: p.precio, cantidad: qty });
  if (p.sinPrecio) toast(p.nombre + " no tiene precio. Se cobra $0.00.");
  navigator.vibrate?.(40); renderCarrito(); return true;
}
function addByCode(code, qty = 1) {
  const p = findCode(code);
  if (!p) { pendingCode = String(code).trim(); toast("Código nuevo. Busca el producto por nombre para vincularlo."); return false; }
  return addProduct(p, qty);
}
function renderCarrito() {
  $("#cartList").innerHTML = carrito.map((i, n) => `
    <li><div>${esc(i.nombre)}<small>${money(i.precio)}</small></div>
    <div class="qty"><button data-d="-1" data-n="${n}" aria-label="Quitar uno de ${esc(i.nombre)}">−</button>
    <span>${num(i.cantidad)}</span><button data-d="1" data-n="${n}" aria-label="Agregar uno de ${esc(i.nombre)}">+</button></div></li>`).join("");
  $("#cartTotal").textContent = money(carrito.reduce((s, i) => s + i.precio * i.cantidad, 0));
  $("#cartEmpty").hidden = carrito.length > 0; $("#payNfc").disabled = !carrito.length;
}
$("#cartList").onclick = e => {
  const b = e.target.closest("button"); if (!b) return;
  const i = carrito[+b.dataset.n], p = catalogo.find(x => x.id === i.id);
  if (b.dataset.d === "1") return p && addProduct(p);
  if (--i.cantidad <= 0) carrito = carrito.filter(x => x !== i);
  renderCarrito();
};
$("#cartClear").onclick = () => { carrito = []; renderCarrito(); };
const manual = () => { const v = $("#codigoManual").value.trim(); if (v) addByCode(v); $("#codigoManual").value = ""; };
$("#codigoAdd").onclick = manual;
$("#codigoManual").onkeydown = e => { if (e.key === "Enter") manual(); };

$("#nombreBuscar").addEventListener("input", () => {
  const q = norm($("#nombreBuscar").value.trim()), box = $("#nombreRes");
  const l = q ? catalogo.filter(p => norm(p.nombre).includes(q)).slice(0, 5) : [];
  box.innerHTML = l.map((p, i) => `<button class="btn ghost" data-i="${i}"><span>${esc(p.nombre)}</span><span>${p.sinPrecio ? "Sin precio" : money(p.precio)}</span></button>`).join("");
  box.onclick = e => {
    const b = e.target.closest("button"); if (!b) return; const p = l[+b.dataset.i];
    if (pendingCode) { const m = db.get("codigos", {}); m[pendingCode] = p.nombre; db.set("codigos", m); toast("Código vinculado a " + p.nombre + ". La próxima vez se agrega solo."); pendingCode = null; }
    addProduct(p); $("#nombreBuscar").value = ""; box.innerHTML = "";
  };
});

const hayAndroid = typeof Android !== "undefined" && typeof Android.startPayment === "function";
const centavos = n => Math.round(n * 100);
let ventaPendiente = null;

// La app Android llama a esta función cuando termina el cobro
window.onPaymentResult = async r => {
  const st = $("#nfcStatus");
  const v = ventaPendiente; ventaPendiente = null;
  $("#payNfc").disabled = !carrito.length;
  if (!v) return;
  if (r.status === "succeeded") {
    await api.crearVenta({ items: v.items, total: v.total, metodo: "tarjeta", referencia: r.paymentIntentId });
    carrito = []; renderCarrito(); await refresh();
    st.textContent = ""; toast("Venta registrada: " + money(v.total));
  } else {
    st.textContent = r.message || "El pago no se completó.";
  }
};

$("#payNfc").onclick = async () => {
  const st = $("#nfcStatus"), total = carrito.reduce((s, i) => s + i.precio * i.cantidad, 0);
  if (total <= 0) { st.textContent = "El total debe ser mayor a $0.00."; return; }

  if (!hayAndroid) {   // navegador normal: modo demostración, como antes
    if (confirm("Aquí no hay terminal de pago. ¿Simular el cobro para probar?")) {
      await api.crearVenta({ items: carrito, total, metodo: "tarjeta", referencia: "simulado" });
      carrito = []; renderCarrito(); await refresh(); toast("Venta registrada: " + money(total));
    }
    return;
  }

  ventaPendiente = { items: carrito.map(i => ({ ...i })), total };
  $("#payNfc").disabled = true;
  st.textContent = "Cobrando " + money(total) + "…";
  Android.startPayment(centavos(total));
};

/* ============================ REGISTRO ============================
   Búsqueda + filtros + orden + paginación de 20 en 20 (en el dispositivo).
   Con inventarios muy grandes, GET /inventory debería aceptar q, filtro, orden y pagina. */
const PAGE = 20, view = { stock: { p: 1 }, log: { p: 1 } };
function setSub(s) {
  $$(".seg button[data-sub]").forEach(b => b.setAttribute("aria-pressed", b.dataset.sub === s));
  $("#sub-stock").hidden = s !== "stock"; $("#sub-log").hidden = s !== "log";
}
$$(".seg button[data-sub]").forEach(b => b.onclick = () => { setSub(b.dataset.sub); renderRegistro(); });
function pager(id, total, st, cb) {
  const pages = Math.max(1, Math.ceil(total / PAGE)); st.p = Math.min(st.p, pages);
  const el = $("#pg-" + id), [prev, next] = el.querySelectorAll("button");
  el.querySelector("span").textContent = `Página ${st.p} de ${pages}`;
  prev.disabled = st.p <= 1; next.disabled = st.p >= pages; el.hidden = pages <= 1;
  prev.onclick = () => { st.p--; cb(); }; next.onclick = () => { st.p++; cb(); };
}
const estado = s => s <= 0 ? ["out", "Agotado"] : s <= 5 ? ["low", "Por surtir"] : ["ok", "Disponible"];

async function renderRegistro() {
  const prods = catalogo, movs = await api.listarMovimientos();
  if (!$("#sub-stock").hidden) {
    const q = norm($("#stockQ").value), f = $("#stockF").value, s = $("#stockS").value;
    let l = prods.filter(p => (!q || norm(p.nombre).includes(q) || (p.codigo || "").includes(q)) &&
      (f === "all" || (f === "low" ? p.stock <= 5 : p.stock <= 0)));
    l.sort(s === "stock" ? (a, b) => a.stock - b.stock : s === "price" ? (a, b) => a.precio - b.precio : (a, b) => a.nombre.localeCompare(b.nombre, "es"));
    $("#stockCount").textContent = l.length ? `${l.length} de ${prods.length} productos` : "No hay productos con ese filtro. Prueba otra búsqueda.";
    const pg = l.slice((view.stock.p - 1) * PAGE, view.stock.p * PAGE);
    $("#stockList").innerHTML = pg.map(p => { const [c, t] = estado(p.stock);
      return `<li><div>${esc(p.nombre)}<small>${p.codigo ? esc(p.codigo) + " · " : ""}${p.sinPrecio ? "Sin precio" : money(p.precio)}</small></div>
      <div class="meta"><span><strong>${num(p.stock)}</strong> pzas</span><span class="tag ${c}">${t}</span></div></li>`; }).join("");
    pager("stock", l.length, view.stock, renderRegistro);
  } else {
    const q = norm($("#logQ").value), f = $("#logF").value;
    const l = movs.filter(m => (f === "all" || m.tipo === f) && (!q || norm(JSON.stringify([m.proveedor, m.items?.map?.(i => i.nombre)])).includes(q)));
    $("#logCount").textContent = l.length ? `${l.length} movimientos` : "Aún no hay movimientos con ese filtro.";
    const pg = l.slice((view.log.p - 1) * PAGE, view.log.p * PAGE);
    $("#logList").innerHTML = pg.map(m => {
      const fe = new Date(m.fecha).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
      const d = m.tipo === "venta" ? `Venta de ${num(m.items.reduce((s, i) => s + i.cantidad, 0))} pzas · ${money(m.total)}`
        : `Entrada${m.n ? " de " + m.n + " productos" : ""}${m.proveedor ? " · " + esc(m.proveedor) : ""}`;
      return `<li><div>${d}<small>${fe}</small></div><span class="tag ${m.tipo === "venta" ? "sale" : "in"}">${m.tipo === "venta" ? "Venta" : "Entrada"}</span></li>`;
    }).join("");
    pager("log", l.length, view.log, renderRegistro);
  }
}
["stockQ", "stockF", "stockS", "logQ", "logF"].forEach(id => $("#" + id).addEventListener("input", () => { view.stock.p = view.log.p = 1; renderRegistro(); }));

/* ============================ AYUDA ============================ */
const HELP = {
  recibir: ["Toca «Abrir cámara» y apunta al ticket del proveedor, luego «Tomar foto».", "Toca «Leer ticket». Espera unos segundos.", "Revisa la lista. Los marcados «Revise este» pueden estar mal: corrígelos o quítalos.", "Toca «Confirmar y guardar». Si te equivocas, toca «Deshacer esta entrada»."],
  vender: ["Toca «Abrir cámara» y acerca el código de barras del producto. Suena y se agrega solo.", "Si no lee, escribe el código o busca el producto por nombre.", "Usa + y − para cambiar cantidades. El total aparece abajo.", "Toca «Pagar con NFC» y acerca la tarjeta o el teléfono del cliente."],
  registro: ["En «Productos disponibles» busca por nombre y mira qué se está acabando.", "Elige «Por surtir» para ver solo lo que hay que comprar.", "En «Movimientos» ves lo que entró y lo que se vendió."],
  asistente: ["Toca «Asistente». Te escucha de inmediato: solo di qué quieres hacer.", "Puedes decir: «quiero registrar un ticket», «vender refresco», «qué me falta», «cuánto vendí hoy».", "Si prefieres, toca una de las opciones grandes. La voz se puede apagar."],
};
const TITULOS = { recibir: "Recibir mercancía", vender: "Vender", registro: "Registro", asistente: "Usar el asistente" };
function openHelp() {
  const steps = k => `<ol>${HELP[k].map(s => `<li>${s}</li>`).join("")}</ol>`;
  $("#helpTitle").textContent = "Ayuda: " + TITULOS[current];
  $("#helpBody").innerHTML = steps(current) + Object.keys(HELP).filter(k => k !== current)
    .map(k => `<details><summary>${TITULOS[k]}</summary>${steps(k)}</details>`).join("");
  $("#helpDlg").showModal();
}
$("#helpBtn").onclick = openHelp;
$("#toolsBtn").onclick = () => { const o = $("#tools").classList.toggle("open"); $("#toolsBtn").setAttribute("aria-expanded", o); };
$("#helpClose").onclick = () => { speechSynthesis?.cancel(); $("#helpDlg").close(); };
$("#helpSpeak").onclick = () => speak(HELP[current].join(" "));
if (HELP_CONTACT) { const a = $("#helpContact"); a.href = HELP_CONTACT; a.target = "_blank"; a.rel = "noopener"; a.hidden = false; }

/* ============================ ASISTENTE ============================
   Navegación y ayuda: POST /assistant/interpret {texto} -> Accion (backend; no modifica datos).
   Vender y preguntas sobre el inventario/ventas se resuelven aquí, con los datos del dispositivo.
   Sin servidor, todo se resuelve con reglas locales. */
const asst = $("#asst"), msg = $("#asstMsg");
function show(text) { msg.textContent = text; if ($("#ttsOn").checked) speak(text); }
const faltantes = () => catalogo.filter(p => p.stock <= 5).sort((a, b) => a.stock - b.stock);
function buscar(txt) {
  const stop = new Set(["un", "una", "unos", "unas", "el", "la", "los", "las", "de", "del", "y", "para", "esta", "este", "cosa", "producto", "por", "favor", "quiero", "dos", "tres"]);
  const tk = norm(txt).replace(/\d+/g, " ").split(/\W+/).filter(w => w.length > 2 && !stop.has(w)).map(w => w.replace(/s$/, ""));
  if (!tk.length) return null;
  return catalogo.find(p => tk.every(w => norm(p.nombre).includes(w))) || catalogo.find(p => tk.some(w => norm(p.nombre).includes(w))) || null;
}
function intentoLocal(texto) {
  const t = norm(texto), n = +(t.match(/\d+/)?.[0] || 1);
  if (/\b(ayuda|auxilio|no se|como se usa)\b/.test(t)) return { accion: "ayuda", respuesta: "Claro, te abro la ayuda paso a paso." };
  if (/que (me )?falta|necesit|comprar|surtir|resurt|se (esta )?acab/.test(t)) {
    const f = faltantes();
    return { dato: 1, accion: "responder", respuesta: f.length ? "Te conviene surtir: " + f.map(p => `${p.nombre} (${num(p.stock)})`).join(", ") + "." : "Por ahora tienes suficiente de todo." };
  }
  if (/cuanto (vendi|llevo|he vendido)|ventas de hoy/.test(t)) {
    const hoy = new Date().toDateString(), total = db.get("movimientos", []).filter(m => m.tipo === "venta" && new Date(m.fecha).toDateString() === hoy).reduce((s, m) => s + m.total, 0);
    return { dato: 1, accion: "responder", respuesta: total ? "Hoy llevas " + money(total) + " en ventas." : "Todavía no hay ventas registradas hoy." };
  }
  const q = t.match(/cuanto(?:s)? (?:hay|tengo|queda(?:n)?) (?:de )?(.+)/);
  if (q) { const p = buscar(q[1]); return { dato: 1, accion: "responder", respuesta: p ? `De ${p.nombre} tienes ${num(p.stock)}.` : "No encontré ese producto." }; }
  if (/vender|vendo|vendi|cobrar|agrega|agregar|\bventa\b/.test(t)) {
    const p = buscar(t.replace(/vender|vendo|vendi|cobrar|agregar|agrega|venta/g, ""));
    return { dato: 1, accion: "vender", producto: p?.id, cantidad: n, respuesta: p ? `Listo, agregué ${n} ${p.nombre} al carrito.` : "Abrí Vender. Escanea el producto con la cámara." };
  }
  if (/movimiento|historial/.test(t)) return { accion: "ir", destino: "registro", sub: "log", respuesta: "Aquí están los movimientos." };
  if (/inventario|registro|existencia|productos disponibles/.test(t)) return { accion: "ir", destino: "registro", sub: "stock", respuesta: "Aquí está tu inventario." };
  if (/ticket|tiket|recib|llego|llegaron|mercancia|entrada|proveedor/.test(t)) return { accion: "ir", destino: "recibir", respuesta: "Abrí Recibir. Toma una foto del ticket." };
  return { accion: "responder", respuesta: "No te entendí bien. Puedes decir: registrar un ticket, vender algo, qué me falta o cuánto vendí hoy." };
}
const DEST = { inicio: ["recibir"], escanear_ticket: ["recibir"], inventario: ["registro", "stock"] };
async function interpretar(texto) {
  const loc = intentoLocal(texto);
  if (loc.dato || !API_URL) return loc;
  try {
    const a = await http("/assistant/interpret", JSON_POST({ texto })), [destino, sub] = DEST[a.destino] || [];
    const mensaje = a.mensaje || loc.respuesta;
    if (a.accion === "navegar" && destino) return { accion: "ir", destino, sub, respuesta: mensaje };
    if (a.accion === "ayuda") return { accion: "ayuda", destino, sub, respuesta: mensaje };
    return { accion: "responder", respuesta: mensaje };
  } catch { return loc; }
}
async function pedir(texto) {
  texto = texto.trim(); if (!texto) return;
  msg.textContent = "Un momento…"; await refresh();
  const r = await interpretar(texto), nav = ["ir", "vender", "ayuda"].includes(r.accion);
  let fin = r.respuesta;
  if (nav) toggleAsst(false, true);
  if (r.accion === "ir") goTab(r.destino, r.sub);
  else if (r.accion === "vender") { goTab("vender"); const p = catalogo.find(x => x.id === r.producto); if (p && !addProduct(p, r.cantidad || 1)) fin = "No pude agregarlo. Revisa las existencias."; }
  else if (r.accion === "ayuda") { if (r.destino) goTab(r.destino, r.sub); openHelp(); }
  if (nav) { if (r.accion !== "ayuda") toast(fin); if ($("#ttsOn").checked) speak(fin); }
  else show(fin);
}
function toggleAsst(open, keepVoice) {
  asst.hidden = !open; $("#asstBtn").setAttribute("aria-expanded", open);
  if (open) {
    msg.textContent = voice.ok ? "Te escucho. Di qué quieres hacer, o toca una opción." : "Toca una opción o escribe lo que necesitas.";
    voice.start();
  } else { voice.stop(); if (!keepVoice) speechSynthesis?.cancel(); }
}
const voice = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition, mic = $("#mic");
  if (!SR) { mic.hidden = true; $("#typedBox").hidden = false; return { ok: false, start() {}, stop() {} }; }
  const rec = new SR(); rec.lang = "es-MX"; rec.interimResults = false; let on = false;
  const off = () => { on = false; mic.classList.remove("on"); mic.textContent = "🎤 Hablar"; };
  rec.onresult = e => pedir(e.results[0][0].transcript);
  rec.onend = off;
  rec.onerror = () => { off(); msg.textContent = "No te escuché. Toca el micrófono para intentar otra vez."; };
  const start = () => { if (on) return; speechSynthesis?.cancel(); try { rec.start(); on = true; mic.classList.add("on"); mic.textContent = "Escuchando… (toca para parar)"; } catch {} };
  mic.onclick = () => on ? rec.stop() : start();
  return { ok: true, start, stop() { try { rec.stop(); } catch {} } };
})();
$("#asstBtn").onclick = () => toggleAsst(asst.hidden);
$("#asstClose").onclick = () => { toggleAsst(false); $("#asstBtn").focus(); };
asst.addEventListener("keydown", e => { if (e.key === "Escape") $("#asstClose").click(); });
$("#asstSend").onclick = () => { pedir($("#asstText").value); $("#asstText").value = ""; };
$("#asstText").onkeydown = e => { if (e.key === "Enter") $("#asstSend").click(); };
[["📥 Registrar un ticket", "Quiero registrar un ticket"], ["🛒 Vender", "Quiero vender"], ["📋 ¿Qué me falta?", "¿Qué me falta?"], ["💰 ¿Cuánto vendí hoy?", "¿Cuánto vendí hoy?"]]
  .forEach(([t, f]) => { const b = document.createElement("button"); b.className = "btn"; b.textContent = t; b.onclick = () => pedir(f); $("#opts").append(b); });

/* ============================ Inicio ============================ */
(async () => {
  if (API_URL && location.protocol === "https:" && API_URL.startsWith("http:")) toast("El servidor debe usar HTTPS para funcionar desde esta página.");
  else if (API_URL) { try { await http("/health"); } catch (e) { toast(e.message); } }
  await refresh(); renderCarrito();
  if (!db.get("visto", false)) { db.set("visto", true); openHelp(); }
})();