import { useCallback, useEffect, useState } from 'react';
import { crearCacheDeBlobs } from './cacheDeBlobs';
import { tokenGuardado } from './token';

/**
 * MEDIA DETRÁS DEL PERÍMETRO — el mecanismo central, y el único.
 *
 * Desde el cierre del issue #36, los adjuntos (`/api/whatsapp/media/*`) y la
 * foto de perfil (`/api/whatsapp/foto/:telefono`) exigen el Bearer de la
 * vendedora, como todo /api. Pero `<img src>`, `<video src>` y `<a href>` no
 * mandan headers — así que la URL directa ya no sirve.
 *
 * La solución de la casa es UNA: fetch con el token → blob → URL de objeto
 * local, que cualquier etiqueta consume sin auth porque ya vive en memoria.
 * Se eligió esto (y no un token corto en la query) porque no deja credenciales
 * en los access logs de nginx ni en el historial del navegador, no caduca a
 * mitad de sesión y reutiliza la misma sesión Bearer que todo lo demás.
 *
 * El costo del blob es que se baja ENTERO — no hay streaming por rango. Por
 * eso hay dos modos:
 *   · eager (default): para lo chico que se ve siempre — imágenes, stickers,
 *     la foto de perfil.
 *   · `alPedir: true`: para lo pesado — video, audio, documentos. No se baja
 *     nada hasta que la vendedora toca; el componente llama `pedir()`.
 *
 * Y una memoria compartida (`cacheDeBlobs`): cambiar de chat y volver no
 * re-baja nada, dos burbujas con la misma media comparten un solo fetch, y el
 * caché —no el hook— es el dueño de la revocación (LRU con límite; `limpiar`
 * en el cierre de sesión). Todo componente que muestre media del server pasa
 * por acá. Si aparece otro `<img>` apuntando a la API, es un bug: o usa este
 * hook, o va a 401.
 */

// 250 entradas: más que un hilo entero (LIMIT 200) para que el LRU no revoque
// blobs que siguen montados. Lo pesado entra solo si la vendedora lo pidió.
const cache = crearCacheDeBlobs(250, (valor) => URL.revokeObjectURL(valor));

/** Revoca todos los blobs. Se llama al cerrar sesión (via `olvidarCacheDeHermes`). */
export function limpiarBlobsAutenticados(): void {
  cache.limpiar();
}

interface EstadoBlob {
  url: string | null;
  fallo: boolean;
  bajando: boolean;
}

export function useBlobAutenticado(
  url: string | null,
  opciones?: { alPedir?: boolean },
): EstadoBlob & { pedir: () => void } {
  const alPedir = opciones?.alPedir ?? false;
  // Con `alPedir`, la bajada arranca recién cuando `pedir()` marcó ESTA url —
  // atado a la url, no a un booleano, para que cambiar de mensaje no herede
  // el permiso del anterior. `intento` permite que un nuevo `pedir()` reintente
  // después de un fallo (el fallo no se cachea, pero el efecto no re-corría).
  const [pedidaPara, setPedidaPara] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const activa = url !== null && (!alPedir || pedidaPara === url);

  const [estado, setEstado] = useState<EstadoBlob>({ url: null, fallo: false, bajando: false });

  useEffect(() => {
    if (!url || !activa) {
      setEstado({ url: null, fallo: false, bajando: false });
      return;
    }

    const enCache = cache.obtener(url);
    if (enCache) {
      setEstado({ url: enCache, fallo: false, bajando: false });
      return;
    }

    let vivo = true;
    setEstado({ url: null, fallo: false, bajando: true });
    cache
      .traer(url, async () => {
        const token = tokenGuardado();
        const res = await fetch(url, {
          headers: token ? { authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return null;
        return URL.createObjectURL(await res.blob());
      })
      .then((objectUrl) => {
        // Sin revocación acá: el blob es del caché, no de este montaje —
        // otro componente puede estar mostrándolo.
        if (vivo) setEstado({ url: objectUrl, fallo: objectUrl === null, bajando: false });
      })
      .catch(() => {
        if (vivo) setEstado({ url: null, fallo: true, bajando: false });
      });
    return () => {
      vivo = false;
    };
  }, [url, activa, intento]);

  const pedir = useCallback(() => {
    if (!url) return;
    setPedidaPara(url);
    setIntento((n) => n + 1);
  }, [url]);

  return { ...estado, pedir };
}
