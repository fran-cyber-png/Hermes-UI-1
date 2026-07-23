import { useEffect, useState } from 'react';
import { API_URL } from '../../config';
import { iniciales } from '../../lib/iniciales';

/**
 * EL AVATAR de un contacto: su foto de WhatsApp si la hay, las iniciales si no.
 *
 * Reemplaza las cuatro copias de la función de iniciales (FilaConversacion,
 * PanelContexto, VistaDashboard, ResponderPanel). El `className` estiliza el
 * círculo (tamaño, forma, color) para que cada lugar mantenga su look; el
 * componente solo decide QUÉ va adentro.
 *
 * La foto se trae SOLO cuando `conFoto` está prendido —típicamente al abrir un
 * contacto, uno a la vez— nunca para las 984 filas de la cola de golpe (eso es
 * pedirle a WhatsApp una foto por fila: rate-limit y riesgo de ban). Se baja con
 * el Bearer de la sesión (el endpoint está detrás de auth), como blob, y cae a
 * las iniciales ante cualquier problema. Sin foto → iniciales, nunca un roto.
 */

function useFotoPerfil(telefono: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!telefono) {
      setUrl(null);
      return;
    }
    let vivo = true;
    let objectUrl: string | null = null;
    const token = localStorage.getItem('hermes.token');
    void fetch(`${API_URL}/api/whatsapp/foto/${encodeURIComponent(telefono)}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (blob && vivo) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch(() => {
        /* sin foto → iniciales, en silencio */
      });
    return () => {
      vivo = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [telefono]);
  return url;
}

export function Avatar({
  nombre,
  telefono,
  conFoto = false,
  className = '',
}: {
  nombre: string | null;
  /** Teléfono del contacto (WhatsApp). Solo se usa si `conFoto`. */
  telefono?: string | null;
  /** Traer la foto de perfil. Prender SOLO donde se ve un contacto a la vez. */
  conFoto?: boolean;
  /** Clases del círculo: tamaño, forma, fondo, tinta de las iniciales. */
  className?: string;
}) {
  const foto = useFotoPerfil(conFoto ? telefono : null);
  const base = 'flex items-center justify-center overflow-hidden ' + className;

  if (foto) {
    return (
      <span className={base}>
        <img src={foto} alt="" className="size-full object-cover" />
      </span>
    );
  }
  return <span className={base}>{iniciales(nombre)}</span>;
}
