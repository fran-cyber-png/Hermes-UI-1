import { useEffect, useState } from 'react';

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
 * Todo componente que muestre media del server pasa por acá. Si aparece otro
 * `<img>` apuntando a la API, es un bug: o usa este hook, o va a 401.
 */
export function useBlobAutenticado(url: string | null): { url: string | null; fallo: boolean } {
  const [estado, setEstado] = useState<{ url: string | null; fallo: boolean }>({
    url: null,
    fallo: false,
  });

  useEffect(() => {
    // Limpiar el blob ANTERIOR al cambiar de recurso: sin esto, la foto del
    // contacto anterior se quedaba pegada si el nuevo no tenía (404).
    setEstado({ url: null, fallo: false });
    if (!url) return;
    let vivo = true;
    let objectUrl: string | null = null;
    const token = localStorage.getItem('hermes.token');
    void fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!vivo) return;
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setEstado({ url: objectUrl, fallo: false });
        } else {
          setEstado({ url: null, fallo: true });
        }
      })
      .catch(() => {
        if (vivo) setEstado({ url: null, fallo: true });
      });
    return () => {
      vivo = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return estado;
}
