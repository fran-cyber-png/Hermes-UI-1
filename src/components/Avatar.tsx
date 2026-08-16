import { API_URL } from '../config';
import { iniciales } from '../lib/iniciales';
import { useBlobAutenticado } from '../lib/datos/blobAutenticado';

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
 * pedirle a WhatsApp una foto por fila: rate-limit y riesgo de ban). Se baja por
 * `useBlobAutenticado` (el mecanismo central de media con Bearer: el endpoint
 * está detrás del perímetro y `<img>` no manda headers), y cae a las iniciales
 * ante cualquier problema. Sin foto → iniciales, nunca un roto.
 */

function useFotoPerfil(telefono: string | null | undefined, numeroPropio: string | null | undefined): string | null {
  const url =
    telefono ?
      `${API_URL}/api/whatsapp/foto/${encodeURIComponent(telefono)}` +
      (numeroPropio ? `?numeroPropio=${encodeURIComponent(numeroPropio)}` : '')
    : null;
  const { url: blob } = useBlobAutenticado(url);
  return blob;
}

export function Avatar({
  nombre,
  telefono,
  numeroPropio,
  conFoto = false,
  className = '',
}: {
  nombre: string | null;
  /** Teléfono del contacto (WhatsApp). Solo se usa si `conFoto`. */
  telefono?: string | null;
  /**
   * Línea propia por la que entró esta conversación. Sin esto, la foto se pide
   * SIEMPRE por la primera línea armada — con más de una línea whatsmeow, filtra
   * la foto de un contacto de una línea hacia la cuenta de otra.
   */
  numeroPropio?: string | null;
  /** Traer la foto de perfil. Prender SOLO donde se ve un contacto a la vez. */
  conFoto?: boolean;
  /** Clases del círculo: tamaño, forma, fondo, tinta de las iniciales. */
  className?: string;
}) {
  const foto = useFotoPerfil(conFoto ? telefono : null, numeroPropio);
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
