// Una sesión por panel: vendedor por un lado, caja/logística por otro. Con
// una sola sesión compartida, entrar a Caja en otra pestaña del mismo
// navegador pisaba el token del vendedor y sus pedidos daban "Acceso
// restringido".

// Qué sesión usa la pantalla actual (las rutas van con hash: /#/vendedor).
export function roleForRoute() {
  return window.location.hash.startsWith('#/vendedor') ? 'vendedor' : 'caja';
}

const key = (role) => `feria_session_${role}`;

export function getSession(role = roleForRoute()) {
  try {
    return JSON.parse(localStorage.getItem(key(role))) ?? null;
  } catch {
    return null;
  }
}

export function saveSession(role, token, profile) {
  localStorage.setItem(key(role), JSON.stringify({ token, profile }));
}

export function clearSession(role = roleForRoute()) {
  localStorage.removeItem(key(role));
}
