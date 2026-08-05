import type { MediaSaliente, TransporteWhatsapp } from './transporte.js';

/**
 * CUÁNTO PESA DE MÁS — el tope de un adjunto, por CLASE y por TRANSPORTE.
 *
 * ── El defecto que esto tapa ──────────────────────────────────────────────
 * Hasta el 5-ago-2026 el único tope era el de `express.raw({ limit: '64mb' })`
 * en `/enviar-media`, o sea el del transporte HTTP: lo mismo para una foto que
 * para un video. Un video de 17,9 MB por la línea de la Cloud API se dejaba
 * elegir, se guardaba en disco, se subía ENTERO a Meta, y recién ahí volvía un
 * 400 que la app mostraba crudo:
 *
 *     Cloud API subiendo media (400): {"error":{"message":"(#100) Invalid
 *     parameter","code":100,…,"details":"File Too Large: The file you uploaded
 *     is too large."},"fbtrace_id":"A5Y8u6CVJGXn6yLN1BIyRuw"}
 *
 * Tres cosas mal en una: se descubre tarde, se paga la subida completa, y lo
 * que la vendedora lee es un `fbtrace_id`.
 *
 * ── Por qué por transporte y no una tabla sola ────────────────────────────
 * Los topes de Meta NO son de WhatsApp: son de la Cloud API. Las líneas de las
 * vendedoras son whatsmeow —una cuenta real vinculada— y hoy mandan imágenes de
 * más de 5 MB sin problema. Aplicarles el tope de Meta rechazaría envíos que
 * funcionan. Por eso el límite lo declara el transporte que lo impone.
 *
 * ── MEDIDO contra la línea de producción, no leído ───────────────────────
 * `npm run wa:cloud-api:limites` el 5-ago-2026 (sube archivos de ceros a
 * `/media`, no manda ningún mensaje). Con el control en verde:
 *
 *     video/mp4        15 MB  ✓ aceptado   ← control: la credencial sirve
 *     video/mp4      17,9 MB  ✗ File Too Large
 *     application/pdf 17,9 MB ✓ aceptado   ← el MISMO peso, con otro mime
 *     application/pdf   70 MB ✓ aceptado
 *     image/png          9 MB ✗ File Too Large
 *
 * Dos conclusiones, las dos con consecuencias:
 *
 * 1. **El tope se aplica en la SUBIDA y sale del MIME declarado en el form.**
 *    Por eso «mandar el video como documento» —que tendría 100 MB de margen— no
 *    existe como opción: habría que declarar un mime que no es el del archivo, y
 *    al lead le llegaría un adjunto mal rotulado que WhatsApp no sabe
 *    reproducir. La salida para un video pesado es comprimirlo (ADR 0038).
 * 2. **Los 100 MB de documento son REALES**: el PDF de 70 MB entró. O sea que en
 *    documentos el que corta en 64 somos NOSOTROS, con `express.raw`. Si algún
 *    día hace falta mandar un PDF más gordo, se sube ese `limit` y `documento`
 *    acá — no hay nada del lado de Meta que lo impida.
 *
 * Coincide con la doc oficial (developers.facebook.com/docs/whatsapp/cloud-api/
 * reference/media): imagen 5 MB (solo JPEG/PNG) · video 16 MB (H.264+AAC) ·
 * audio 16 MB · documento 100 MB.
 */

export type ClaseSaliente = MediaSaliente['clase'];

export type LimitesMedia = Record<ClaseSaliente, number>;

const MB = 1024 * 1024;

/**
 * El tope propio de Hermes: `express.raw({ limit: '64mb' })` en `/enviar-media`.
 * Si se toca allá, se toca acá — `limitesMedia.test.ts` los cruza.
 */
export const TOPE_HTTP_BYTES = 64 * MB;

/** Cloud API — los de Meta, que son los que rechazan. */
export const LIMITES_CLOUD_API: LimitesMedia = {
  imagen: 5 * MB,
  video: 16 * MB,
  audio: 16 * MB,
  // Meta acepta 100 MB y está MEDIDO (un PDF de 70 MB entró), pero el cuerpo
  // pasa por `express.raw` con tope de 64: prometer 100 daría un 413 sin
  // mensaje nuestro. El que corta acá somos nosotros, y se puede subir.
  documento: TOPE_HTTP_BYTES,
};

/**
 * whatsmeow y el falso: el tope es el NUESTRO, como hasta hoy.
 *
 * A propósito NO se inventa acá un límite «de WhatsApp»: whatsmeow es una
 * cuenta real y el número que corresponda no está verificado contra nada. Un
 * tope inventado rechazaría envíos que hoy salen bien, que es peor que el
 * problema — y el que sí conocemos (el de `express.raw`) ya está puesto.
 */
export const LIMITES_PROPIOS: LimitesMedia = {
  imagen: TOPE_HTTP_BYTES,
  video: TOPE_HTTP_BYTES,
  audio: TOPE_HTTP_BYTES,
  documento: TOPE_HTTP_BYTES,
};

export function limitesDe(transporte: TransporteWhatsapp['nombre']): LimitesMedia {
  return transporte === 'cloud-api' ? LIMITES_CLOUD_API : LIMITES_PROPIOS;
}

/** «5 MB», «16 MB», «800 KB» — la unidad que corresponda, en criollo. */
export function pesoLegible(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 100 ? mb.toFixed(1).replace(/[.,]0$/, '').replace('.', ',') : Math.round(mb)} MB`;
}

const NOMBRE_CLASE: Record<ClaseSaliente, string> = {
  imagen: 'La imagen',
  video: 'El video',
  audio: 'El audio',
  documento: 'El archivo',
};

/**
 * `null` = entra. Si no, el motivo YA REDACTADO para la vendedora.
 *
 * El mensaje dice las dos cifras —cuánto pesa y cuánto entra— porque con una
 * sola no se puede decidir qué hacer. «Es muy grande» no dice si sobra un mega
 * o quince.
 */
export function motivoPorTamano(
  clase: ClaseSaliente,
  bytes: number,
  limites: LimitesMedia,
): string | null {
  const tope = limites[clase];
  if (!tope || bytes <= tope) return null;
  return `${NOMBRE_CLASE[clase]} pesa ${pesoLegible(bytes)} y por esta línea entran hasta ${pesoLegible(tope)}.`;
}

/**
 * La clase de un adjunto según su mime — la MISMA derivación que ya hacía
 * `/enviar-media` inline. Vive acá para que el límite y la clase no se calculen
 * en dos lados: con dos derivaciones, un `video/quicktime` podría contarse como
 * documento para el tope y como video para el envío.
 */
export function claseDeMime(mime: string): ClaseSaliente {
  if (mime.startsWith('image/')) return 'imagen';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'documento';
}
