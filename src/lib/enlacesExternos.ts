/**
 * LINKS EXTERNOS EN LA CÁSCARA TAURI.
 *
 * En el navegador, `target="_blank"` abre una pestaña. En Tauri no hay
 * pestañas: sin esto, el clic muere en silencio. Este shim intercepta esos
 * clics SOLO cuando la app corre dentro de Tauri y los manda al navegador del
 * sistema vía el plugin opener.
 *
 * En el navegador común no hace nada: `__TAURI_INTERNALS__` no existe y el
 * listener queda inerte.
 *
 * OJO: esto es para el navegador DEL SISTEMA. Lo que abre una ventana de
 * Hermes es otra cosa y vive en `src/features/navegador/` (ADR 0040).
 */

import { puenteTauri } from './tauri';

export function conectarEnlacesExternos(): void {
  document.addEventListener('click', (e) => {
    const tauri = puenteTauri();
    if (!tauri) return;

    const enlace = (e.target as HTMLElement).closest?.('a[target="_blank"]');
    if (!(enlace instanceof HTMLAnchorElement) || !enlace.href) return;

    e.preventDefault();
    void tauri.invoke('plugin:opener|open_url', { url: enlace.href, with: null }).catch(() => {
      // Si el opener falla, mejor nada que una navegación adentro de la cáscara.
    });
  });
}


/** Abre una URL con la app del sistema: en Tauri vía opener, en navegador nativo. */
export function abrirExterno(url: string): void {
  const tauri = puenteTauri();
  if (tauri) {
    void tauri.invoke('plugin:opener|open_url', { url, with: null }).catch(() => {});
    return;
  }
  window.location.href = url;
}

/** Llamar por teléfono: abre el marcador del sistema (FaceTime / Phone Link). */
export function llamar(telefono: string): void {
  const digitos = telefono.replace(/\D/g, '');
  if (digitos.length >= 8) abrirExterno(`tel:+${digitos}`);
}
