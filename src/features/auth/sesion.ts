import { useCallback, useEffect, useState } from 'react';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { olvidarCacheDeHermes } from '../../lib/datos/cacheDeHermes';
import { borrarToken, guardarToken, tokenGuardado } from '../../lib/datos/token';
import { mensajeDeErrorCenturion, tokenCenturionDeLaUrl } from './centurionSso';

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
  /**
   * ¿Hermes todavía tiene su cookie de Cerberus? `null` = no se sabe (server viejo
   * o todavía no contestó). `false` es la única que hay que denunciar.
   *
   * Son dos vidas distintas: el token de Hermes dura 14 días y sobrevive un
   * reinicio; la cookie de Cerberus vive en memoria del proceso y muere con él.
   * Sin esto, la vendedora se enteraba recién al registrar una venta, con un 409.
   */
  const [cerberusVivo, setCerberusVivo] = useState<boolean | null>(null);
  /** Vino de Centurión con un link que no sirvió. `Login` lo puede mostrar. */
  const [errorCenturion, setErrorCenturion] = useState<string | null>(null);

  useEffect(() => {
    async function arrancar() {
      // ── EL BUZÓN DE CENTURIÓN, primero: se lee UNA VEZ, no es un router ──
      // (mismo criterio que `notas/porLink.ts`, ADR 0048). Si el canje falla no
      // se corta acá: puede haber una sesión guardada de un login anterior.
      const tokenCenturion = tokenCenturionDeLaUrl();
      if (tokenCenturion) {
        try {
          const r = await api<{ token: string; vendedora: Vendedora }>('/api/auth/centurion', {
            method: 'POST',
            body: JSON.stringify({ token: tokenCenturion }),
          });
          guardarToken(r.token);
          setVendedora(r.vendedora);
          setSinServer(false);
          setCerberusVivo(false); // esta identidad no tiene sesión de Cerberus, y nunca la va a tener.
          setCargando(false);
          return;
        } catch (err) {
          setErrorCenturion(mensajeDeErrorCenturion(err));
          // sigue abajo: quizás hay una sesión guardada de antes.
        }
      }

      const token = tokenGuardado();
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
      try {
        const r = await api<{ vendedora: Vendedora; cerberus?: boolean }>('/api/auth/yo');
        setVendedora(r.vendedora);
        // El server viejo no manda el campo; ahí no hay nada que denunciar.
        setCerberusVivo(r.cerberus ?? null);
      } catch (err) {
        if (err instanceof ErrorApi && err.status === 401) {
          // Token muerto de verdad: afuera, y sin dejarle el radar a la que entre.
          borrarToken();
          setVendedora(null);
          void olvidarCacheDeHermes();
        } else {
          setSinServer(true); // el server no contesta: el token se queda
        }
      } finally {
        setCargando(false);
      }
    }
    void arrancar();
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
    guardarToken(r.token);
    localStorage.setItem(CLAVE_ULTIMO_USUARIO, username);
    setSinServer(false);
    setVendedora(r.vendedora);
    // Entrar es, por definición, tener sesión de Cerberus recién hecha: el login
    // pasó por ahí. Es también el ÚNICO camino que la repone.
    setCerberusVivo(true);
  }, []);

  const salir = useCallback(() => {
    borrarToken();
    setVendedora(null);
    setCerberusVivo(null);
    // El caché persistido también: con dos vendedoras en la misma máquina, la
    // que entra no puede ver el radar de la que se fue.
    void olvidarCacheDeHermes();
  }, []);

  return { vendedora, cargando, sinServer, reintentar, entrar, salir, cerberusVivo, errorCenturion };
}
