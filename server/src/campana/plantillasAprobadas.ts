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

/**
 * EL XII FORO DE ESTADO — un evento presencial, no un curso.
 *
 * ⚠️ Tres diferencias con `PROMO_3X1` que cambian cómo se manda:
 *
 *   · **El idioma es `es_PE`**, y esta vez es el correcto. La 3x1 quedó
 *     registrada como `en` con el cuerpo en español y hay que pedirla así o da
 *     **132001**; acá no hay que compensar nada. El par `(name, language)` es
 *     lo que resuelve el envío: se copia de Meta, no se deduce del texto.
 *   · **No tiene variables.** El cuerpo trae la fecha, el lugar y el precio
 *     escritos — `{{1}}` no aparece. Es lo que hace que el mensaje envejezca
 *     solo: después del 29 de agosto esta plantilla no se puede volver a usar,
 *     y eso es correcto que duela al mandarla, no al descubrirlo.
 *   · **Las negritas son Unicode**, no el `*asterisco*` de WhatsApp
 *     (`𝗫𝗜𝗜 𝗙𝗢𝗥𝗢 𝗗𝗘 𝗘𝗦𝗧𝗔𝗗𝗢`). Entran en el sha de la versión como cualquier
 *     otro carácter: este cuerpo se generó desde la respuesta de Meta, no se
 *     transcribió, justamente para que un carácter parecido no cuente como una
 *     versión distinta.
 */
export const FORO_ESTADO: PlantillaAprobada = {
  nombre: "foro_estado_5_ago",
  idioma: "es_PE",
  headerDeImagen: true,
  cuerpo: [
    "👋 Hola buen día. Te saluda Luz asesora comercial de Goberna. Quiero invitarlo a participar en el:",
    "",
    "🏛️𝗫𝗜𝗜 𝗙𝗢𝗥𝗢 𝗗𝗘 𝗘𝗦𝗧𝗔𝗗𝗢 - Aniversario GOBERNA 🏛️",
    "Si eres político, candidato, autoridad electa, miembro del personal militar/policial o líder de seguridad en el sector corporativo, este es el espacio donde debes estar este 29 de agosto.",
    "",
    "🗓️Fecha: Sábado 29 de agosto",
    "📍Lugar: Hotel Westin, Lima.",
    "Hora 2:00 PM a 10:00 PM.",
    "👥 𝗔𝗳𝗼𝗿𝗼: Exclusivo para 200 personas.",
    "(Audiencia internacional exclusiva).",
    "",
    "⚡¿𝗣𝗼𝗿 𝗾𝘂é 𝗮𝘀𝗶𝘀𝘁𝗶𝗿?",
    "💼8 𝗵𝗼𝗿𝗮𝘀 de ponencias y mesas de análisis con expertos de primer nivel.",
    "🤝𝗡𝗲𝘁𝘄𝗼𝗿𝗸𝗶𝗻𝗴 de altísimo valor con una red internacional selecta.",
    "",
    "*Único pago de S/360.00*",
    " Categoría General",
    "¿Aprovechas la oferta?",
  ].join("\n"),
};

export const PLANTILLAS_APROBADAS: readonly PlantillaAprobada[] = [PROMO_3X1, FORO_ESTADO];

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
