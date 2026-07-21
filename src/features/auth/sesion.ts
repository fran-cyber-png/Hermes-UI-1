import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/datos/cliente';

/**
 * LA SESIÓN DE LA VENDEDORA, del lado del cliente.
 *
 * El token vive en localStorage; `api()` ya lo adjunta a cada request. Este hook
 * es la fuente de verdad de "¿quién está logueada?": al montar valida el token
 * contra `/api/auth/yo`, así una sesión expirada manda de vuelta al login en vez
 * de mostrar una app que va a dar 401 en cada llamada.
 */

export interface Vendedora {
  id: string;
  nombre: string;
}

const CLAVE = 'hermes.token';

export function useSesion() {
  const [vendedora, setVendedora] = useState<Vendedora | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(CLAVE);
    if (!token) {
      setCargando(false);
      return;
    }
    api<{ vendedora: Vendedora }>('/api/auth/yo')
      .then((r) => setVendedora(r.vendedora))
      .catch(() => localStorage.removeItem(CLAVE)) // token muerto: se limpia solo
      .finally(() => setCargando(false));
  }, []);

  const entrar = useCallback(async (username: string, password: string) => {
    const r = await api<{ token: string; vendedora: Vendedora }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    localStorage.setItem(CLAVE, r.token);
    setVendedora(r.vendedora);
  }, []);

  const salir = useCallback(() => {
    localStorage.removeItem(CLAVE);
    setVendedora(null);
  }, []);

  return { vendedora, cargando, entrar, salir };
}
