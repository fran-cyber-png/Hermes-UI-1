const { contextBridge, ipcRenderer } = require('electron');

/**
 * El puente entre el proceso principal y la pantalla.
 *
 * Expone lo mínimo indispensable y nada más: todo lo que se agregue acá es
 * superficie que puede llamar cualquier script del renderer. La regla es que nada
 * cruza el puente hasta que una pantalla lo necesite de verdad.
 *
 * ── Por qué `sendSync` y no `require('node:path')` ──
 * Este preload corre en sandbox (el default de Electron, y lo queremos: la ventana
 * hospeda un <webview> con WhatsApp Web adentro). En sandbox no existen los
 * módulos de Node, solo `electron`. Así que la ruta del adaptador la calcula el
 * proceso principal y se pide por IPC. Es síncrono a propósito: el valor tiene que
 * estar listo antes del primer render, o el <webview> se monta sin preload.
 */
contextBridge.exposeInMainWorld('hermes', {
  plataforma: process.platform,
  esEscritorio: true,

  /** URL `file://` del adaptador que se inyecta DENTRO del webview de WhatsApp. */
  adaptadorWhatsapp: ipcRenderer.sendSync('hermes:adaptador-whatsapp'),
});
