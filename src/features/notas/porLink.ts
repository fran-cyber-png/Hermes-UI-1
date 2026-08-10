import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';
import type { Nota } from './notas';

/**
 * LLEGAR A UNA PÁGINA POR UN LINK INTERNO (ADR 0048).
 *
 * ══ POR QUÉ ESTO EXISTE, Y NO ES UN ROUTER ══════════════════════════════════
 *
 * Un link de alcance `goberna` **no puede servir contenido desde `/n/`**: una
 * navegación del navegador no lleva el token de Hermes (la sesión vive en
 * `localStorage`, no en una cookie), así que ahí el server no sabe quién sos. La
 * ruta pública manda a la app con `#n=<token>`, y la app —que sí tiene el
 * Bearer— pregunta por `/api`.
 *
 * ⚠️ **Esto NO convierte a Hermes en una app con router** (ADR 0002: sin router,
 * las vistas se conmutan por estado). Se lee el hash **una vez, al arrancar**, y
 * se limpia: no hay historial, no hay rutas, no hay `popstate`. Es un buzón de
 * entrada de un solo uso, no navegación.
 */

/** El token que vino en la URL, o `null`. Se LEE UNA VEZ y se limpia. */
export function tokenDeLaUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.hash.match(/^#n=([0-9a-f]{32})$/);
  if (!m) return null;

  // Se limpia enseguida, y no es cosmético: el token es una credencial de
  // lectura. Dejarlo en la barra hace que se copie con la URL, quede en el
  // historial y viaje en cualquier captura de pantalla de la app.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return m[1];
}

export interface PaginaPorLink {
  nota: Nota;
  /** `true` solo si el link lo permite Y hay sesión — lo decide el server. */
  puedeEditar: boolean;
}

/**
 * Trae la página de un link interno.
 *
 * ⚠️ **`retry: false`**: un token que no sirve no mejora reintentando, y cada
 * reintento es otra pregunta por una credencial que ya sabemos que no vale.
 */
export function usePaginaPorLink(token: string | null) {
  return useQuery({
    queryKey: ['notas', 'por-link', token],
    queryFn: () => api<{ ok: true } & PaginaPorLink>(`/api/notas/por-link/${token}`),
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
  });
}
