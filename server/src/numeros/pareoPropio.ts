import { mismaVendedora } from "../reparto/destino.js";
import { VIGENCIA_QR_MS } from "./dominio.js";

/**
 * EL CANDADO DE LA AUTO-VINCULACIÓN — con DUEÑO y con CADUCIDAD.
 *
 * El vinculador es global y de a un pareo por vez (`whatsapp/vinculador.ts`,
 * D13). `routes/miLinea.ts` le agrega arriba un candado propio que responde la
 * pregunta que el vinculador no sabe contestar: **de QUIÉN es el pareo en
 * vuelo**. Sin eso, si Ana empieza un pareo y Bea consulta el estado, Bea ve el
 * QR de Ana y —peor— si llega justo cuando conecta, la línea de Ana queda
 * escrita como propia de Bea.
 *
 * ══ 🔴 UN CANDADO SIN CADUCIDAD BLOQUEA HASTA EL PRÓXIMO REINICIO ══════════
 *
 * La primera versión era un `let pareoActual` que sólo se soltaba en los caminos
 * que alguien se acordó de escribir: cancelar a mano, conectar, error, baneado.
 * Faltaba el más común de todos — **cerrar el modal**. La vendedora aprieta la X
 * (o Escape, o se le muere el navegador) y el candado queda tomado: nadie más
 * puede auto-vincular, ni Cerberus vincular por `/api/admin`, hasta que alguien
 * reinicie Hermes. Y reiniciar Hermes es justo lo que este frente no puede
 * permitirse (#194: 24 reinicios por semana ya le comen la vida a la línea).
 *
 * La caducidad es la MISMA constante que ya usa el vinculador
 * (`VIGENCIA_QR_MS`), y se comparte a propósito en vez de copiarse: dos vigencias
 * distintas dan la ventana en la que uno se soltó y el otro no, que es la peor de
 * las dos (el candado libre sobre un vinculador tomado da un 409 que nadie
 * entiende). Mientras la vendedora mira el QR, cada poll —1,5 s— vuelve a sellar
 * `tocadoEn`: el candado sólo caduca cuando **dejó de haber alguien mirando**.
 *
 * ══ Y COMPARA NORMALIZANDO LOS DOS LADOS ══════════════════════════════════
 *
 * 🔴 El dueño se compara con `mismaVendedora`, nunca con `!==`. Es la cicatriz de
 * siempre: Cerberus empuja `Luz`, ella entra escribiendo `luz`. Con comparación
 * exacta, quien empieza el pareo con una grafía y vuelve con la otra ve
 * `expirado` en el primer poll —«La vinculación se cortó»— sobre un pareo que
 * está perfectamente vivo, y encima no lo puede ni cancelar (le contesta
 * `vinculacion_ajena`, sobre el suyo).
 *
 * Puro y aparte de la ruta: acá se puede interrogar «¿qué pasa al minuto
 * siguiente?» sin esperar un minuto.
 */

export interface PareoPropio {
  /** El número que se está pareando, ya normalizado. */
  readonly numero: string;
  /** Quién lo empezó, con la grafía que traía el token. */
  readonly vendedoraId: string;
  /** Cuándo dio señales por última vez. Cada poll lo vuelve a sellar. */
  readonly tocadoEn: number;
}

/**
 * La vigencia del candado ES la del pareo del vinculador. Se re-exporta con
 * nombre propio para que se lea desde acá, pero es la misma constante: ver
 * arriba por qué no puede ser otra.
 */
export const VIGENCIA_PAREO_MS = VIGENCIA_QR_MS;

/** El candado leído a través del reloj: `null` si no hay o si caducó. */
export function pareoVigente(pareo: PareoPropio | null, ahora: number): PareoPropio | null {
  if (!pareo) return null;
  return ahora - pareo.tocadoEn > VIGENCIA_PAREO_MS ? null : pareo;
}

/** ¿El pareo en vuelo es de esta persona? Vigencia y dueño, en una sola pregunta. */
export function esMiPareo(pareo: PareoPropio | null, vendedoraId: string, ahora: number): boolean {
  const vivo = pareoVigente(pareo, ahora);
  return vivo !== null && mismaVendedora(vivo.vendedoraId, vendedoraId);
}
