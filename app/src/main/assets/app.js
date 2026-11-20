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
const money = n => Number(n || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const num = n => +Number(n).toFixed(2);

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "es-MX";
  u.rate = 0.95;
  speechSynthesis.speak(u);
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 1046.5;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    if (navigator.vibrate) navigator.vibrate(80);
  } catch {}
}

/* ============================================================
   CAPA DE DATOS
   Con API_URL usa el backend FastAPI + MySQL (miscelanea_ia).
   Sin API_URL funciona en modo demostración con localStorage.
   ============================================================ */
async function http(path, opts = {}) {
  let r;
  try {
    r = await fetch(API_URL + path, {
      ...opts,
      headers: {
        "ngrok-skip-browser-warning": "1",
        ...(opts.headers || {}),
      },
    });
  } catch {
    throw new Error("No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.");
  }
  if (!r.ok) {
    let d = "";
    try { d = (await r.json()).detail; } catch {}
    throw new Error((typeof d === "string" && d) || "El servidor no respondió bien (" + r.status + ").");
  }
  return r.json();
}
const JSON_POST = body => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const DEMO = [
  { codigo: "7501000000011", nombre: "Refresco 600 ml", precio: 18, stock: 24 },
  { codigo: "7501000000028", nombre: "Arroz 1 kg", precio: 32.5, stock: 10 },
  { codigo: "7501000000035", nombre: "Galletas surtidas", precio: 22, stock: 3 },
  { codigo: "7501000000042", nombre: "Agua 1 L", precio: 12, stock: 40 },
];

const api = {
  // GET /inventory -> [{id_producto, codigo_barras, nombre, precio, cantidad}]
  async listarProductos() {
    if (!API_URL) {
      return db.get("productos", DEMO).map(p => ({
        ...p,
        id: p.codigo || p.nombre,
        id_producto: null,
      }));
    }
    try {
      const ps = await http("/inventory");
      const sold = db.get("vendidoLocal", {});
      const out = ps.map(p => {
        const key = p.id_producto || p.codigo_barras || p.nombre;
        const precioVal = p.precio ?? p.precio_venta ?? null;
        const stockBase = p.cantidad ?? p.stock_actual ?? 0;
        return {
          id: key,
          id_producto: p.id_producto || null,
          codigo: p.codigo_barras || p.codigo || null,
          nombre: p.nombre,
          precio: precioVal != null ? Number(precioVal) : 0,
          sinPrecio: precioVal == null,
          stock: Math.max(0, Number(stockBase) - (sold[p.nombre] || 0)),
        };
      });
      db.set("cacheProductos", out);
      return out;
    } catch (e) {
      toast(e.message);
      return db.get("cacheProductos", []);
    }
  },

  // POST /products/quick -> alta rápida de producto al escanear código nuevo
  async crearProductoRapido(payload) {
    if (API_URL) {
      const res = await http("/products/quick", JSON_POST(payload));
      return {
        id: res.id_producto,
        id_producto: res.id_producto,
        codigo: res.codigo_barras,
        nombre: res.nombre,
        precio: Number(res.precio_venta),
        sinPrecio: false,
        stock: Number(res.stock_actual ?? payload.stock_actual ?? 0),
      };
    }
    const ps = db.get("productos", DEMO);
    const nuevo = {
      id: payload.codigo_barras,
      id_producto: null,
      codigo: payload.codigo_barras,
      nombre: payload.nombre,
      precio: Number(payload.precio_venta),
      sinPrecio: false,
      stock: Number(payload.stock_actual) || 0,
    };
    ps.push(nuevo);
    db.set("productos", ps);
    return nuevo;
  },

  async listarMovimientos() {
    return db.get("movimientos", []);
  },

  // POST /ticket/parse (multipart "file") -> ParsedTicket
  async leerTicket(blob) {
    if (API_URL) {
      const fd = new FormData();
      fd.append("file", blob, "ticket.jpg");
      return http("/ticket/parse", { method: "POST", body: fd });
    }
    await new Promise(r => setTimeout(r, 900));
    return {
      items: [
        { nombre: "Refresco 600 ml", cantidad: 12, precio: 15, confianza: 0.95, crudo: "REFR 600ML 12" },
        { nombre: "Arros 1kg", cantidad: 5, precio: 28, confianza: 0.5, crudo: "ARROS 1K 5" },
      ],
      total: 320,
      fecha: null,
      advertencias: ["Modo demostración: estos datos son de ejemplo."],
    };
  },

  // POST /inventory/bulk_add {items} -> Resultado
  async guardarEntrada(items, proveedor) {
    let r;
    if (API_URL) {
      r = await http("/inventory/bulk_add", JSON_POST({ items }));
    } else {
      const ps = db.get("productos", DEMO);
      items.forEach(i => {
        const p = ps.find(x => norm(x.nombre) === norm(i.nombre));
        p
          ? (p.stock += i.cantidad)
          : ps.push({ codigo: "", nombre: i.nombre, precio: i.precio || 0, stock: i.cantidad });
      });
      db.set("productos", ps);
      const lote = Date.now() % 1e9;
      const lotes = db.get("lotes", {});
      lotes[lote] = items;
      db.set("lotes", lotes);
      r = { ok: true, mensaje: `Listo. Se guardaron ${items.length} productos.`, lote };
    }
    if (r.ok) {
      const l = db.get("movimientos", []);
      l.unshift({ id: uid(), tipo: "entrada", fecha: new Date().toISOString(), n: items.length, proveedor, lote: r.lote });
      db.set("movimientos", l);
    }
    return r;
  },

  // POST /inventory/undo/{lote} -> Resultado
  async deshacer(lote) {
    let r;
    if (API_URL) {
      r = await http("/inventory/undo/" + lote, { method: "POST" });
    } else {
      const lotes = db.get("lotes", {});
      const items = lotes[lote] || [];
      const ps = db.get("productos", DEMO);
      items.forEach(i => {
        const p = ps.find(x => norm(x.nombre) === norm(i.nombre));
        if (p) p.stock = Math.max(0, p.stock - i.cantidad);
      });
      db.set("productos", ps);
      r = { ok: true, mensaje: "Listo. Se deshizo la entrada.", lote };
    }
    if (r.ok) db.set("movimientos", db.get("movimientos", []).filter(m => m.lote !== lote));
    return r;
  },

  // Ventas: descuenta existencias locales y guarda movimiento (listo para conectar POST /sales)
  async crearVenta(v) {
    if (API_URL) {
      const s = db.get("vendidoLocal", {});
      v.items.forEach(i => (s[i.nombre] = (s[i.nombre] || 0) + i.cantidad));
      db.set("vendidoLocal", s);
    } else {
      const ps = db.get("productos", DEMO);
      v.items.forEach(i => {
        const p = ps.find(x => (x.codigo || x.nombre) === i.id);
        if (p) p.stock = Math.max(0, p.stock - i.cantidad);
      });
      db.set("productos", ps);
    }
    const l = db.get("movimientos", []);
    l.unshift({ id: uid(), tipo: "venta", fecha: new Date().toISOString(), ...v });
    db.set("movimientos", l);
  },
};

let catalogo = [];
let carrito = [];
const refresh = async () => {
  catalogo = await api.listarProductos();
};

/* ============================ Accesibilidad y Ajustes ============================ */
let size = db.get("size", 1);
const applySize = () => {
  document.documentElement.dataset.size = size;
  db.set("size", size);
};
$("#sizeUp").onclick = () => { size = Math.min(2, size + 1); applySize(); };
$("#sizeDown").onclick = () => { size = Math.max(0, size - 1); applySize(); };

const setContrast = on => {
  document.documentElement.classList.toggle("hc", on);
  $("#contrast").setAttribute("aria-pressed", on);
  db.set("hc", on);
};
$("#contrast").onclick = () => setContrast(!db.get("hc", false));
applySize();
setContrast(db.get("hc", false));

$("#toolsBtn").onclick = () => {
  const open = $("#toolsBtn").getAttribute("aria-expanded") === "true";
  $("#toolsBtn").setAttribute("aria-expanded", String(!open));
  $("#tools").classList.toggle("open", !open);
};

$("#fileLabel").addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    $("#photoFile").click();
  }
});

/* ============================ Navegación ============================ */
let current = "recibir";
function goTab(name, sub) {
  current = name;
  $$(".tabs button").forEach(x => x.setAttribute("aria-selected", x.dataset.tab === name));
  $$(".panel").forEach(p => (p.hidden = p.id !== "tab-" + name));
  if (name !== "vender") scanner.stop();
  if (name !== "recibir") photo.stop();
  if (name === "vender" && !catalogo.length) refresh();
  if (name === "registro") {
    if (sub) setSub(sub);
    renderRegistro();
    refresh().then(renderRegistro);
  }
}
$$(".tabs button").forEach(b => b.addEventListener("click", () => goTab(b.dataset.tab)));

/* ============================ Cámara compartida (Recibir) ============================ */
function makeCamera(video) {
  let stream = null;
  return {
    get active() { return !!stream; },
    async start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("La cámara requiere HTTPS y un navegador compatible.");
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      video.srcObject = stream;
      video.hidden = false;
      await video.play();
    },
    stop() {
      stream?.getTracks().forEach(t => t.stop());
      stream = null;
      video.srcObject = null;
      video.hidden = true;
    },
  };
}

/* ============================ RECIBIR: foto -> revisar -> confirmar -> deshacer ============================ */
let photoBlob = null;
let review = null;
let lastLote = null;

const photo = (() => {
  const cam = makeCamera($("#photoVideo"));
  const show = blob => {
    photoBlob = blob;
    const img = $("#photoPreview");
    img.src = URL.createObjectURL(blob);
    img.hidden = false;
    $("#photoEmpty").hidden = true;
    $("#guardarEntrada").removeAttribute("aria-disabled");
  };
  $("#photoOpen").onclick = async () => {
    try {
      await cam.start();
      $("#photoPreview").hidden = true;
      $("#photoEmpty").hidden = true;
      $("#photoSnap").hidden = false;
      $("#photoOpen").hidden = true;
    } catch (e) {
      toast(e.message || "No se pudo abrir la cámara. Puedes subir una imagen.");
    }
  };
  $("#photoSnap").onclick = () => {
    const v = $("#photoVideo");
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    c.toBlob(b => {
      show(b);
      photo.stop();
      toast("Foto tomada. Toca «Leer ticket».");
    }, "image/jpeg", 0.85);
  };
  $("#photoFile").onchange = e => {
    if (e.target.files[0]) {
      cam.stop();
      show(e.target.files[0]);
    }
  };
  return {
    stop() {
      cam.stop();
      $("#photoSnap").hidden = true;
      $("#photoOpen").hidden = false;
    },
  };
})();

function resetRecibir() {
  photoBlob = null;
  review = null;
  $("#photoPreview").hidden = true;
  $("#photoEmpty").hidden = false;
  $("#proveedor").value = "";
  $("#guardarEntrada").setAttribute("aria-disabled", "true");
  $("#reviewBox").hidden = true;
  $("#captureBox").hidden = false;
}

$("#guardarEntrada").onclick = async () => {
  if (!photoBlob) return toast("Primero toma o sube una foto del ticket.");
  const b = $("#guardarEntrada");
  b.disabled = true;
  b.textContent = "Leyendo el ticket…";
  $("#undoBox").hidden = true;
  try {
    const t = await api.leerTicket(photoBlob);
    review = { items: t.items.map(i => ({ ...i })), proveedor: $("#proveedor").value.trim() };
    const dudas = review.items.filter(i => i.confianza < 0.7).length;
    $("#reviewHint").textContent = [
      review.items.length
        ? `Encontré ${review.items.length} productos. Revisa que estén bien.`
        : "No encontré productos. Agrégalos a mano o toma otra foto.",
      dudas ? `Los marcados «Revise este» (${dudas}) pueden estar mal.` : "",
      t.total != null ? `Total del ticket: ${money(t.total)}.` : "",
      t.fecha ? `Fecha: ${t.fecha}.` : "",
      ...(t.advertencias || []),
    ].filter(Boolean).join(" ");
    $("#captureBox").hidden = true;
    $("#reviewBox").hidden = false;
    renderReview();
  } catch (e) {
    toast(e.message || "No pude leer el ticket. Intenta con más luz.");
  } finally {
    b.disabled = false;
    b.textContent = "Leer ticket";
  }
};

function renderReview() {
  $("#reviewList").innerHTML = review.items.map((it, i) => `
    <li class="rev-li ${it.confianza < 0.7 ? "warn" : ""}">
      ${it.confianza < 0.7 ? `<span class="badge warn">Revise este</span>` : ""}
      <div class="row">
        <input type="text" data-i="${i}" data-f="nombre" value="${esc(it.nombre)}" placeholder="Nombre">
        <input type="number" step="0.5" min="0" data-i="${i}" data-f="cantidad" value="${it.cantidad}" placeholder="Cant." style="max-width:5.5rem">
        <input type="number" step="0.5" min="0" data-i="${i}" data-f="precio" value="${it.precio ?? ""}" placeholder="Precio" style="max-width:6rem">
        <button class="btn ghost" data-del="${i}" aria-label="Quitar">✕</button>
      </div>
    </li>
  `).join("");
}

$("#reviewList").oninput = e => {
  const i = e.target.dataset.i;
  const f = e.target.dataset.f;
  if (i == null) return;
  review.items[i][f] = f === "nombre" ? e.target.value : parseFloat(e.target.value) || 0;
};
$("#reviewList").onclick = e => {
  const d = e.target.dataset.del;
  if (d != null) {
    review.items.splice(Number(d), 1);
    renderReview();
  }
};
$("#reviewAdd").onclick = () => {
  review.items.push({ nombre: "", cantidad: 1, precio: 0, confianza: 1 });
  renderReview();
};
$("#reviewCancel").onclick = resetRecibir;
$("#reviewOk").onclick = async () => {
  const validos = review.items.filter(x => x.nombre.trim() && x.cantidad > 0);
  if (!validos.length) return toast("Agrega al menos un producto válido.");
  const b = $("#reviewOk");
  b.disabled = true;
  try {
    const r = await api.guardarEntrada(validos, review.proveedor);
    toast(r.mensaje || "Entrada guardada.");
    lastLote = r.lote || null;
    resetRecibir();
    if (lastLote) {
      $("#undoMsg").textContent = `Se guardaron ${validos.length} productos en el inventario.`;
      $("#undoBox").hidden = false;
    }
    await refresh();
  } catch (e) {
    toast(e.message);
  } finally {
    b.disabled = false;
  }
};
$("#undoBtn").onclick = async () => {
  if (!lastLote) return;
  try {
    const r = await api.deshacer(lastLote);
    toast(r.mensaje || "Entrada deshecha.");
    $("#undoBox").hidden = true;
    lastLote = null;
    await refresh();
  } catch (e) {
    toast(e.message);
  }
};

/* ============================ VENDER: Escáner, Carrito y Pago ============================ */
function addToCart(prod) {
  const key = prod.id_producto || prod.codigo || prod.nombre;
  const item = carrito.find(x => x.id === key);
  if (item) {
    item.cantidad += 1;
  } else {
    carrito.push({
      id: key,
      id_producto: prod.id_producto || null,
      codigo: prod.codigo || null,
      nombre: prod.nombre,
      precio: Number(prod.precio) || 0,
      cantidad: 1,
    });
  }
  beep();
  renderCart();
  toast(`+1 ${prod.nombre}`);
}

async function handleBarcode(rawCode) {
  const code = String(rawCode || "").trim();
  if (!code) return;

  if (!catalogo.length) await refresh();
  const found = catalogo.find(p => p.codigo && String(p.codigo).trim() === code);

  if (found) {
    addToCart(found);
  } else {
    const dlg = $("#newProdDlg");
    if (!dlg) {
      toast(`Código ${code} no registrado en inventario.`);
      return;
    }
    scanner.pause();
    $("#npCodigo").value = code;
    $("#npCodigoText").textContent = code;
    $("#npNombre").value = "";
    $("#npPrecio").value = "";
    $("#npStock").value = "10";
    dlg.showModal();
    setTimeout(() => $("#npNombre").focus(), 100);
  }
}

if ($("#npCancel")) {
  $("#npCancel").onclick = () => {
    $("#newProdDlg").close();
    scanner.resume();
  };
}

if ($("#newProdForm")) {
  $("#newProdForm").onsubmit = async e => {
    e.preventDefault();
    const btn = $("#npSave");
    btn.disabled = true;
    const payload = {
      codigo_barras: $("#npCodigo").value.trim(),
      nombre: $("#npNombre").value.trim(),
      precio_venta: parseFloat($("#npPrecio").value),
      stock_actual: parseFloat($("#npStock").value) || 0,
    };
    try {
      const nuevoProd = await api.crearProductoRapido(payload);
      catalogo.push(nuevoProd);
      $("#newProdDlg").close();
      addToCart(nuevoProd);
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      scanner.resume();
    }
  };
}

const scanner = (() => {
  let html5Qr = null;
  let running = false;
  let paused = false;
  let lastCode = "";
  let lastTime = 0;

  const viewport = $("#tab-vender .viewport");
  const readerDiv = document.createElement("div");
  readerDiv.id = "qrReader";
  readerDiv.style.width = "100%";
  readerDiv.hidden = true;
  if (viewport) viewport.insertBefore(readerDiv, $("#scanEmpty"));

  async function start() {
    if (running) return;
    if (typeof Html5Qrcode === "undefined") {
      toast("No se cargó la librería del escáner. Revisa tu conexión.");
      return;
    }
    try {
      $("#scanEmpty").hidden = true;
      readerDiv.hidden = false;
      html5Qr = new Html5Qrcode("qrReader");
      await html5Qr.start(
        { facingMode: "environment" },
        {
          fps: 12,
          qrbox: { width: 250, height: 130 },
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
          ],
        },
        decodedText => {
          if (paused) return;
          const now = Date.now();
          if (decodedText === lastCode && now - lastTime < 1800) return;
          lastCode = decodedText;
          lastTime = now;
          handleBarcode(decodedText);
        },
        () => {}
      );
      running = true;
      paused = false;
      $("#scanToggle").textContent = "Cerrar cámara";
    } catch (e) {
      readerDiv.hidden = true;
      $("#scanEmpty").hidden = false;
      toast("No se pudo abrir la cámara: " + (e?.message || e));
    }
  }

  async function stop() {
    if (!running || !html5Qr) return;
    try {
      await html5Qr.stop();
      html5Qr.clear();
    } catch {}
    running = false;
    paused = false;
    readerDiv.hidden = true;
    $("#scanEmpty").hidden = false;
    $("#scanToggle").textContent = "Abrir cámara";
  }

  return {
    start,
    stop,
    pause() { paused = true; },
    resume() { paused = false; lastCode = ""; },
  };
})();

$("#scanToggle").onclick = () => {
  const isOpen = $("#scanToggle").textContent === "Cerrar cámara";
  isOpen ? scanner.stop() : scanner.start();
};

$("#codigoAdd").onclick = () => {
  const input = $("#codigoManual");
  handleBarcode(input.value);
  input.value = "";
  input.focus();
};

$("#codigoManual").addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    $("#codigoAdd").click();
  }
});

// Búsqueda por nombre en la pestaña Vender
$("#nombreBuscar").oninput = async e => {
  const q = norm(e.target.value.trim());
  const resBox = $("#nombreRes");
  if (!q) {
    resBox.innerHTML = "";
    return;
  }
  if (!catalogo.length) await refresh();
  const matches = catalogo
    .filter(p => norm(p.nombre).includes(q) || (p.codigo && p.codigo.includes(q)))
    .slice(0, 8);
  resBox.innerHTML = matches.map((p, idx) => `
    <button type="button" class="btn ghost" data-pick="${idx}">
      ${esc(p.nombre)} · <strong>${money(p.precio)}</strong>
    </button>
  `).join("");
  resBox.onclick = ev => {
    const btn = ev.target.closest("[data-pick]");
    if (!btn) return;
    addToCart(matches[Number(btn.dataset.pick)]);
    $("#nombreBuscar").value = "";
    resBox.innerHTML = "";
  };
};

function cartTotal() {
  return num(carrito.reduce((s, i) => s + i.precio * i.cantidad, 0));
}

function renderCart() {
  const list = $("#cartList");
  const empty = $("#cartEmpty");
  const total = cartTotal();

  empty.hidden = carrito.length > 0;
  list.innerHTML = carrito.map((it, idx) => `
    <li class="cart-li">
      <div>
        <strong>${esc(it.nombre)}</strong>
        <small>${money(it.precio)} × ${it.cantidad} = <strong>${money(it.precio * it.cantidad)}</strong></small>
      </div>
      <div class="row">
        <button type="button" class="btn ghost" data-cact="dec" data-ci="${idx}" aria-label="Quitar uno">−</button>
        <span>${it.cantidad}</span>
        <button type="button" class="btn ghost" data-cact="inc" data-ci="${idx}" aria-label="Agregar uno">+</button>
      </div>
    </li>
  `).join("");

  $("#cartTotal").textContent = money(total);
  $("#payNfc").disabled = total <= 0;
}

$("#cartList").onclick = e => {
  const btn = e.target.closest("[data-cact]");
  if (!btn) return;
  const idx = Number(btn.dataset.ci);
  if (btn.dataset.cact === "inc") {
    carrito[idx].cantidad += 1;
  } else {
    carrito[idx].cantidad -= 1;
    if (carrito[idx].cantidad <= 0) carrito.splice(idx, 1);
  }
  renderCart();
};

$("#cartClear").onclick = () => {
  carrito = [];
  renderCart();
  $("#nfcStatus").textContent = "";
};

// Cobro con tarjeta vía puente Android Stripe Terminal (o simulación en navegador)
$("#payNfc").onclick = async () => {
  const total = cartTotal();
  if (total <= 0) return;
  const centavos = Math.round(total * 100);
  const btn = $("#payNfc");
  btn.disabled = true;
  $("#nfcStatus").textContent = "Procesando cobro…";

  if (window.Android && typeof window.Android.startPayment === "function") {
    try {
      window.Android.startPayment(centavos);
    } catch (e) {
      btn.disabled = false;
      $("#nfcStatus").textContent = "Error al iniciar lector: " + e.message;
    }
  } else {
    // Modo demostración fuera de la app Android
    await new Promise(r => setTimeout(r, 800));
    window.onPaymentResult({
      status: "succeeded",
      paymentIntentId: "pi_demo_" + uid(),
      message: "Pago simulado aprobado",
    });
  }
};

window.onPaymentResult = async res => {
  const btn = $("#payNfc");
  if (res && res.status === "succeeded") {
    const total = cartTotal();
    const items = carrito.map(i => ({ ...i }));
    await api.crearVenta({
      total,
      paymentIntentId: res.paymentIntentId || null,
      items,
    });
    carrito = [];
    renderCart();
    $("#nfcStatus").textContent = "Venta registrada.";
    toast(`Cobro aprobado por ${money(total)}`);
    await refresh();
  } else {
    btn.disabled = cartTotal() <= 0;
    const msg = (res && res.message) || "Cobro cancelado o rechazado.";
    $("#nfcStatus").textContent = msg;
    toast(msg);
  }
};

/* ============================ REGISTRO: Stock y Movimientos ============================ */
let subTab = "stock";
let pageStock = 1;
let pageLog = 1;
const PAGE_SIZE = 15;

function setSub(s) {
  subTab = s;
  $$(".seg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.sub === s)));
  $("#sub-stock").hidden = s !== "stock";
  $("#sub-log").hidden = s !== "log";
}
$$(".seg button").forEach(b => b.onclick = () => {
  setSub(b.dataset.sub);
  renderRegistro();
});

async function renderRegistro() {
  if (subTab === "stock") {
    const q = norm($("#stockQ").value.trim());
    const f = $("#stockF").value;
    const s = $("#stockS").value;
    let list = catalogo.filter(p => {
      if (q && !norm(p.nombre).includes(q) && !(p.codigo && p.codigo.includes(q))) return false;
      if (f === "low") return p.stock > 0 && p.stock <= 5;
      if (f === "out") return p.stock <= 0;
      return true;
    });
    list.sort((a, b) => {
      if (s === "stock") return a.stock - b.stock;
      if (s === "price") return a.precio - b.precio;
      return a.nombre.localeCompare(b.nombre, "es");
    });

    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    pageStock = Math.min(pageStock, pages);
    const slice = list.slice((pageStock - 1) * PAGE_SIZE, pageStock * PAGE_SIZE);

    $("#stockCount").textContent = `${list.length} producto(s)`;
    $("#stockList").innerHTML = slice.map(p => `
      <li class="card-li">
        <div>
          <strong>${esc(p.nombre)}</strong>
          <small>${p.codigo ? `Código: ${esc(p.codigo)} · ` : ""}${p.sinPrecio ? "Sin precio" : money(p.precio)}</small>
        </div>
        <span class="badge ${p.stock <= 0 ? "out" : p.stock <= 5 ? "warn" : ""}">
          ${p.stock} disp.
        </span>
      </li>
    `).join("");

    const pg = $("#pg-stock");
    pg.querySelector("span").textContent = `Página ${pageStock} de ${pages}`;
    const [prev, next] = pg.querySelectorAll("button");
    prev.disabled = pageStock <= 1;
    next.disabled = pageStock >= pages;
    prev.onclick = () => { pageStock--; renderRegistro(); };
    next.onclick = () => { pageStock++; renderRegistro(); };
  } else {
    const movs = await api.listarMovimientos();
    const q = norm($("#logQ").value.trim());
    const f = $("#logF").value;
    const list = movs.filter(m => {
      if (f !== "all" && m.tipo !== f) return false;
      if (!q) return true;
      const texto = [m.proveedor, ...(m.items || []).map(i => i.nombre)].filter(Boolean).join(" ");
      return norm(texto).includes(q);
    });

    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    pageLog = Math.min(pageLog, pages);
    const slice = list.slice((pageLog - 1) * PAGE_SIZE, pageLog * PAGE_SIZE);

    $("#logCount").textContent = `${list.length} movimiento(s)`;
    $("#logList").innerHTML = slice.map(m => {
      const fecha = new Date(m.fecha).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
      if (m.tipo === "entrada") {
        return `<li class="card-li"><div><strong>📥 Entrada (${m.n} prod.)</strong><small>${fecha}${m.proveedor ? ` · ${esc(m.proveedor)}` : ""}</small></div></li>`;
      }
      return `<li class="card-li"><div><strong>🛒 Venta · ${money(m.total)}</strong><small>${fecha} · ${(m.items || []).length} art.</small></div></li>`;
    }).join("");

    const pg = $("#pg-log");
    pg.querySelector("span").textContent = `Página ${pageLog} de ${pages}`;
    const [prev, next] = pg.querySelectorAll("button");
    prev.disabled = pageLog <= 1;
    next.disabled = pageLog >= pages;
    prev.onclick = () => { pageLog--; renderRegistro(); };
    next.onclick = () => { pageLog++; renderRegistro(); };
  }
}

["#stockQ", "#stockF", "#stockS", "#logQ", "#logF"].forEach(sel => {
  $(sel).oninput = () => { pageStock = 1; pageLog = 1; renderRegistro(); };
});

/* ============================ Ayuda y Asistente ============================ */
const HELP_TEXT = {
  recibir: "Toma o sube una foto del ticket del proveedor, toca Leer ticket, revisa los precios y cantidades, y confirma para sumarlos al inventario.",
  vender: "Abre la cámara para escanear códigos de barras o escríbelos manualmente. Si un producto es nuevo, podrás registrarlo al instante. Cuando termines, toca Pagar con tarjeta.",
  registro: "Consulta las existencias disponibles y el historial de entradas y ventas realizadas.",
};

$("#helpBtn").onclick = () => {
  $("#helpBody").innerHTML = `<p>${HELP_TEXT[current] || HELP_TEXT.vender}</p>`;
  if (HELP_CONTACT) {
    $("#helpContact").href = HELP_CONTACT;
    $("#helpContact").hidden = false;
  }
  $("#helpDlg").showModal();
};
$("#helpClose").onclick = () => $("#helpDlg").close();
$("#helpSpeak").onclick = () => speak(HELP_TEXT[current] || HELP_TEXT.vender);

$("#asstBtn").onclick = () => {
  $("#asst").hidden = false;
  $("#asstBtn").setAttribute("aria-expanded", "true");
  $("#asstMsg").textContent = "¿En qué te ayudo? Puedes pedirme ir a Recibir, Vender o Registro.";
};
$("#asstClose").onclick = () => {
  $("#asst").hidden = true;
  $("#asstBtn").setAttribute("aria-expanded", "false");
};

/* ============================ Arranque ============================ */
(async function init() {
  renderCart();
  await refresh();
})();