import { paisDelNumero } from "../telefono/paises.js";

/**
 * UNA CAMPAÑA A UNA LISTA DE AFUERA — y en qué se diferencia de la otra.
 *
 * ══ ESTO NO ES LO MISMO QUE `publico.ts` ════════════════════════════════════
 *
 * `publico.ts` elige entre gente que **escribió**: cada candidato viene con su
 * conversación, su anuncio y su historial, y la pregunta es «¿a cuál de los que
 * levantaron la mano le corresponde este mensaje?». Acá no hay conversación:
 * la lista la trae un archivo, y la mayoría de esas personas **nunca le
 * escribió a este número**.
 *
 * Es contacto en frío, que es una decisión de negocio y no un parámetro (ADR
 * 0015 §37 lo prohíbe, y el propio CLAUDE.md anota el outbound al padrón como
 * «otro frente»). Este módulo no la toma: la ejecuta y la deja auditable.
 *
 * ══ LO QUE SÍ RESUELVE, Y POR QUÉ ES LO QUE MÁS DUELE ═══════════════════════
 *
 * **El teléfono.** Cuando el destinatario ya te escribió, su número te lo dio
 * WhatsApp y es correcto por construcción. Cuando sale de una planilla cargada
 * por personas durante años, no: en la base del Foro conviven `995984814`,
 * `+51 995984814`, `5151987802049` (el código de país pegado dos veces) y
 * `511234`. Un número mal leído no es un envío perdido — es un mensaje que le
 * llega **a otra persona**, y en frío esa persona no tiene con qué entender
 * quién le escribe.
 *
 * Por eso la regla es **estricta y angosta**: entra lo que se lee de UNA sola
 * forma, y todo lo demás se descarta CON SU MOTIVO. Adivinar la partición de
 * `512221285857` (¿`51`+10 dígitos? ¿un mexicano con `51` adelante?) es
 * exactamente la clase de conjetura que después se lee como un match.
 *
 * ⚠️ **No se reusa `variantesLocales`**: esa función existe para BUSCAR (probar
 * varias formas y quedarse con la que identifica a una persona) y acá hay que
 * ESCRIBIR. Una lista de candidatos plausibles es la respuesta correcta a
 * «¿cuál de estos es?» y la respuesta equivocada a «¿a qué número mando?».
 * `paisDelNumero` sí se reusa: es la tabla de países de la casa, y sirve para
 * decir «este es de otro país» en vez de amontonarlo en «ilegible».
 */

/** Una fila cruda del archivo, ya separada en columnas. */
export interface FilaDeLista {
  /** Su posición en el archivo (1 = primera fila de datos). Para poder señalarla. */
  linea: number;
  telefono: string | null | undefined;
  nombre: string | null | undefined;
  /** La columna de estado del archivo («Contactado», «Desinteresado», …). */
  estado: string | null | undefined;
}

/**
 * POR QUÉ UNA FILA NO ENTRA. Lista cerrada: un motivo que no está acá no se
 * puede descartar en silencio, y el simulacro los imprime todos —incluso en
 * cero—, que es la lección de la primera campaña.
 */
export const MOTIVOS_DE_LISTA = [
  "dijo_que_no",
  "ya_inscrito",
  "sin_telefono",
  "otro_pais",
  "telefono_ilegible",
  "duplicado",
] as const;
export type MotivoDeLista = (typeof MOTIVOS_DE_LISTA)[number];

export interface FilaDescartada {
  linea: number;
  /** El teléfono TAL COMO venía. Sin esto no se puede corregir el archivo. */
  crudo: string;
  motivo: MotivoDeLista;
}

export interface DestinatarioDeLista {
  /** E.164 sin `+`, que es como Hermes guarda los teléfonos. */
  telefono: string;
  nombre: string | null;
  linea: number;
}

export interface ListaLeida {
  destinatarios: DestinatarioDeLista[];
  descartadas: FilaDescartada[];
}

/**
 * LOS ESTADOS DEL ARCHIVO QUE VETAN UN ENVÍO.
 *
 * Se comparan en minúsculas y sin acentos porque la columna la cargan personas:
 * en la base del Foro conviven `Contactado`, `Inscrito` y `RESERVADO`.
 *
 * `desinteresado` es **la misma regla que `rechazo.ts`**, por otra puerta: quien
 * ya dijo que no, no recibe. Que acá lo diga una columna en vez de un mensaje no
 * lo hace menos explícito — al contrario, alguien lo escribió a mano.
 *
 * `inscrito`/`reservado` no son un rechazo: ya tienen su lugar en el Foro, y
 * venderles una entrada que ya compraron es el defecto que la campaña anterior
 * pagó con las 5 personas que ya habían comprado.
 */
const ESTADO_VETA: Record<string, MotivoDeLista> = {
  desinteresado: "dijo_que_no",
  inscrito: "ya_inscrito",
  reservado: "ya_inscrito",
};

function normalizarEstado(estado: string | null | undefined): string {
  return (estado ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/** Lo que Perú permite: 9 dígitos nacionales que empiezan con 9 (móvil). */
const PERU = { codigo: "51", largo: 9, inicial: "9" } as const;

export type Normalizacion =
  | { ok: true; telefono: string }
  | { ok: false; motivo: Extract<MotivoDeLista, "sin_telefono" | "otro_pais" | "telefono_ilegible"> };

/**
 * A E.164 PERUANO, O NADA.
 *
 * Dos formas entran, y ninguna más:
 *
 *   · `987654321`   → 9 dígitos que empiezan con 9  → `51987654321`
 *   · `51987654321` → ya viene con el código        → tal cual
 *
 * Todo lo demás sale con motivo. Los casos reales que esto rechaza a propósito,
 * medidos sobre la base del Foro (3.585 filas):
 *
 *   · `512221285857` (12 díg.) — `51` + 10 dígitos. Perú no tiene locales de 10.
 *     Podría ser un mexicano con `51` adelante; podría ser un dedo de más. No
 *     hay forma de saberlo, y en frío el costo de acertar mal es escribirle a
 *     un desconocido.
 *   · `5151987802049` (13 díg.) — el código de país **dos veces**. Se ve fácil
 *     de arreglar y no se arregla: si el que carga se equivocó una vez, no hay
 *     motivo para creerle al resto del número.
 *   · `59165375423`, `13075337574` — Bolivia, EE. UU. Son de otro país y el
 *     Foro es presencial en Lima; se descartan con SU motivo, no como basura.
 *   · `511234`, `29652546` — no llegan a número.
 *
 * El sesgo es deliberado y es el mismo que el de `rechazo.ts`: **al falso
 * negativo**. Preferimos no escribirle a alguien que sí existía antes que
 * escribirle a alguien que no era.
 */
export function aE164Peru(crudo: string | null | undefined): Normalizacion {
  const digitos = (crudo ?? "").replace(/\D/g, "");
  if (digitos.length === 0) return { ok: false, motivo: "sin_telefono" };

  if (digitos.length === PERU.largo && digitos.startsWith(PERU.inicial)) {
    return { ok: true, telefono: PERU.codigo + digitos };
  }
  if (
    digitos.length === PERU.codigo.length + PERU.largo &&
    digitos.startsWith(PERU.codigo + PERU.inicial)
  ) {
    return { ok: true, telefono: digitos };
  }

  /**
   * ⚠️ La pregunta por el país va DESPUÉS de las dos formas peruanas, no antes.
   *
   * `paisDelNumero('51987654321')` contesta Perú, sí — pero también contesta
   * algo para números que Perú no puede tener, y sobre todo `1` (EE. UU.) pega
   * con cualquier cosa de 11 dígitos. Acá sólo se usa para NOMBRAR lo que ya se
   * decidió descartar, nunca para aceptar.
   */
  const pais = paisDelNumero(digitos);
  if (pais && pais.codigo !== PERU.codigo) return { ok: false, motivo: "otro_pais" };
  return { ok: false, motivo: "telefono_ilegible" };
}

/**
 * EL ORDEN DE LOS DESCARTES IMPORTA, igual que en `publico.ts`.
 *
 * Cada fila sale con UN motivo, el primero que la agarra, y el orden va de lo
 * más grave a lo más mecánico: que alguien figure como «Desinteresado» explica
 * por qué no le escribimos mucho mejor que «su teléfono estaba mal cargado»,
 * aunque las dos sean verdad. Al revés, el informe diría «40 teléfonos
 * ilegibles» y ni un rechazo, y nadie miraría dos veces.
 *
 * Y **el orden del archivo se respeta**: «los 1.000 primeros» tiene que
 * significar los 1.000 primeros. El tope lo aplica el llamador, sobre esta
 * lista ya limpia.
 */
export function leerLista(filas: readonly FilaDeLista[]): ListaLeida {
  const destinatarios: DestinatarioDeLista[] = [];
  const descartadas: FilaDescartada[] = [];
  const vistos = new Set<string>();

  for (const fila of filas) {
    const crudo = (fila.telefono ?? "").trim();
    const veto = ESTADO_VETA[normalizarEstado(fila.estado)];
    if (veto) {
      descartadas.push({ linea: fila.linea, crudo, motivo: veto });
      continue;
    }

    const numero = aE164Peru(crudo);
    if (!numero.ok) {
      descartadas.push({ linea: fila.linea, crudo, motivo: numero.motivo });
      continue;
    }

    /**
     * EL DUPLICADO SE MIDE SOBRE EL NÚMERO NORMALIZADO, no sobre el crudo.
     *
     * `987654321` y `+51 987654321` son dos filas distintas del archivo y una
     * sola persona. Comparando el texto tal como vino, esa persona recibiría el
     * mensaje dos veces — que es la forma más visible de que hay una máquina
     * detrás, y la que más rápido gana un bloqueo.
     */
    if (vistos.has(numero.telefono)) {
      descartadas.push({ linea: fila.linea, crudo, motivo: "duplicado" });
      continue;
    }
    vistos.add(numero.telefono);

    const nombre = (fila.nombre ?? "").trim();
    destinatarios.push({
      telefono: numero.telefono,
      nombre: nombre.length > 0 ? nombre : null,
      linea: fila.linea,
    });
  }

  return { destinatarios, descartadas };
}

/** Cuántas filas cayeron por cada motivo, para el renglón del simulacro. */
export function contarMotivosDeLista(
  descartadas: readonly FilaDescartada[],
): Record<MotivoDeLista, number> {
  const cuenta = Object.fromEntries(MOTIVOS_DE_LISTA.map((m) => [m, 0])) as Record<
    MotivoDeLista,
    number
  >;
  for (const d of descartadas) cuenta[d.motivo]++;
  return cuenta;
}

/**
 * EL CSV, PARSEADO ACÁ Y NO CON UNA DEPENDENCIA.
 *
 * El archivo original es un `.xlsx` y el server **no tiene con qué leerlo** —
 * ni debe: una dependencia de ofimática en el server para una campaña es peso
 * permanente por un uso puntual. La conversión a CSV es un paso de afuera, y
 * este parser cubre lo único que un export de planilla produce: comas, comillas
 * dobles y comillas escapadas duplicando (`""`).
 *
 * Se espera cabecera con `telefono`, `nombre` y `estado` (en cualquier orden;
 * las que falten quedan vacías). Sin cabecera reconocible **tira**, en vez de
 * leer la primera persona como nombre de columna y perderla en silencio.
 */
export function parsearCsv(texto: string): FilaDeLista[] {
  const filas = filasDeCsv(texto);
  if (filas.length === 0) throw new Error("el CSV está vacío");

  const cabecera = filas[0]!.map((c) => normalizarEstado(c));
  const col = (nombre: string) => cabecera.indexOf(nombre);
  const iTel = col("telefono");
  const iNom = col("nombre");
  const iEst = col("estado");
  if (iTel < 0) {
    throw new Error(`el CSV no tiene columna «telefono» (cabecera: ${cabecera.join(", ")})`);
  }

  return filas.slice(1).map((campos, i) => ({
    linea: i + 1,
    telefono: campos[iTel] ?? null,
    nombre: iNom >= 0 ? (campos[iNom] ?? null) : null,
    estado: iEst >= 0 ? (campos[iEst] ?? null) : null,
  }));
}

function filasDeCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let campos: string[] = [];
  let campo = "";
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (entreComillas) {
      if (c === '"') {
        // `""` adentro de un campo entrecomillado es una comilla literal.
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else entreComillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') entreComillas = true;
    else if (c === ",") {
      campos.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      // `\r\n` cuenta como UN corte: el `\n` que sigue cae en un campo vacío.
      if (c === "\r" && texto[i + 1] === "\n") i++;
      campos.push(campo);
      filas.push(campos);
      campos = [];
      campo = "";
    } else campo += c;
  }
  if (campo.length > 0 || campos.length > 0) {
    campos.push(campo);
    filas.push(campos);
  }

  // Una línea en blanco al final no es una fila.
  return filas.filter((f) => f.some((c) => c.trim().length > 0));
}
