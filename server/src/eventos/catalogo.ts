/**
 * EL CATÁLOGO DE EVENTOS DEL CONTACTO — qué puede registrar una persona a mano.
 *
 * El timeline del panel derecho (`src/features/panel/timeline.ts`) se armaba
 * SOLO con eventos derivados: la compra que dice Cerberus, la llegada que dice
 * Meta, el enfriamiento que calcula `senales/`. Todo lo que la vendedora
 * ESCUCHA —«preguntó por el diploma de gestión pública», «dijo que lo ve con su
 * jefe», «no le alcanza el presupuesto»— no tenía dónde caer, y se perdía.
 *
 * Este módulo es la parte pura: el vocabulario y sus reglas, sin base y sin
 * HTTP. Vive separado de `registrarEvento.ts` a propósito — la pregunta «¿este
 * tipo pide un curso?» tiene que poder contestarse en un test sin levantar
 * Postgres.
 *
 * ── LO QUE HACE QUE ESTO SEA DATO Y NO UNA BITÁCORA ──────────────────────────
 * Un `notas LIKE '%cuotas%'` no es una integración: no se puede sumar, ni
 * agrupar por curso, ni cruzar con la pauta (el mismo argumento está escrito en
 * `db/schema.ts` sobre las columnas de `conversiones_wa`). Por eso un evento no
 * es un texto: es un **tipo** del vocabulario + un **dato estructurado**
 * opcional (hoy, el curso con su `producto_id` de Cerberus) + el comentario en
 * criollo. El comentario es el matiz; el tipo es lo que se cuenta.
 */

/**
 * Los tipos que la app OFRECE hoy.
 *
 * ⚠️ **No es la lista de los que se pueden GUARDAR.** Ver `esTipoConocido` y el
 * comentario de `tipoValido`: el server acepta tipos que no están acá, porque el
 * front se despliega sin reiniciar el server (N4 va solo, N5 es un botón) y una
 * vendedora no puede comerse un error por una ventana de deploy.
 */
export const TIPOS_EVENTO = [
  "pregunto_curso",
  "pidio_precio",
  "objecion",
  "quedamos_en",
  "llamada",
  "otro",
] as const;

export type TipoEvento = (typeof TIPOS_EVENTO)[number];

export interface DefinicionEvento {
  /** Lo que se lee en el botón y en el timeline. */
  rotulo: string;
  /**
   * ¿Este tipo se completa con un curso del catálogo de Cerberus? Solo
   * `pregunto_curso` hoy. Es lo que decide si el popover abre el buscador.
   */
  pideCurso: boolean;
  /**
   * ¿El comentario es obligatorio? Lo es donde el tipo NO dice nada por sí
   * solo: «Quedamos en…» sin texto es un evento vacío, y «Otro» sin texto es
   * literalmente nada. Los demás ya afirman algo con solo existir.
   */
  exigeNota: boolean;
  /** El placeholder del comentario — concreto, no «escribí algo…». */
  ejemplo: string;
}

/**
 * El vocabulario, con su regla al lado.
 *
 * Es un `Record` sobre `TipoEvento` a propósito: agregar un tipo a
 * `TIPOS_EVENTO` sin describirlo acá **no compila**. Es la misma guarda que
 * `DESCRIPCION_MOMENTO` en `catalogo/vocabulario.ts`.
 */
export const CATALOGO_EVENTOS: Record<TipoEvento, DefinicionEvento> = {
  pregunto_curso: {
    rotulo: "Preguntó por un curso",
    pideCurso: true,
    exigeNota: false,
    ejemplo: "cómo lo dijo, si mencionó otro…",
  },
  pidio_precio: {
    rotulo: "Pidió precio",
    pideCurso: false,
    exigeNota: false,
    ejemplo: "preguntó por cuotas, por el pago…",
  },
  objecion: {
    rotulo: "Objeción",
    pideCurso: false,
    exigeNota: true,
    ejemplo: "«está caro», «lo veo el otro mes»…",
  },
  quedamos_en: {
    rotulo: "Quedamos en…",
    pideCurso: false,
    exigeNota: true,
    ejemplo: "qué se acordó, con quién, para cuándo",
  },
  llamada: {
    rotulo: "Llamada hecha",
    pideCurso: false,
    exigeNota: false,
    ejemplo: "qué se habló, si no contestó…",
  },
  otro: {
    rotulo: "Otro",
    pideCurso: false,
    exigeNota: true,
    ejemplo: "qué pasó",
  },
};

/** ¿Está en el vocabulario que esta versión conoce? */
export function esTipoConocido(tipo: string): tipo is TipoEvento {
  return (TIPOS_EVENTO as readonly string[]).includes(tipo);
}

/**
 * EL RÓTULO DE UN TIPO, incluido el que esta versión no conoce.
 *
 * Un tipo desconocido **no tira y no se descarta**: se muestra tal cual venía.
 * Es la misma decisión que toma `canales/bot.ts` con los motivos del bot y que
 * el schema de Ivi con `tipo` — el vocabulario crece sin coordinar releases, y
 * la rama conservadora nunca puede ser un throw ni un valor parecido inventado.
 *
 * `pregunto_curso` → «Preguntó curso» es un fallback legible, no una
 * traducción: sirve para que un front viejo muestre algo que se entienda en vez
 * de un slug crudo.
 */
export function rotuloDeTipo(tipo: string): string {
  if (esTipoConocido(tipo)) return CATALOGO_EVENTOS[tipo].rotulo;
  const limpio = tipo.trim().replace(/_/g, " ");
  if (!limpio) return "Evento";
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

/** Topes. El comentario es una línea de contexto, no una nota de la Libreta. */
export const TOPE_NOTA = 500;
export const TOPE_CURSO = 120;

/**
 * ¿Sirve como `tipo`?
 *
 * NO se valida contra `TIPOS_EVENTO`, y esa es la decisión de este archivo.
 * El front se despliega SIN reiniciar el server (N4 va solo; N5 es un botón,
 * `docs/despliegue-continuo.md`), así que hay una ventana real en la que la app
 * ofrece un tipo que el server todavía no tiene en su lista. Rechazarlo ahí
 * convierte un deploy escalonado en «no se pudo registrar» para la vendedora,
 * que es exactamente lo que este feature vino a evitar.
 *
 * Lo que sí se exige es que **parezca un término de un vocabulario** y no una
 * frase: minúsculas, guion bajo, hasta 32. Así un tipo nuevo entra sin deploy
 * del server, pero un texto libre —o un dedazo con espacios y tildes— no se
 * cuela como si fuera una categoría.
 */
export function tipoValido(tipo: string): boolean {
  return /^[a-z][a-z_]{0,31}$/.test(tipo);
}

export interface EntradaCruda {
  tipo?: unknown;
  curso?: unknown;
  productoId?: unknown;
  nota?: unknown;
}

export interface EventoLimpio {
  tipo: string;
  curso: string | null;
  productoId: string | null;
  nota: string | null;
}

export type Validacion =
  | { ok: true; evento: EventoLimpio }
  | { ok: false; message: string };

/**
 * Normaliza y valida lo que llegó por HTTP. Puro: la ruta decide el status, acá
 * se decide qué es un evento.
 *
 * `exigeNota` se chequea SOLO para los tipos conocidos — para uno que esta
 * versión no conoce no hay regla que aplicar, y inventarle una (exigir o no
 * exigir) sería afirmar algo sobre un tipo del que no sabemos nada.
 */
export function validarEvento(cruda: EntradaCruda): Validacion {
  const tipo = String(cruda.tipo ?? "").trim();
  if (!tipo) return { ok: false, message: "falta el tipo de evento" };
  if (!tipoValido(tipo)) {
    return {
      ok: false,
      message: `tipo de evento inválido (se esperaba uno de: ${TIPOS_EVENTO.join(" | ")})`,
    };
  }

  const nota = String(cruda.nota ?? "")
    .trim()
    .slice(0, TOPE_NOTA);
  const curso = String(cruda.curso ?? "")
    .trim()
    .slice(0, TOPE_CURSO);
  const productoId = String(cruda.productoId ?? "").trim();

  if (esTipoConocido(tipo)) {
    const def = CATALOGO_EVENTOS[tipo];
    if (def.exigeNota && !nota) {
      return { ok: false, message: `«${def.rotulo}» necesita que escribas qué pasó` };
    }
    if (def.pideCurso && !curso) {
      return { ok: false, message: `«${def.rotulo}» necesita el curso por el que preguntó` };
    }
  }

  return {
    ok: true,
    evento: {
      tipo,
      curso: curso || null,
      // Un `producto_id` sin curso no direcciona nada: es basura que después
      // ensucia el cruce con Cerberus. Va atado o no va.
      productoId: curso && productoId ? productoId : null,
      nota: nota || null,
    },
  };
}
