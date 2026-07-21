const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * El proceso principal de Hermes.
 *
 * ── Por qué Electron y no Tauri ──
 * Por WhatsApp, y solo por WhatsApp. Facebook, Instagram y Messenger entran por
 * la Graph API oficial y no necesitan navegador ninguno. Pero WhatsApp no tiene
 * API disponible todavía (la Cloud API está en trámite), así que el puente
 * interino es leer WhatsApp Web desde adentro de la app. Eso pide un WebContents
 * con partición de sesión persistente e inyección de script — que en Electron es
 * de fábrica y en el webview del sistema (WKWebView/WebView2) es una pelea.
 *
 * Cuando salga la Cloud API ese pedazo se borra y la app sigue igual: el
 * adaptador de WhatsApp Web es la ÚNICA parte que sabe que existe un navegador.
 *
 * ── .cjs a propósito ──
 * El package.json declara `"type": "module"`. Sin la extensión .cjs este archivo
 * se cargaría como ESM y `require` no existiría.
 */

// Vite en dev; el build estático en producción.
const URL_DEV = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';
const esDev = !app.isPackaged;

/**
 * La ruta del adaptador de WhatsApp, resuelta acá porque el preload corre en
 * sandbox y no tiene módulos de Node para armarla. Se entrega por IPC síncrono.
 */
const URL_ADAPTADOR = pathToFileURL(path.join(__dirname, 'whatsapp-preload.cjs')).href;
ipcMain.on('hermes:adaptador-whatsapp', (e) => {
  e.returnValue = URL_ADAPTADOR;
});

/**
 * EL USER-AGENT — sin esto WhatsApp Web no abre.
 *
 * Electron manda un UA que dice, textualmente,
 *   "… hermes/0.0.0 Chrome/132.0.0.0 Electron/34.0.0 Safari/537.36"
 * y WhatsApp lo mira, ve un token que no conoce y responde "actualiza Chrome" —
 * corriendo, justamente, sobre Chrome 132.
 *
 * Lo que se saca son los dos tokens del envoltorio. Lo que queda es cierto: el
 * motor ES ese Chrome, con ese número de versión. No estamos diciendo ser otro
 * navegador; estamos dejando de mencionar la carcasa que el sniff no contempla.
 * Si algún día hubiera que MENTIR la versión para pasar, eso ya sería otra cosa y
 * habría que discutirlo.
 */
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/, '')
  .replace(new RegExp(`\\s${app.getName()}\\/\\S+`, 'i'), '');

function crearVentana() {
  const win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 720,
    minHeight: 560,
    // La barra de título nativa se esconde pero los semáforos quedan: el header
    // de React hace de barra (ver el `app-region: drag` en App.tsx).
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#F5F7FB',
    // Evita el flash blanco antes de que React pinte.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // Las dos que importan: el renderer NUNCA toca Node. Esta app va a cargar
      // WhatsApp Web adentro; darle Node a ese contexto sería regalarle la máquina
      // del vendedor a cualquier script de terceros.
      contextIsolation: true,
      nodeIntegration: false,
      // Habilita el <webview> donde vive WhatsApp Web. Es la forma de que React
      // sea dueño del layout (el pane se mueve con el CSS, no con coordenadas
      // que el proceso principal tendría que recalcular en cada resize).
      webviewTag: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Todo enlace externo (el "Verlo en Facebook" de la bandeja) va al navegador
  // del sistema. Si se abriera acá adentro, la app se volvería un navegador sin
  // barra de direcciones — el vendedor no sabría dónde está parado.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (esDev) {
    void win.loadURL(URL_DEV);
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  return win;
}

void app.whenReady().then(() => {
  crearVentana();

  // Convención de macOS: click en el dock sin ventanas abiertas reabre una.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentana();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
