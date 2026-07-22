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
 */

export interface Vendedora {
  id: string;
  nombre: string;
}

const CLAVE = 'hermes.token';
/** El último usuario que entró — JAMÁS la contraseña. Precarga el login. */
export const CLAVE_ULTIMO_USUARIO = 'hermes.ultimoUsuario';

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
    setCargando(true);
    setSinServer(false);
    api<{ vendedora: Vendedora }>('/api/auth/yo')
      .then((r) => setVendedora(r.vendedora))
      .catch((err) => {
        if (err instanceof ErrorApi && err.status === 401) {
          localStorage.removeItem(CLAVE); // token muerto de verdad: se limpia solo
        } else {
          setSinServer(true); // el server no contesta: el token se queda
        }
      })
      .finally(() => setCargando(false));
  }, [intento]);

  /** Vuelve a validar el token guardado (para el estado «no pude conectar con el server»). */
  const reintentar = useCallback(() => setIntento((n) => n + 1), []);

  const entrar = useCallback(async (username: string, password: string) => {
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
