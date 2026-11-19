"use strict";

/* ============================================================
   CAPA DE DATOS (api)
   Hoy guarda en localStorage. Cuando exista el backend, pon
   API_URL y cambia el cuerpo de cada función por un fetch().
   El resto de la app no necesita cambios.
   ============================================================ */
const API_URL = null; // ej. "https://tu-servidor.com/api"

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
  // TODO: GET  {API_URL}/productos
  async listarProductos() { return db.get("productos", DEMO); },
  // TODO: GET  {API_URL}/movimientos
  async listarMovimientos() { return db.get("movimientos", []); },
  // TODO: POST {API_URL}/entradas  (multipart: archivo foto/audio o JSON con texto)
  async crearEntrada(entrada) {
    const lista = db.get("movimientos", []);
    lista.unshift({ id: uid(), tipo: "entrada", fecha: new Date().toISOString(), estado: "pendiente", ...entrada });
    db.set("movimientos", lista);
  },
  // TODO: POST {API_URL}/ventas  (JSON: items, total, metodo, referencia)
  async crearVenta(venta) {
    const productos = await api.listarProductos();
    venta.items.forEach(i => {
      const p = productos.find(x => x.codigo === i.codigo);
      if (p) p.stock = Math.max(0, p.stock - i.cantidad);
    });
    db.set("productos", productos);
    const lista = db.get("movimientos", []);
    lista.unshift({ id: uid(), tipo: "venta", fecha: new Date().toISOString(), ...venta });
    db.set("movimientos", lista);
  },
};

/* ============================ Utilidades ============================ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const money = n => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

/* ============================ Pestañas ============================ */
$$(".tabs button").forEach(b => b.addEventListener("click", () => {
  $$(".tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
  $$(".panel").forEach(p => p.hidden = p.id !== "tab-" + b.dataset.tab);
  if (b.dataset.tab !== "vender") scanner.stop();
  if (b.dataset.tab !== "recibir") { photo.stop(); }
  if (b.dataset.tab === "registro") renderRegistro();
}));

/* ============================ Cámara (compartida) ============================ */
function makeCamera(video) {
  let stream = null;
  return {
    get active() { return !!stream; },
    async start() {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador no permite usar la cámara (se requiere HTTPS).");
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      video.srcObject = stream; video.hidden = false; await video.play();
    },
    stop() {
      stream?.getTracks().forEach(t => t.stop()); stream = null;
      video.srcObject = null; video.hidden = true;
    },
  };
}

/* ============================ RECIBIR ============================ */
let mode = "foto", photoBlob = null, audioBlob = null;

$$(".seg button").forEach(b => b.addEventListener("click", () => {
  mode = b.dataset.mode;
  $$(".seg button").forEach(x => x.setAttribute("aria-pressed", x === b));
  $$(".mode").forEach(m => m.hidden = m.id !== "mode-" + mode);
  if (mode !== "foto") photo.stop();
}));

const photo = (() => {
  const cam = makeCamera($("#photoVideo"));
  const show = blob => {
    photoBlob = blob;
    const img = $("#photoPreview"); img.src = URL.createObjectURL(blob);
    img.hidden = false; $("#photoEmpty").hidden = true;
  };
  $("#photoOpen").addEventListener("click", async () => {
    try {
      await cam.start();
      $("#photoPreview").hidden = true; $("#photoEmpty").hidden = true;
      $("#photoSnap").hidden = false; $("#photoOpen").hidden = true;
    } catch (e) { toast(e.message); }
  });
  $("#photoSnap").addEventListener("click", () => {
    const v = $("#photoVideo"), c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    c.toBlob(b => { show(b); photo.stop(); }, "image/jpeg", 0.85);
  });
  $("#photoFile").addEventListener("change", e => { if (e.target.files[0]) { cam.stop(); show(e.target.files[0]); } });
  return { stop() { cam.stop(); $("#photoSnap").hidden = true; $("#photoOpen").hidden = false; } };
})();

(() => {
  let rec, chunks = [], t0, tick;
  const btn = $("#audioRec"), timer = $("#audioTimer");
  btn.addEventListener("click", async () => {
    if (rec?.state === "recording") { rec.stop(); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      rec = new MediaRecorder(s); chunks = [];
      rec.ondataavailable = e => chunks.push(e.data);
      rec.onstop = () => {
        s.getTracks().forEach(t => t.stop()); clearInterval(tick);
        audioBlob = new Blob(chunks, { type: rec.mimeType });
        const a = $("#audioPreview"); a.src = URL.createObjectURL(audioBlob); a.hidden = false;
        timer.classList.remove("rec"); btn.textContent = "Grabar de nuevo";
      };
      rec.start(); t0 = Date.now(); timer.classList.add("rec"); btn.textContent = "Detener";
      tick = setInterval(() => {
        const s = Math.floor((Date.now() - t0) / 1000);
        timer.textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
      }, 250);
    } catch { toast("No se pudo acceder al micrófono."); }
  });
})();

$("#guardarEntrada").addEventListener("click", async () => {
  const proveedor = $("#proveedor").value.trim();
  const base = { formato: mode, proveedor };
  if (mode === "foto") {
    if (!photoBlob) return toast("Toma o sube una foto del ticket primero.");
    await api.crearEntrada({ ...base, archivo: photoBlob.type, tamano: photoBlob.size }); // TODO: subir photoBlob
    photoBlob = null; $("#photoPreview").hidden = true; $("#photoEmpty").hidden = false;
  } else if (mode === "audio") {
    if (!audioBlob) return toast("Graba un audio primero.");
    await api.crearEntrada({ ...base, archivo: audioBlob.type, tamano: audioBlob.size }); // TODO: subir audioBlob
    audioBlob = null; $("#audioPreview").hidden = true; $("#audioTimer").textContent = "00:00"; $("#audioRec").textContent = "Grabar";
  } else {
    const texto = $("#textoEntrada").value.trim();
    if (!texto) return toast("Escribe qué mercancía recibiste.");
    await api.crearEntrada({ ...base, texto });
    $("#textoEntrada").value = "";
  }
  $("#proveedor").value = "";
  toast("Entrada registrada (pendiente de enviar)");
});

/* ============================ VENDER ============================ */
let catalogo = [], carrito = [];

const scanner = (() => {
  const video = $("#scanVideo"), cam = makeCamera(video);
  let detector = null, timer = null, lastCode = "", lastAt = 0;
  async function loop() {
    if (!cam.active) return;
    try {
      const found = await detector.detect(video);
      const now = Date.now();
      if (found[0] && (found[0].rawValue !== lastCode || now - lastAt > 2000)) {
        lastCode = found[0].rawValue; lastAt = now; addByCode(lastCode);
      }
    } catch {}
    timer = setTimeout(loop, 250);
  }
  const api_ = {
    async start() {
      if (!("BarcodeDetector" in window)) {
        // TODO: alternativa para Safari/Firefox, p. ej. la librería ZXing (@zxing/browser)
        return toast("Este navegador no lee códigos con la cámara. Usa el campo manual o Chrome/Edge.");
      }
      try {
        detector ||= new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"] });
        await cam.start();
        $("#scanEmpty").hidden = true; $("#reticle").hidden = false; $("#scanToggle").textContent = "Cerrar cámara";
        loop();
      } catch (e) { toast(e.message || "No se pudo abrir la cámara."); }
    },
    stop() {
      clearTimeout(timer); cam.stop();
      $("#reticle").hidden = true; $("#scanEmpty").hidden = false; $("#scanToggle").textContent = "Abrir cámara";
    },
  };
  $("#scanToggle").addEventListener("click", () => cam.active ? api_.stop() : api_.start());
  return api_;
})();

function addByCode(code) {
  const p = catalogo.find(x => x.codigo === code.trim());
  if (!p) return toast("Código " + code + " no está en el catálogo.");
  const item = carrito.find(i => i.codigo === p.codigo);
  const enCarrito = item ? item.cantidad : 0;
  if (enCarrito >= p.stock) return toast("Sin existencias de " + p.nombre);
  item ? item.cantidad++ : carrito.push({ codigo: p.codigo, nombre: p.nombre, precio: p.precio, cantidad: 1 });
  if (navigator.vibrate) navigator.vibrate(40);
  renderCarrito();
}

function renderCarrito() {
  $("#cartList").innerHTML = carrito.map(i => `
    <li><div>${esc(i.nombre)}<small>${money(i.precio)}</small></div>
      <div class="qty"><button data-d="-1" data-c="${i.codigo}" aria-label="Quitar uno">−</button>
      <span>${i.cantidad}</span><button data-d="1" data-c="${i.codigo}" aria-label="Agregar uno">+</button></div></li>`).join("");
  const total = carrito.reduce((s, i) => s + i.precio * i.cantidad, 0);
  $("#cartTotal").textContent = money(total);
  $("#cartEmpty").hidden = carrito.length > 0;
  $("#payNfc").disabled = carrito.length === 0;
}
$("#cartList").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const i = carrito.find(x => x.codigo === b.dataset.c);
  if (b.dataset.d === "1") return addByCode(i.codigo);
  if (--i.cantidad <= 0) carrito = carrito.filter(x => x !== i);
  renderCarrito();
});
$("#cartClear").addEventListener("click", () => { carrito = []; renderCarrito(); });
$("#codigoAdd").addEventListener("click", manual);
$("#codigoManual").addEventListener("keydown", e => { if (e.key === "Enter") manual(); }); // los lectores USB envían Enter
function manual() { const v = $("#codigoManual").value.trim(); if (v) addByCode(v); $("#codigoManual").value = ""; }

/* ---- Pago con NFC ----
   Web NFC (NDEFReader) solo funciona en Chrome para Android y con HTTPS.
   Lee una etiqueta o tarjeta NFC como confirmación; el cobro real
   se conectará después a tu procesador de pagos. */
$("#payNfc").addEventListener("click", async () => {
  const status = $("#nfcStatus");
  const total = carrito.reduce((s, i) => s + i.precio * i.cantidad, 0);
  const cerrar = async referencia => {
    await api.crearVenta({ items: carrito, total, metodo: "nfc", referencia }); // TODO: cobro real
    carrito = []; renderCarrito(); catalogo = await api.listarProductos();
    status.textContent = ""; toast("Venta registrada: " + money(total));
  };
  if (!("NDEFReader" in window)) {
    status.textContent = "NFC no disponible en este dispositivo.";
    if (confirm("NFC no está disponible aquí. ¿Simular el pago para probar?")) await cerrar("simulado");
    return;
  }
  try {
    const reader = new NDEFReader(); await reader.scan();
    status.textContent = "Acerca la tarjeta o el teléfono del cliente…";
    reader.onreading = e => cerrar(e.serialNumber || "nfc");
  } catch { status.textContent = "No se pudo iniciar NFC. Revisa los permisos."; }
});

/* ============================ REGISTRO ============================ */
async function renderRegistro() {
  const prods = await api.listarProductos(), movs = await api.listarMovimientos();
  $("#stockList").innerHTML = prods.map(p => `
    <li><div>${esc(p.nombre)}<small>${esc(p.codigo)} · ${money(p.precio)}</small></div>
    <span class="${p.stock <= 5 ? "low" : ""}">${p.stock} pzas</span></li>`).join("");
  $("#logEmpty").hidden = movs.length > 0;
  $("#logList").innerHTML = movs.slice(0, 30).map(m => {
    const f = new Date(m.fecha).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
    const detalle = m.tipo === "venta" ? `${m.items.length} producto(s) · ${money(m.total)}`
      : `${m.formato}${m.proveedor ? " · " + esc(m.proveedor) : ""}${m.texto ? " · " + esc(m.texto.slice(0, 50)) : ""}`;
    return `<li><div>${detalle}<small>${f}</small></div><span class="tag ${m.tipo === "venta" ? "out" : "in"}">${m.tipo}</span></li>`;
  }).join("");
}

/* ============================ Inicio ============================ */
(async () => { catalogo = await api.listarProductos(); renderCarrito(); })();
