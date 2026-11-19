"use strict";

/* ============================================================
   CONFIGURACIÓN (completar al conectar)
   ============================================================ */
const API_URL = null;       // backend de datos. ej. "https://tu-servidor.com/api"
const AI_URL = null;        // endpoint de IA (tu servidor llama al modelo; NUNCA pongas llaves de API aquí)
const HELP_CONTACT = null;  // ej. "https://wa.me/52951XXXXXXX" para pedir ayuda a una persona

/* ============================================================
   CAPA DE DATOS: hoy localStorage; después cambia cada función por fetch()
   ============================================================ */
const db = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const DEMO = [
  { codigo: "7501000000011", nombre: "Refresco 600 ml", precio: 18, stock: 24 },
  { codigo: "7501000000028", nombre: "Arroz 1 kg", precio: 32.5, stock: 10 },
  { codigo: "7501000000035", nombre: "Galletas surtidas", precio: 22, stock: 3 },
  { codigo: "7501000000042", nombre: "Agua 1 L", precio: 12, stock: 40 },
];
const api = {
  async listarProductos() { return db.get("productos", DEMO); },       // TODO GET  /productos?pagina=&q=
  async listarMovimientos() { return db.get("movimientos", []); },     // TODO GET  /movimientos?pagina=&tipo=
  async crearEntrada(e) {                                              // TODO POST /entradas (multipart con la foto)
    const l = db.get("movimientos", []);
    l.unshift({ id: uid(), tipo: "entrada", fecha: new Date().toISOString(), estado: "pendiente", ...e });
    db.set("movimientos", l);
  },
  async crearVenta(v) {                                                // TODO POST /ventas
    const ps = await api.listarProductos();
    v.items.forEach(i => { const p = ps.find(x => x.codigo === i.codigo); if (p) p.stock = Math.max(0, p.stock - i.cantidad); });
    db.set("productos", ps);
    const l = db.get("movimientos", []);
    l.unshift({ id: uid(), tipo: "venta", fecha: new Date().toISOString(), ...v });
    db.set("movimientos", l);
  },
};

/* ============================ Utilidades ============================ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const money = n => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
}
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = "es-MX"; u.rate = 0.95;
  speechSynthesis.speak(u);
}

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
  if (name === "registro") { if (sub) setSub(sub); renderRegistro(); }
  $("#h-" + name)?.focus?.();
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

/* ============================ RECIBIR (solo foto) ============================ */
let photoBlob = null;
const photo = (() => {
  const cam = makeCamera($("#photoVideo"));
  const show = blob => {
    photoBlob = blob; const img = $("#photoPreview");
    img.src = URL.createObjectURL(blob); img.hidden = false; $("#photoEmpty").hidden = true;
  };
  $("#photoOpen").onclick = async () => {
    try { await cam.start(); $("#photoPreview").hidden = true; $("#photoEmpty").hidden = true; $("#photoSnap").hidden = false; $("#photoOpen").hidden = true; }
    catch (e) { toast(e.message || "No se pudo abrir la cámara. Puedes subir una imagen."); }
  };
  $("#photoSnap").onclick = () => {
    const v = $("#photoVideo"), c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight; c.getContext("2d").drawImage(v, 0, 0);
    c.toBlob(b => { show(b); photo.stop(); toast("Foto tomada. Revisa que el ticket se lea bien."); }, "image/jpeg", 0.85);
  };
  $("#photoFile").onchange = e => { if (e.target.files[0]) { cam.stop(); show(e.target.files[0]); } };
  return { stop() { cam.stop(); $("#photoSnap").hidden = true; $("#photoOpen").hidden = false; } };
})();
$("#guardarEntrada").onclick = async () => {
  if (!photoBlob) return toast("Primero toma o sube una foto del ticket.");
  await api.crearEntrada({ proveedor: $("#proveedor").value.trim(), archivo: photoBlob.type, tamano: photoBlob.size }); // TODO: subir photoBlob
  photoBlob = null; $("#photoPreview").hidden = true; $("#photoEmpty").hidden = false; $("#proveedor").value = "";
  toast("Entrada registrada. Queda pendiente de enviar.");
};

/* ============================ VENDER ============================ */
let catalogo = [], carrito = [];
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
      if (!("BarcodeDetector" in window)) return toast("Este navegador no lee códigos con la cámara. Usa el campo manual o Chrome/Edge."); // TODO: ZXing
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

function addByCode(code, qty = 1) {
  const p = catalogo.find(x => x.codigo === String(code).trim());
  if (!p) { toast("El código " + code + " no está en el catálogo."); return false; }
  const it = carrito.find(i => i.codigo === p.codigo);
  if ((it?.cantidad || 0) + qty > p.stock) { toast("No hay suficientes existencias de " + p.nombre); return false; }
  it ? it.cantidad += qty : carrito.push({ codigo: p.codigo, nombre: p.nombre, precio: p.precio, cantidad: qty });
  navigator.vibrate?.(40); renderCarrito(); return true;
}
function renderCarrito() {
  $("#cartList").innerHTML = carrito.map(i => `
    <li><div>${esc(i.nombre)}<small>${money(i.precio)}</small></div>
    <div class="qty"><button data-d="-1" data-c="${i.codigo}" aria-label="Quitar uno de ${esc(i.nombre)}">−</button>
    <span>${i.cantidad}</span><button data-d="1" data-c="${i.codigo}" aria-label="Agregar uno de ${esc(i.nombre)}">+</button></div></li>`).join("");
  $("#cartTotal").textContent = money(carrito.reduce((s, i) => s + i.precio * i.cantidad, 0));
  $("#cartEmpty").hidden = carrito.length > 0; $("#payNfc").disabled = !carrito.length;
}
$("#cartList").onclick = e => {
  const b = e.target.closest("button"); if (!b) return;
  const i = carrito.find(x => x.codigo === b.dataset.c);
  if (b.dataset.d === "1") return addByCode(i.codigo);
  if (--i.cantidad <= 0) carrito = carrito.filter(x => x !== i);
  renderCarrito();
};
$("#cartClear").onclick = () => { carrito = []; renderCarrito(); };
const manual = () => { const v = $("#codigoManual").value.trim(); if (v) addByCode(v); $("#codigoManual").value = ""; };
$("#codigoAdd").onclick = manual;
$("#codigoManual").onkeydown = e => { if (e.key === "Enter") manual(); };

$("#payNfc").onclick = async () => {
  const st = $("#nfcStatus"), total = carrito.reduce((s, i) => s + i.precio * i.cantidad, 0);
  const cerrar = async ref => {
    await api.crearVenta({ items: carrito, total, metodo: "nfc", referencia: ref }); // TODO: cobro real
    carrito = []; renderCarrito(); catalogo = await api.listarProductos(); st.textContent = ""; toast("Venta registrada: " + money(total));
  };
  if (!("NDEFReader" in window)) {
    st.textContent = "NFC no disponible en este dispositivo.";
    if (confirm("NFC no está disponible aquí. ¿Simular el pago para probar?")) await cerrar("simulado");
    return;
  }
  try { const r = new NDEFReader(); await r.scan(); st.textContent = "Acerca la tarjeta o el teléfono del cliente…"; r.onreading = e => cerrar(e.serialNumber || "nfc"); }
  catch { st.textContent = "No se pudo iniciar NFC. Revisa los permisos."; }
};

/* ============================ REGISTRO (inventarios grandes) ============================
   Búsqueda + filtros + orden + paginación de 20 en 20.
   Con inventarios muy grandes, mueve el filtrado y la paginación al servidor
   (parámetros q, filtro, orden, pagina) y aquí solo pinta la página recibida. */
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
const estado = s => s === 0 ? ["out", "Agotado"] : s <= 5 ? ["low", "Por surtir"] : ["ok", "Disponible"];

async function renderRegistro() {
  const prods = await api.listarProductos(), movs = await api.listarMovimientos();
  if (!$("#sub-stock").hidden) {
    const q = norm($("#stockQ").value), f = $("#stockF").value, s = $("#stockS").value;
    let l = prods.filter(p => (!q || norm(p.nombre).includes(q) || p.codigo.includes(q)) &&
      (f === "all" || (f === "low" ? p.stock <= 5 : p.stock === 0)));
    l.sort(s === "stock" ? (a, b) => a.stock - b.stock : s === "price" ? (a, b) => a.precio - b.precio : (a, b) => a.nombre.localeCompare(b.nombre, "es"));
    $("#stockCount").textContent = l.length ? `${l.length} de ${prods.length} productos` : "No hay productos con ese filtro. Prueba otra búsqueda.";
    const pg = l.slice((view.stock.p - 1) * PAGE, view.stock.p * PAGE);
    $("#stockList").innerHTML = pg.map(p => { const [c, t] = estado(p.stock);
      return `<li><div>${esc(p.nombre)}<small>${esc(p.codigo)} · ${money(p.precio)}</small></div>
      <div class="meta"><span><strong>${p.stock}</strong> pzas</span><span class="tag ${c}">${t}</span></div></li>`; }).join("");
    pager("stock", l.length, view.stock, renderRegistro);
  } else {
    const q = norm($("#logQ").value), f = $("#logF").value;
    const l = movs.filter(m => (f === "all" || m.tipo === f) &&
      (!q || norm(JSON.stringify([m.proveedor, m.items?.map(i => i.nombre)])).includes(q)));
    $("#logCount").textContent = l.length ? `${l.length} movimientos` : "Aún no hay movimientos con ese filtro.";
    const pg = l.slice((view.log.p - 1) * PAGE, view.log.p * PAGE);
    $("#logList").innerHTML = pg.map(m => {
      const fe = new Date(m.fecha).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
      const d = m.tipo === "venta" ? `Venta de ${m.items.reduce((s, i) => s + i.cantidad, 0)} pzas · ${money(m.total)}`
        : `Ticket recibido${m.proveedor ? " de " + esc(m.proveedor) : ""} · ${m.estado}`;
      return `<li><div>${d}<small>${fe}</small></div><span class="tag ${m.tipo === "venta" ? "sale" : "in"}">${m.tipo === "venta" ? "Venta" : "Entrada"}</span></li>`;
    }).join("");
    pager("log", l.length, view.log, renderRegistro);
  }
}
["stockQ", "stockF", "stockS", "logQ", "logF"].forEach(id => $("#" + id).addEventListener("input", () => { view.stock.p = view.log.p = 1; renderRegistro(); }));

/* ============================ AYUDA ============================ */
const HELP = {
  recibir: ["Toca «Abrir cámara» y apunta al ticket del proveedor.", "Toca «Tomar foto». Revisa que las letras se vean claras.", "Si no sale bien, toca «Abrir cámara» otra vez. También puedes subir una imagen.", "Toca «Registrar entrada» para guardarla."],
  vender: ["Toca «Abrir cámara» y acerca el código de barras del producto. Suena y se agrega solo.", "Si no lee, escribe los números del código y toca «Agregar».", "Usa + y − para cambiar cantidades. El total aparece abajo.", "Toca «Pagar con NFC» y acerca la tarjeta o el teléfono del cliente."],
  registro: ["En «Productos disponibles» busca por nombre y mira qué se está acabando.", "Elige «Por surtir» para ver solo lo que hay que comprar.", "En «Movimientos» ves lo que entró y lo que se vendió."],
  asistente: ["Toca «Asistente» y luego «Hablar», o escribe.", "Puedes decir: «quiero registrar un ticket», «vender refresco», «qué me falta», «cuánto vendí hoy».", "Te contesta con voz. Puedes apagar la voz en el mismo cuadro."],
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

/* ============================ ASISTENTE (voz + IA) ============================
   Contrato con la IA: POST AI_URL  { texto, contexto:{ seccion, faltantes:[...] } }
   Respuesta: { accion:"ir"|"vender"|"responder", destino?, sub?, producto?, cantidad?, respuesta }
   Mientras AI_URL sea null se usan reglas locales (funcionan sin conexión). */
const asst = $("#asst"), log = $("#asstLog");
function say(text, who = "bot") {
  const d = document.createElement("div"); d.className = "msg " + who; d.textContent = text; log.append(d); log.scrollTop = log.scrollHeight;
  if (who === "bot" && $("#ttsOn").checked) speak(text);
}
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
    return { accion: "responder", respuesta: f.length ? "Te conviene surtir: " + f.map(p => `${p.nombre} (${p.stock})`).join(", ") + "." : "Por ahora tienes suficiente de todo." };
  }
  if (/cuanto (vendi|llevo|he vendido)|ventas de hoy/.test(t)) {
    const hoy = new Date().toDateString(), total = db.get("movimientos", []).filter(m => m.tipo === "venta" && new Date(m.fecha).toDateString() === hoy).reduce((s, m) => s + m.total, 0);
    return { accion: "responder", respuesta: total ? "Hoy llevas " + money(total) + " en ventas." : "Todavía no hay ventas registradas hoy." };
  }
  const q = t.match(/cuanto(?:s)? (?:hay|tengo|queda(?:n)?) (?:de )?(.+)/);
  if (q) { const p = buscar(q[1]); return { accion: "responder", respuesta: p ? `De ${p.nombre} tienes ${p.stock}.` : "No encontré ese producto." }; }
  if (/vender|vendo|vendi|cobrar|agrega|agregar|\bventa\b/.test(t)) {
    const p = buscar(t.replace(/vender|vendo|vendi|cobrar|agregar|agrega|venta/g, ""));
    return { accion: "vender", producto: p?.codigo, cantidad: n, respuesta: p ? `Listo, agregué ${n} ${p.nombre} al carrito.` : "Abrí Vender. Escanea el producto con la cámara." };
  }
  if (/movimiento|historial/.test(t)) return { accion: "ir", destino: "registro", sub: "log", respuesta: "Aquí están los movimientos." };
  if (/inventario|registro|existencia|productos disponibles/.test(t)) return { accion: "ir", destino: "registro", sub: "stock", respuesta: "Aquí está tu inventario." };
  if (/ticket|tiket|recib|llego|llegaron|mercancia|entrada|proveedor/.test(t)) return { accion: "ir", destino: "recibir", respuesta: "Abrí Recibir. Toma una foto del ticket." };
  return { accion: "responder", respuesta: "No te entendí bien. Puedes decir: registrar un ticket, vender algo, qué me falta o cuánto vendí hoy." };
}
async function interpretar(texto) {
  if (AI_URL) {
    try {
      const r = await fetch(AI_URL, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto, contexto: { seccion: current, faltantes: faltantes().map(p => ({ nombre: p.nombre, stock: p.stock })) } }) });
      if (r.ok) return await r.json();
    } catch {}
  }
  return intentoLocal(texto);
}
async function pedir(texto) {
  texto = texto.trim(); if (!texto) return;
  say(texto, "me"); catalogo = await api.listarProductos();
  const r = await interpretar(texto);
  if (r.accion === "ir") goTab(r.destino, r.sub);
  if (r.accion === "vender") { goTab("vender"); if (r.producto && !addByCode(r.producto, r.cantidad || 1)) r.respuesta = "No pude agregarlo. Revisa las existencias."; }
  if (r.accion === "ayuda") openHelp();
  say(r.respuesta);
}
function toggleAsst(open) {
  asst.hidden = !open; $("#asstBtn").setAttribute("aria-expanded", open);
  if (open) { if (!log.children.length) say("Hola, soy tu asistente. Dime qué quieres hacer."); $("#asstText").focus(); } else speechSynthesis?.cancel();
}
$("#asstBtn").onclick = () => toggleAsst(asst.hidden);
$("#asstClose").onclick = () => { toggleAsst(false); $("#asstBtn").focus(); };
asst.addEventListener("keydown", e => { if (e.key === "Escape") $("#asstClose").click(); });
$("#asstSend").onclick = () => { pedir($("#asstText").value); $("#asstText").value = ""; };
$("#asstText").onkeydown = e => { if (e.key === "Enter") $("#asstSend").click(); };
["Quiero registrar un ticket", "Quiero vender", "¿Qué me falta?", "¿Cuánto vendí hoy?"].forEach(s => {
  const b = document.createElement("button"); b.className = "chip"; b.textContent = s; b.onclick = () => pedir(s); $("#sugg").append(b);
});
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition, mic = $("#mic");
  if (!SR) { mic.disabled = true; mic.title = "Tu navegador no reconoce voz. Escribe tu pedido."; return; }
  const rec = new SR(); rec.lang = "es-MX"; rec.interimResults = false;
  rec.onresult = e => pedir(e.results[0][0].transcript);
  rec.onend = () => { mic.classList.remove("on"); mic.textContent = "🎤 Hablar"; };
  rec.onerror = () => toast("No te escuché. Intenta otra vez o escribe.");
  mic.onclick = () => { speechSynthesis?.cancel(); mic.classList.add("on"); mic.textContent = "Escuchando…"; try { rec.start(); } catch {} };
})();

/* ============================ Inicio ============================ */
(async () => {
  catalogo = await api.listarProductos(); renderCarrito();
  if (!db.get("visto", false)) { db.set("visto", true); openHelp(); }   // primera visita: guía de bienvenida
})();
