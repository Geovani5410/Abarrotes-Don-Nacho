// auth.js — Independiente de app.js para evitar colisiones de nombres
const AUTH_API_URL = "https://TU-DOMINIO-NGROK.ngrok-free.app"; // Misma URL base que app.js y Config.BACKEND_URL

const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const formLogin = document.getElementById("form-login");
const formRegister = document.getElementById("form-register");
const subtitle = document.getElementById("auth-subtitle");
const alertBox = document.getElementById("auth-alert");

function showAlert(message, isError = true) {
  alertBox.textContent = message;
  alertBox.className = `alert ${isError ? "alert-error" : "alert-success"}`;
}

function clearAlert() {
  alertBox.textContent = "";
  alertBox.className = "alert hidden";
}

function switchTab(mode) {
  clearAlert();
  const isLogin = mode === "login";
  tabLogin.classList.toggle("active", isLogin);
  tabRegister.classList.toggle("active", !isLogin);
  tabLogin.setAttribute("aria-selected", isLogin);
  tabRegister.setAttribute("aria-selected", !isLogin);

  formLogin.classList.toggle("hidden", !isLogin);
  formRegister.classList.toggle("hidden", isLogin);
  subtitle.textContent = isLogin
    ? "Inicia sesión para comenzar a vender"
    : "Registro inicial del administrador de la tienda";
}

tabLogin.addEventListener("click", () => switchTab("login"));
tabRegister.addEventListener("click", () => switchTab("register"));

async function authRequest(endpoint, payload) {
  const response = await fetch(`${AUTH_API_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `Error del servidor (${response.status})`);
  }
  return data;
}

function saveSessionAndEnter(authResponse) {
  // authResponse esperado: { access_token, token_type, usuario: { id_usuario, nombre, apellido, correo, rol } }
  localStorage.setItem("dn_token", authResponse.access_token);
  if (authResponse.usuario) {
    localStorage.setItem("dn_user", JSON.stringify(authResponse.usuario));
  }
  location.replace("index.html");
}

// Manejo de Inicio de Sesión
formLogin.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlert();
  const btn = document.getElementById("btn-login");
  btn.disabled = true;
  btn.textContent = "Verificando...";

  try {
    const payload = {
      correo: document.getElementById("login-correo").value.trim().toLowerCase(),
      password: document.getElementById("login-password").value,
    };
    const data = await authRequest("/auth/login", payload);
    saveSessionAndEnter(data);
  } catch (err) {
    showAlert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Entrar";
  }
});

// Manejo de Registro
formRegister.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlert();
  const btn = document.getElementById("btn-register");
  btn.disabled = true;
  btn.textContent = "Creando cuenta...";

  try {
    const payload = {
      nombre: document.getElementById("reg-nombre").value.trim(),
      apellido: document.getElementById("reg-apellido").value.trim(),
      correo: document.getElementById("reg-correo").value.trim().toLowerCase(),
      telefono: document.getElementById("reg-telefono").value.trim() || null,
      password: document.getElementById("reg-password").value,
    };
    const data = await authRequest("/auth/register", payload);

    // Si /auth/register devuelve directamente el token, entramos; si no, pasamos a login
    if (data.access_token) {
      saveSessionAndEnter(data);
    } else {
      switchTab("login");
      showAlert("Cuenta creada correctamente. Ahora inicia sesión.", false);
    }
  } catch (err) {
    showAlert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Registrar cuenta";
  }
});