const { ipcRenderer } = require('electron');

/**
 * EL ADAPTADOR DE WHATSAPP WEB — la única parte de Hermes que sabe leer un DOM.
 *
 * ── Qué es y qué no es ──
 * Lee, en modo pasivo, quién está del otro lado del chat abierto. NO manda
 * mensajes, no recorre chats solo, no toca `window.Store` ni `webpackChunk`.
 * Eso último no es prolijidad: moduleRaid quedó descartado explícitamente en el
 * spike (ver docs/deteccion-whatsapp-web.md §2) por ser territorio Baileys-like,
 * y la política 2026-07-03 lo prohíbe. DOM puro, sesión real, humano al mando.
 *
 * ── Por qué es descartable ──
 * Cuando salga la WhatsApp Cloud API este archivo se borra entero. Todo lo demás
 * de Hermes habla con eventos normalizados y no sabe que existió un navegador.
 * Esa es toda la razón de que la lectura del DOM viva encerrada acá y no repartida
 * por la app.
 *
 * ── Selectores ──
 * Verificados en vivo el 20-jul-2026 sobre la sesión real (Playwright, read-only).
 * Son semánticos a propósito (`#main`, `[role=grid]`, `span[dir]`) porque las
 * clases de WhatsApp están ofuscadas y cambian sin aviso. Aun así pueden romperse:
 * por eso existe el autochequeo de abajo.
 */

const SEL = {
  /** Existe SOLO si hay un chat abierto. Es el mejor gate de "hay conversación". */
  chat: '#main',
  header: '#main header',
  /** El primer span con `dir` es el nombre (si está guardado) o el teléfono (si no). */
  titulo: '#main header span[dir]',
  /** El drawer de info del contacto: es donde vive el teléfono de un contacto guardado. */
  drawer: 'section',
  lista: '#pane-side [role="grid"] [role="row"]',
};

/** "+51 961 506 674" y variantes. Sirve para decidir si el título ES el teléfono. */
const ES_TELEFONO = /^\+?\d[\d\s().\-]{8,}\d$/;

/** Canónico compartido con Cerberus y con la dedup de la consolidación: dígitos + 51. */
function normalizarTelefono(crudo) {
  if (!crudo) return null;
  const digitos = crudo.replace(/\D/g, '');
  if (digitos.length < 8) return null;
  return digitos.startsWith('51') ? digitos : `51${digitos}`;
}

const texto = (el) => (el?.textContent ?? '').trim();

/**
 * El número del PROPIO vendedor, gratis y sin interacción.
 *
 * Resuelve la atribución por vendedor cuando cada uno usa su sesión (§8 pregunta 1
 * del plan). Si el equipo comparte un número, esto devuelve el mismo para todos y
 * la atribución tiene que salir de otro lado — el dato no miente, solo no alcanza.
 */
function vendedorWid() {
  try {
    const crudo = window.localStorage.getItem('last-wid-md');
    if (!crudo) return null;
    return JSON.parse(crudo).split(':')[0] || null;
  } catch {
    return null;
  }
}

/**
 * ¿Es un grupo? Entonces no hay "un" contacto y no se ofrece registrar nada.
 *
 * Dos señales, cualquiera alcanza: el botón de videollamada grupal, o un subtítulo
 * que es una lista de participantes separada por comas.
 */
function esGrupo(header) {
  if (!header) return false;
  if (header.querySelector('[aria-label="Videollamada en grupo"]')) return true;
  const spans = [...header.querySelectorAll('span[dir]')].map(texto);
  const subtitulo = spans[1] ?? '';
  return subtitulo.split(',').length >= 3;
}

/**
 * ¿Estamos en la pantalla de vinculación (el QR)?
 *
 * Distinguir esto de "el DOM cambió" es la mitad del valor del autochequeo: son
 * dos problemas con dos arreglos opuestos. El QR se resuelve escaneando con el
 * teléfono; un DOM roto se resuelve tocando código. Colapsarlos en un solo
 * "algo anda mal" haría que el vendedor espere a un programador para escanear un
 * código.
 */
function esPantallaQr() {
  if (document.querySelector('[data-ref]')) return true;
  // Fallback por si `data-ref` cambia: el canvas del código con su etiqueta.
  const canvas = document.querySelector('canvas[aria-label]');
  return Boolean(canvas && /scan|escane|código|codigo|qr/i.test(canvas.getAttribute('aria-label') ?? ''));
}

/**
 * AUTOCHEQUEO — la diferencia entre "no hay nadie" y "me quedé ciego".
 *
 * Si WhatsApp cambia el DOM, los selectores devuelven null y sin esto la app
 * mostraría un panel vacío y tranquilo, exactamente igual que cuando no hay chat
 * abierto. El vendedor confiaría en un lector roto.
 *
 * Regla: ante la duda, decir "no sé". Nunca inventar un teléfono.
 */
function autochequeo() {
  const hayApp = Boolean(document.querySelector('#pane-side') || document.querySelector(SEL.chat));
  return {
    ok: hayApp,
    motivo: hayApp ? null : 'WhatsApp cargó pero no reconozco su interfaz. Puede que haya cambiado el DOM.',
  };
}

/** Lectura pasiva: 0 clicks, 0 interferencia. Lo que se puede saber sin tocar nada. */
function leerChat() {
  // El QR se chequea PRIMERO: sin sesión vinculada no hay nada más que decir, y
  // no es una falla del lector.
  if (esPantallaQr()) return { estado: 'sin-sesion' };

  const salud = autochequeo();
  if (!salud.ok) return { estado: 'lector-offline', motivo: salud.motivo };

  const chat = document.querySelector(SEL.chat);
  if (!chat) return { estado: 'sin-chat' };

  const header = document.querySelector(SEL.header);
  if (esGrupo(header)) return { estado: 'grupo' };

  const titulo = texto(header?.querySelector('span[dir]'));
  if (!titulo) return { estado: 'sin-chat' };

  // Si el título YA es un número, el contacto no está guardado y el teléfono es
  // gratis. Si es un nombre, hay que abrir el drawer — y eso se hace a pedido.
  const esNumero = ES_TELEFONO.test(titulo);

  return {
    estado: 'chat',
    nombre: esNumero ? null : titulo,
    telefonoVisible: esNumero ? titulo : null,
    telefonoNormalizado: esNumero ? normalizarTelefono(titulo) : null,
    /** Si es true, el teléfono existe pero cuesta un click programático. */
    requiereDrawer: !esNumero,
    vendedorWid: vendedorWid(),
  };
}

/**
 * Lectura ACTIVA: abre el panel de info, lee el teléfono, y lo vuelve a cerrar.
 *
 * Es la única acción de este archivo que toca la interfaz, y por eso NO corre
 * sola: la dispara el vendedor cuando pide la ficha. Abrir un panel no es enviar
 * un mensaje — sigue siendo read-only en el sentido que importa (D2) — pero
 * hacerlo en cada cambio de chat sería ruido constante sobre la sesión de alguien
 * que está trabajando.
 *
 * El drawer se anima ~500-800 ms; leerlo antes devuelve vacío.
 */
async function leerTelefonoDelDrawer() {
  const header = document.querySelector(SEL.header);
  if (!header) return { ok: false, motivo: 'No hay chat abierto.' };

  const boton = header.querySelector('[title="Información del perfil"]') ?? header;
  const click = (ev) =>
    boton.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }));

  ['mousedown', 'mouseup', 'click'].forEach(click);
  await new Promise((r) => setTimeout(r, 900));

  const drawer = document.querySelector(SEL.drawer);
  const encontrado = drawer
    ? [...drawer.querySelectorAll('span')].map(texto).find((t) => ES_TELEFONO.test(t))
    : null;

  // Es un toggle: el mismo click lo cierra. Se devuelve la sesión como estaba.
  ['mousedown', 'mouseup', 'click'].forEach(click);

  if (!encontrado) {
    return { ok: false, motivo: 'El panel no mostró un teléfono. Puede ser una cuenta business o el DOM cambió.' };
  }
  return { ok: true, telefonoVisible: encontrado, telefonoNormalizado: normalizarTelefono(encontrado) };
}

// ── El puente con Hermes ────────────────────────────────────────────────────
// `sendToHost` habla con el renderer que embebe el <webview>, no con el main.

let ultimo = '';
function reportar() {
  const lectura = leerChat();
  const firma = JSON.stringify(lectura);
  // Solo se avisa cuando algo cambió: WhatsApp muta el DOM constantemente y
  // reenviar lo mismo 40 veces por segundo haría re-renderizar la app al pedo.
  if (firma === ultimo) return;
  ultimo = firma;
  ipcRenderer.sendToHost('wa:chat', lectura);
}

ipcRenderer.on('wa:pedir-telefono', async () => {
  const r = await leerTelefonoDelDrawer();
  ipcRenderer.sendToHost('wa:telefono', r);
});

window.addEventListener('DOMContentLoaded', () => {
  reportar();
  // WhatsApp es una SPA: no hay navegación que escuchar, solo mutaciones. El
  // observer cubre el cambio de chat; el intervalo cubre el arranque y el login,
  // cuando el árbol todavía no existe para observarlo.
  new MutationObserver(reportar).observe(document.body, { childList: true, subtree: true });
  setInterval(reportar, 2000);
});
