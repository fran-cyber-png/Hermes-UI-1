/**
 * PEGAR UN ADJUNTO CON ⌘V — la regla, fuera del componente.
 *
 * Una captura de pantalla es la forma más rápida que tiene una vendedora de
 * mandar el flyer, el comprobante o la ficha del curso: ya la tiene en el
 * portapapeles. Hasta hoy tenía que guardarla a disco, apretar el clip y
 * buscarla — tres pasos para algo que es uno.
 *
 * Vive acá y no adentro del `onPaste` por lo de siempre (ADR 0024): un `if`
 * dentro del JSX no se puede interrogar sobre el caso raro, y acá los casos
 * raros son la mayoría de la superficie — pegar texto, pegar tres archivos,
 * pegar un .zip, pegar una captura de 80 MB.
 */

/** Lo mínimo que necesitamos de un `File` para decidir. El test no fabrica `File`. */
export interface ArchivoPegable {
  name: string;
  type: string;
  size: number;
}

/**
 * El mismo tope que `express.raw({ limit: '64mb' })` en `/enviar-media`.
 * Se valida acá para que el aviso sea nuestro y diga el tamaño real: un 413
 * pelado del server se ve como «no se pudo enviar» y no explica nada.
 *
 * Es el TECHO, no el único tope: cada línea trae los suyos por clase
 * (`limitesMedia` de `GET /api/whatsapp/sesion`), y el de la Cloud API es
 * bastante más bajo. Ver `motivoPorTamano`.
 */
export const TOPE_ADJUNTO_BYTES = 64 * 1024 * 1024;

/** Las cuatro clases de adjunto saliente, derivadas del mime. */
export type ClaseAdjunto = 'imagen' | 'video' | 'audio' | 'documento';

export type LimitesPorClase = Partial<Record<ClaseAdjunto, number>>;

export function claseDeMime(mime: string): ClaseAdjunto {
  if (mime.startsWith('image/')) return 'imagen';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'documento';
}

const NOMBRE_CLASE: Record<ClaseAdjunto, string> = {
  imagen: 'La imagen',
  video: 'El video',
  audio: 'El audio',
  documento: 'El archivo',
};

/**
 * ¿ENTRA POR ESTA LÍNEA? `null` = sí; si no, el motivo ya redactado.
 *
 * Espeja `server/src/whatsapp/limitesMedia.ts` — misma redacción y mismas dos
 * cifras. **Y el server verifica igual**: esto no es la garantía, es evitar
 * subir 18 MB para enterarse al final. Por eso `limites` es opcional y sin él
 * solo aplica el techo de 64 MB: un server viejo no publica los suyos, y ahí
 * frenar de más rechazaría envíos que salen bien.
 */
export function motivoPorTamano(
  archivo: ArchivoPegable,
  limites?: LimitesPorClase,
): string | null {
  const clase = claseDeMime(archivo.type);
  const tope = limites?.[clase] ?? TOPE_ADJUNTO_BYTES;
  if (archivo.size <= tope) return null;
  return `${NOMBRE_CLASE[clase]} pesa ${pesoLegible(archivo.size)} y por esta línea entran hasta ${pesoLegible(tope)}.`;
}

/**
 * Lo que el composer ya acepta por el clip (`accept` del `<input type=file>`).
 * La misma lista a propósito: dos puertas al mismo envío no pueden aceptar
 * cosas distintas — si el clip lo manda, ⌘V también, y al revés.
 */
export function esAdjuntoAceptado(mime: string): boolean {
  return (
    mime.startsWith('image/') ||
    mime.startsWith('video/') ||
    mime.startsWith('audio/') ||
    mime === 'application/pdf'
  );
}

/**
 * El peso de un adjunto, en la unidad que corresponda.
 *
 * Estaba clavado en `(bytes/1024/1024).toFixed(1) + ' MB'`, que con el clip
 * pasaba —se adjuntaban videos y PDF gordos— y con ⌘V se rompe: una captura de
 * pantalla pesa entre 100 y 800 KB y **todas decían «0.0 MB»**. Un dato que se
 * dibuja mal es peor que el hueco: «0.0 MB» se lee como archivo vacío.
 */
export function pesoLegible(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  // Una cifra decimal solo mientras sirve: «12,4 MB» informa, «124,3 MB» no
  // más que «124 MB». Y un entero no arrastra el «,0»: «16,0 MB» al lado de
  // «17,9 MB» se lee como una precisión que no existe.
  //
  // Tiene que dar EXACTAMENTE lo mismo que `pesoLegible` del server
  // (`whatsapp/limitesMedia.ts`): las dos cifras del mismo mensaje —«pesa X,
  // entran Y»— pueden venir una de cada lado según quién frene primero.
  return `${mb < 100 ? mb.toFixed(1).replace(/[.,]0$/, '').replace('.', ',') : Math.round(mb)} MB`;
}

export type ResultadoPegado<A extends ArchivoPegable> =
  /** No había archivo: es un pegado de texto y el composer no tiene que hacer nada. */
  | { tipo: 'texto' }
  /** Hay archivo y va al composer. `aviso` cuenta lo que se dejó afuera. */
  | { tipo: 'adjunto'; archivo: A; aviso: string | null }
  /** Había archivo pero no entra. El motivo se muestra: el silencio se lee como app rota. */
  | { tipo: 'rechazado'; motivo: string };

/** «captura-2026-08-05-1432.png» — legible en el hilo y en la carpeta de media. */
export function nombreParaPegado(mime: string, ahora: Date): string {
  const ext = mime.split('/')[1]?.split('+')[0]?.replace(/[^a-z0-9]/gi, '') || 'bin';
  const p = (n: number) => String(n).padStart(2, '0');
  const sello = `${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}-${p(ahora.getHours())}${p(ahora.getMinutes())}`;
  return `captura-${sello}.${ext}`;
}

/**
 * Los navegadores nombran `image.png` a TODA captura del portapapeles — Chrome,
 * Firefox y Safari, los tres igual. Ese nombre viaja a `/enviar-media`, queda en
 * `envios_wa` y es lo que se lee tres semanas después buscando qué se mandó.
 *
 * Pero un archivo COPIADO DEL EXPLORADOR sí trae su nombre de verdad
 * (`flyer-agosto-PRECIO-NUEVO.jpg`), y ese nombre importa: en Goberna el precio
 * vive adentro de la imagen y el nombre del archivo entra en la versión de la
 * pieza (ADR 0022). Renombrarlo borraría el único dato que distingue dos flyers.
 * Así que se renombra solo lo genérico.
 */
export function nombreFinalDePegado(archivo: ArchivoPegable, ahora: Date): string {
  const propio = archivo.name?.trim() ?? '';
  const base = propio.replace(/\.[^.]+$/, '').toLowerCase();
  const esGenerico = propio === '' || base === '' || base === 'image' || base === 'imagen';
  return esGenerico ? nombreParaPegado(archivo.type, ahora) : propio;
}

/**
 * Decide qué hacer con lo que trae el portapapeles.
 *
 * `renombrar` es lo que devuelve el nombre a usar, y existe porque el composer
 * tiene que construir un `File` nuevo (los del portapapeles vienen sin nombre
 * útil: Chrome los llama `image.png` a todos). Acá se decide CÓMO se llama;
 * fabricar el `File` es del componente, que es el único que tiene la clase.
 */
export function decidirPegado<A extends ArchivoPegable>(
  archivos: ArrayLike<A>,
  opciones: { ahora?: Date; enRevision?: boolean; limites?: LimitesPorClase } = {},
): ResultadoPegado<A> {
  if (archivos.length === 0) return { tipo: 'texto' };

  // EN MODO REVISIÓN NO SE PEGA NADA (ADR 0018). Ahí el botón dice «Aprobar»,
  // no «Enviar»: lo que se aprueba es un texto que sale después por la cola
  // espaciada, y esa cola no lleva adjuntos. Un archivo pegado ahí se vería en
  // el composer y no saldría nunca — la peor de las dos respuestas posibles.
  if (opciones.enRevision) {
    return { tipo: 'rechazado', motivo: 'Acá no se adjunta: estás aprobando un texto preparado.' };
  }

  const aceptados: A[] = [];
  for (let i = 0; i < archivos.length; i++) {
    const a = archivos[i];
    if (esAdjuntoAceptado(a.type)) aceptados.push(a);
  }

  if (aceptados.length === 0) {
    return {
      tipo: 'rechazado',
      motivo: 'Eso no se puede mandar por WhatsApp. Va imagen, video, audio o PDF.',
    };
  }

  const archivo = aceptados[0];
  const porTamano = motivoPorTamano(archivo, opciones.limites);
  if (porTamano) return { tipo: 'rechazado', motivo: porTamano };

  // Un solo adjunto por mensaje: el composer tiene UN `File`, y el server manda
  // UN archivo por llamada. Con varios, se dice cuál va — callarlo dejaría a la
  // vendedora creyendo que mandó las tres.
  const sobrantes = archivos.length - 1;
  const aviso =
    sobrantes > 0
      ? `Va solo la primera: se pegaron ${archivos.length} y se manda una por vez.`
      : null;

  return { tipo: 'adjunto', archivo, aviso };
}
