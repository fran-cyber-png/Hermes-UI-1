import { useCallback, useEffect, useState } from 'react';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { olvidarCacheDeHermes } from '../../lib/datos/cacheDeHermes';

/**
 * LA SESIÓN DE LA VENDEDORA, del lado del cliente.
 *
 * El token vive en localStorage; `api()` ya lo adjunta a cada request. Este hook
 * es la fuente de verdad de "¿quién está logueada?": al montar valida el token
 * contra `/api/auth/yo`, así una sesión expirada manda de vuelta al login en vez
 * de mostrar una app que va a dar 401 en cada llamada.
 *
 * El token se borra SOLO ante un 401 real (token muerto). Si el server no
 * contesta (red caída, deploy a medias), la sesión sigue siendo válida:
 * `sinServer` se prende y `reintentar()` vuelve a validar sin perder nada.
 *
 * ── Por qué la sesión se cree el token antes de preguntar ──
 * Validar contra el server ANTES de mostrar nada dejaba la app tapada por un
 * esqueleto durante todo el viaje de ida y vuelta a VPS1 — y eso hacía inútil el
 * caché persistido, que existe justamente para que al abrir haya algo pintado
 * (ADR 0007). Así que si hay un token que todavía no venció, la vendedora entra
 * de una y `/api/auth/yo` valida por detrás.
 *
 * Lo que NO cambia: la firma la sigue verificando el server en cada request, y
 * un 401 real echa igual. Lo único que se adelanta es la pantalla, y lo que se
 * ve mientras tanto es el caché de ESA misma vendedora, en SU máquina.
 */

export interface Vendedora {
  id: string;
  nombre: string;
}

const CLAVE = 'hermes.token';
/** El último usuario que entró — JAMÁS la contraseña. Precarga el login. */
export const CLAVE_ULTIMO_USUARIO = 'hermes.ultimoUsuario';

/**
 * Quién dice ser el token, sin validarlo. El cuerpo es `<id>|<expira>` en
 * base64url (ver `auth/sesion.ts` del server); la FIRMA no se mira, porque acá
 * no hay secreto con el que mirarla — de eso se encarga el server en cada
 * request. Devuelve null si está vencido o no se entiende, y entonces no hay
 * atajo: se espera al server como siempre.
 */
export function quienDiceSer(token: string): Vendedora | null {
  try {
    const [cuerpo] = token.split('.');
    const [id, expira] = atob(cuerpo.replace(/-/g, '+').replace(/_/g, '/')).split('|');
    if (!id || !(Number(expira) > Date.now())) return null;
    // `/api/auth/yo` devuelve el username como nombre: no hay un dato mejor que adelantar.
    return { id, nombre: id };
  } catch {
    return null;
  }
}

export function useSesion() {
  const [vendedora, setVendedora] = useState<Vendedora | null>(null);
  const [cargando, setCargando] = useState(true);
  const [sinServer, setSinServer] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem(CLAVE);
    if (!token) {
      setCargando(false);
      return;
    }
    // El atajo: con un token que no venció, la app se pinta YA desde el caché.
    const supuesta = quienDiceSer(token);
    if (supuesta) {
      setVendedora(supuesta);
      setCargando(false);
    } else {
      setCargando(true);
    }
    setSinServer(false);
    api<{ vendedora: Vendedora }>('/api/auth/yo')
      .then((r) => setVendedora(r.vendedora))
      .catch((err) => {
        if (err instanceof ErrorApi && err.status === 401) {
          // Token muerto de verdad: afuera, y sin dejarle el radar a la que entre.
          localStorage.removeItem(CLAVE);
          setVendedora(null);
          void olvidarCacheDeHermes();
        } else {
          setSinServer(true); // el server no contesta: el token se queda
        }
      })
      .finally(() => setCargando(false));
  }, [intento]);

  /** Vuelve a validar el token guardado (para el estado «no pude conectar con el server»). */
  const reintentar = useCallback(() => setIntento((n) => n + 1), []);

  const entrar = useCallback(async (username: string, password: string) => {
    // Si entra OTRA vendedora, lo guardado no es suyo: se va antes de que ella vea nada.
    if (username !== localStorage.getItem(CLAVE_ULTIMO_USUARIO)) await olvidarCacheDeHermes();
    const r = await api<{ token: string; vendedora: Vendedora }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    localStorage.setItem(CLAVE, r.token);
    localStorage.setItem(CLAVE_ULTIMO_USUARIO, username);
    setSinServer(false);
    setVendedora(r.vendedora);
  }, []);

  const salir = useCallback(() => {
    localStorage.removeItem(CLAVE);
    setVendedora(null);
    // El caché persistido también: con dos vendedoras en la misma máquina, la
    // que entra no puede ver el radar de la que se fue.
    void olvidarCacheDeHermes();
  }, []);

  return { vendedora, cargando, sinServer, reintentar, entrar, salir };
}
