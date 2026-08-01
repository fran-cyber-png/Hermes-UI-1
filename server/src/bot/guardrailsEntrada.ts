/**
 * Guardrails de ENTRADA: validación del mensaje del lead antes de que toque el prompt.
 *
 * Tres capas que corren en orden fijo:
 * 1. Sanitización — caracteres de control, whitespace, largo
 * 2. Jailbreak — patrones de prompt injection
 * 3. Intención — clasificación ligera (no se usa para ruteo todavía, solo para logging)
 *
 * El contrato: `validarEntrada(texto)` devuelve `{ ok, texto, motivo? }`.
 * Si `ok === false`, el mensaje no llega al LLM y se registra el motivo.
 *
 * Como `guardrails.ts`, todo es puro: sin DB, sin red, sin estado.
 */

export interface ResultadoEntrada {
  ok: boolean;
  texto: string;
  motivo?: string;
}

// ── Capa 1: Sanitización ────────────────────────────────────────────────

const LARGO_MAXIMO = 4000;

function sanitizar(texto: string): { texto: string; motivo?: string } {
  let t = texto;

  // Caracteres de control excepto whitespace estándar → reemplazar con espacio
  t = t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");

  // Normalizar whitespace: múltiples espacios → uno, trim
  t = t.replace(/\s+/g, " ").trim();

  if (t.length === 0) {
    return { texto: "", motivo: "texto_vacio" };
  }

  if (t.length > LARGO_MAXIMO) {
    return {
      texto: t.slice(0, LARGO_MAXIMO),
      motivo: `texto_excede_${LARGO_MAXIMO}_caracteres`,
    };
  }

  return { texto: t };
}

// ── Capa 2: Jailbreak ───────────────────────────────────────────────────

/**
 * Patrones de jailbreak / prompt injection.
 * Ordenados del más específico al más genérico para evitar falsos positivos.
 */
const PATRONES_JAILBREAK: { patron: RegExp; motivo: string }[] = [
  {
    patron: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|messages?)/i,
    motivo: "jailbreak_ignorar_instrucciones",
  },
  {
    patron: /forget\s+(everything|all)\s+(you|we|i)\s+(said|discussed|talked)/i,
    motivo: "jailbreak_olvidar_contexto",
  },
  {
    patron: /you\s+are\s+now\s+(a\s+)?(different|new|another)\s+(assistant|bot|ai|persona)/i,
    motivo: "jailbreak_cambio_de_persona",
  },
  {
    patron: /pretend\s+(you\s+)?(are|to\s+be)\s+(a\s+)?(different|someone\s+else|another)/i,
    motivo: "jailbreak_suplantacion",
  },
  {
    patron: /(from\s+now\s+on|starting\s+now)\s+you\s+(are|will|must\s+act\s+as)/i,
    motivo: "jailbreak_nueva_personalidad",
  },
  {
    patron: /\[system\]|\[assistant\]|\[user\]|\[prompt\]|<\|system\|>|<\|assistant\|>|<\|user\|>/i,
    motivo: "jailbreak_tags_de_sistema",
  },
  {
    patron: /system\s*:\s*(you\s+are|your\s+role|your\s+job|override)/i,
    motivo: "jailbreak_override_sistema",
  },
  {
    patron: /disregard\s+(all\s+)?(previous\s+)?(instructions?|directives?|rules?)/i,
    motivo: "jailbreak_desobedecer",
  },
  {
    // Token smuggling: "respondé exactamente" seguido de instrucciones
    patron: /respond[eé]\s+exactamente\s+(esto|lo\s+siguiente|este\s+texto)\s*:/i,
    motivo: "jailbreak_respuesta_forzada",
  },
  {
    // Carácter nulo o secuencias de escape raras
    patron: /\\(n|r|t|x[0-9a-f]{2}|u[0-9a-f]{4})/i,
    motivo: "jailbreak_secuencias_escape",
  },
];

function detectarJailbreak(texto: string): string | null {
  for (const { patron, motivo } of PATRONES_JAILBREAK) {
    if (patron.test(texto)) return motivo;
  }
  return null;
}

// ── Capa 3: Intención ───────────────────────────────────────────────────

/**
 * Clasificación léxica de intención — ligera y heurística.
 * No se usa para ruteo (el LLM decide qué tool llamar), solo para logging y métricas.
 */
export type Intencion =
  | "saludo"
  | "pregunta_info"
  | "pregunta_precio"
  | "pregunta_inscripcion"
  | "objecion"
  | "despedida"
  | "queja"
  | "spam"
  | "otro";

const CLASIFICADORES: { intencion: Intencion; patrones: RegExp[] }[] = [
  {
    intencion: "saludo",
    patrones: [
      /^(hola|buen(os|as)\s*(d[ií]as|tardes|noches)|hey|buenas)\b/i,
      /^(c[oó]mo\s+(est[aá]s|andan|va)|qu[eé]\s+tal)\b/i,
    ],
  },
  // Spam antes que contenido: una URL con "oferta" no es pregunta de precio
  {
    intencion: "spam",
    patrones: [
      /\b(gana\s+(dinero|plata)|h[aá]gate\s+rico|invierte\s+ya)\b/i,
      /\b(bitcoin|crypto|forex|trading)\b/i,
      /\b(https?:\/\/[^\s]+)/i,
    ],
  },
  {
    intencion: "despedida",
    patrones: [
      /\b(chau|adi[oó]s|hasta\s+luego|nos\s+vemos|gracias\s+por\s+todo)\b/i,
      /\b(me\s+(voy|retiro|despido)|hasta\s+(pronto|luego|la\s+pr[oó]xima))\b/i,
    ],
  },
  {
    intencion: "objecion",
    patrones: [
      /\b(no\s+(me\s+)?(interesa|puedo|tengo\s+(tiempo|dinero|plata)))\b/i,
      /\b(es\s+(muy\s+)?caro|no\s+me\s+alcanza)\b/i,
      /\b(estoy\s+viendo|lo\s+(pienso|voy\s+a\s+pensar)|despu[eé]s)\b/i,
      /\b(otra\s+(oportunidad|ocasi[oó]n)|m[aá]s\s+adelante)\b/i,
    ],
  },
  {
    intencion: "queja",
    patrones: [
      /\b(no\s+me\s+(gust[oó]|sirve|funciona)|esto\s+es\s+(una\s+)?(estafa|mentira|engaño))\b/i,
      /\b(mal\s+servicio|p[eé]simo|horrible|decepcionante)\b/i,
    ],
  },
  {
    intencion: "pregunta_precio",
    patrones: [
      /\b(precios?|cu[aá]nto\s+(sale|cuesta|vale|es)|costo|valor|tarifas?)\b/i,
      /\b(descuentos?|promoci[oó]n(?:es)?|ofertas?|becas?)\b/i,
      /\b(formas?\s+de\s+pago|cuotas?|financiaci[oó]n)\b/i,
      /\b(c[oó]mo\s+(pago|se\s+paga|pagar)|link\s+de\s+pago)\b/i,
    ],
  },
  {
    intencion: "pregunta_inscripcion",
    patrones: [
      /\b(inscribir|inscripci[oó]n|matricul|registrar|anotar)\b/i,
      /\b(c[oó]mo\s+(me\s+)?(inscribo|anoto|registro|uno))\b/i,
      /\b(fecha\s+de\s+inicio|cu[aá]ndo\s+(empieza|arranca|comienza))\b/i,
      /\b(requisitos?|documentos?|qu[eé]\s+necesito)\b/i,
    ],
  },
  {
    intencion: "pregunta_info",
    patrones: [
      /\b(programas?|cursos?|diplomados?|especializaci[oó]n)\b/i,
      /\b(qu[eé]\s+(ofrecen|tienen|hay)|me\s+interesa|informaci[oó]n)\b/i,
      /\b(modalidad|duraci[oó]n|horario|virtual|presencial)\b/i,
      /\b(certificaci[oó]n|aval|reconocido|v[aá]lido)\b/i,
      /\b(docentes?|profesores?|plan\s+de\s+estudio|temario|contenido)\b/i,
    ],
  },
];

export function clasificarIntencion(texto: string): Intencion {
  for (const { intencion, patrones } of CLASIFICADORES) {
    for (const p of patrones) {
      if (p.test(texto)) return intencion;
    }
  }
  return "otro";
}

// ── API pública ──────────────────────────────────────────────────────────

/**
 * Valida un mensaje entrante del lead en tres capas.
 * Devuelve el texto sanitizado (posiblemente truncado) y un veredicto.
 */
export function validarEntrada(texto: string): ResultadoEntrada {
  // Capa 1: sanitizar
  const s = sanitizar(texto);
  if (s.motivo) {
    return { ok: false, texto: "", motivo: s.motivo };
  }

  // Capa 2: jailbreak
  const jailbreak = detectarJailbreak(s.texto);
  if (jailbreak) {
    return { ok: false, texto: s.texto, motivo: jailbreak };
  }

  // Capa 3: clasificar intención (siempre ok, pero con metadata)
  const intencion = clasificarIntencion(s.texto);

  return { ok: true, texto: s.texto, motivo: `intencion_${intencion}` };
}

/**
 * ¿El mensaje es probablemente spam que el bot no debería contestar?
 * Separo la decisión de la clasificación: clasificarIntencion etiqueta,
 * esto decide si bloquear.
 */
export function esSpam(texto: string): boolean {
  return clasificarIntencion(texto) === "spam";
}
