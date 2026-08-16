/**
 * EL AVISO DE ESCRITORIO — solo cuando la vendedora NO está mirando Hermes.
 *
 * `document.hidden` es la misma señal que usa WhatsApp Web: con la pestaña
 * activa el mensaje ya se ve solo en la cola, y superponerle un Notification
 * sería ruido encima de ruido. `silent: true` apaga el sonido propio del SO
 * para no duplicar la campanita de `sonido.ts`.
 *
 * Es Web Notification API estándar, no un comando de Tauri: no necesita
 * permiso declarado en `src-tauri/permissions/*.toml` (eso es solo para
 * `invoke()`). Lo que SÍ puede variar sin haberlo verificado es si
 * WKWebView/WebView2 la exponen igual que un navegador — no está probado en
 * la app empaquetada, solo en `npm run dev` (navegador). Fail-open: si la
 * API no existe o el permiso está denegado, no se rompe nada, solo no avisa.
 */
export function pedirPermisoDeNotificacion(): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'default') void Notification.requestPermission();
}

export function notificarEscritorio(titulo: string, cuerpo: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (!document.hidden) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(titulo, { body: cuerpo, silent: true });
  } catch {
    // Idem sonido.ts: un aviso de escritorio que falla no puede tumbar nada.
  }
}
