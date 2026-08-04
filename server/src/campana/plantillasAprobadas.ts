import type { ContenidoDePieza } from "../piezas/version.js";

/**
 * LAS PLANTILLAS APROBADAS DE META, COPIADAS ACÁ — y por qué hace falta la copia.
 *
 * ══ EL CUERPO VIVE EN META, Y AUN ASÍ TIENE QUE VIVIR ACÁ ═══════════════════
 *
 * Meta es la fuente de verdad de una HSM: aprueba el texto, lo versiona y lo
 * manda. Al enviar, la Cloud API devuelve **solo un id**. Sin una copia local,
 * Hermes no puede hacer tres cosas que no son opcionales:
 *
 *   1. **auditar** — `envios_wa.texto` guardaría una fila que no dice qué se
 *      mandó, y esa fila es todo lo que queda cuando alguien pregunta «¿qué le
 *      dijimos a esta persona el 4 de agosto?»;
 *   2. **proyectar** — la vendedora abriría la conversación y vería que salió
 *      algo, sin poder leerlo. El mensaje más importante del día sería el único
 *      invisible en el CRM;
 *   3. **versionar** — la pieza se identifica por `(clase, ref, versión)`, y la
 *      versión es el sha del contenido AUTORAL. Sin el cuerpo no hay sha.
 *
 * ══ ⚠️ EL MODO DE FALLO QUE ESTA COPIA INTRODUCE ════════════════════════════
 *
 * Si alguien edita la plantilla en Meta y esta copia no se entera, **el sha no
 * cambia y dos textos distintos se miden como uno**. Es exactamente el defecto
 * que `piezas/version.ts` existe para no cometer, entrando por la puerta de
 * atrás.
 *
 * Por eso `verificarContraMeta()` no es un extra: es la guarda. Se corre antes
 * de cualquier campaña y compara nombre, idioma, estado y cuerpo con lo que Meta
 * tiene hoy. **Falla cerrado**: ante una diferencia, no se manda.
 *
 * ══ POR QUÉ EN CÓDIGO Y NO EN UNA TABLA ═════════════════════════════════════
 *
 * Mismo criterio que `catalogo/codigo.ts`: son pocas, cambian poco, y una tabla
 * pediría migración y una pantalla para editar algo cuya edición real ocurre en
 * Meta. Cuando sean muchas, se muda — el direccionamiento `(clase, ref)` es
 * textual justamente para que eso no rompa lo acumulado.
 */

export interface PlantillaAprobada {
  /** El `name` en Meta. Es la identidad y la `ref` de la pieza. */
  nombre: string;
  /**
   * El `language.code` EXACTO con el que está aprobada.
   *
   * ⚠️ `promo_3x1_cursos` está registrada como `en` aunque su cuerpo esté en
   * español. Pedirla como `es` da **132001** («the template does not exist in
   * the specified language»). No se corrige adivinando: se corrige en Meta.
   */
  idioma: string;
  /** El cuerpo aprobado, TAL CUAL. Es lo que se audita, se proyecta y se hashea. */
  cuerpo: string;
  /** `true` si el header pide una imagen en cada envío. */
  headerDeImagen: boolean;
}

export const PROMO_3X1: PlantillaAprobada = {
  nombre: "promo_3x1_cursos",
  idioma: "en",
  headerDeImagen: true,
  cuerpo: [
    "🚨 *PROMO 3X1 IMPERDIBLE* 🚨",
    "Fortalece tu perfil profesional en Inteligencia y Seguridad 🧠🕵️‍♂️",
    "",
    "🎓 Accede a 3 beneficios en 1 solo pago:",
    "✅ *Curso online de Inteligencia y Contrainteligencia*",
    "✅ *Curso grabado de Inteligencia Operativa Policial*",
    "✅ *Credencial internacional incluida*",
    "",
    "💵 *TODO por solo $150 USD*",
    "⏰ _SOLO POR HOY_",
    "",
    "*Link de pago* https://api.openpay.pe/occ/M6ftU74Q8acJ",
    "⚠️ Promoción limitada",
    "",
    "📩 _Escríbenos ahora y asegura tu cupo_",
  ].join("\n"),
};

export const PLANTILLAS_APROBADAS: readonly PlantillaAprobada[] = [PROMO_3X1];

export function plantillaPorNombre(nombre: string): PlantillaAprobada | null {
  return PLANTILLAS_APROBADAS.find((p) => p.nombre === nombre) ?? null;
}

/**
 * El contenido que se hashea para la versión de la pieza.
 *
 * Es el cuerpo aprobado **sin renderizar**, igual que en el resto del sistema:
 * hashear el mensaje final haría de cada destinatario una versión distinta.
 */
export function contenidoDe(p: PlantillaAprobada): ContenidoDePieza {
  return { texto: p.cuerpo, archivo: null };
}
