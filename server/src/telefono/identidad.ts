import { PAISES, paisDelNumero, type Pais } from "./paises.js";

/**
 * LA IDENTIDAD DE UN TELÉFONO — el par (país, número local) con el que dos filas
 * de dos tablas distintas hablan de la MISMA persona.
 *
 * ── El problema, medido (11-ago-2026, prod) ──
 * Los JOIN de la cola cruzan teléfonos por `sufijoTelefonoSql`, los últimos 9
 * dígitos. Sobre los 448 cruces reales entre `interactions` y `leads`:
 *
 *   · 373 (83,3 %) son el MISMO número completo — bien.
 *   ·  27 ( 6,0 %) uno es sufijo del otro (E.164 de un lado, local del otro) —
 *     el match laxo ACIERTA, y cualquier arreglo tiene que seguir acertando.
 *   ·  34 ( 7,6 %) mismo país, largo distinto (`5151…`, `593593…`: el código de
 *     país cargado dos veces) — también la misma persona.
 *   ·  **14 ( 3,1 %) PAÍS DISTINTO** — Perú↔Chile, Perú↔Panamá, Perú↔México,
 *     Perú↔Argentina. Son falsos positivos: a esa conversación se le cuelga el
 *     lead de otra persona, y con él su curso y su campaña.
 *
 * O sea que el sufijo de 9 no está «mayormente mal»: está bien en la enorme
 * mayoría y mal en un puñado que **no se puede ver desde la pantalla**, porque
 * un lead equivocado se ve exactamente igual que uno correcto.
 *
 * ── 🔴 CUÁNTO ARREGLA ESTO, MEDIDO CONTRA PRODUCCIÓN (no estimado) ──
 * Se corrió la regla vieja y la nueva sobre los 3.945 teléfonos con conversación
 * y los 21.955 de `leads`:
 *
 *   pares con la regla VIEJA (sufijo de 9) : 448
 *   pares con la regla NUEVA (local+país)  : 445
 *     en ambas                             : 445
 *     dejan de unirse                      :   3
 *     empiezan a unirse                    :   0
 *
 * **Son 3, no 14.** El bucket «país distinto» de la medición inicial tenía 14
 * pares, pero se clasificó con una heurística de prefijos; al mirarlos con la
 * tabla de países, **sólo 3 tienen los DOS lados parseables y con países que se
 * contradicen** (Perú↔Chile ×2, Perú↔Ecuador). En los otros 11 hay un lado que
 * no se deja leer como E.164, así que la guarda **no puede probar nada y se
 * abstiene** — siguen uniéndose, igual que antes. Eso es la degradación honesta
 * de `codigoPais: null`, y es deuda declarada, no un arreglo silencioso.
 *
 * Y **0 falsos negativos**: ni un solo par que hoy se une deja de unirse por
 * error. Ése es el invariante que hacía falta demostrar, más que el tamaño de la
 * mejora.
 *
 * ⚠️ **Dónde está el beneficio grande, y por qué no se ve acá**: el 14,5 % de las
 * conversaciones son de países con local de 8 dígitos (Panamá 5,6 % · Guatemala
 * 5,0 % · Bolivia 3,9 %), donde el sufijo de 9 arranca ADENTRO del código de
 * país. Contra `leads` no se nota porque los dos lados guardan E.164 completo y
 * el sufijo se equivoca igual de los dos lados. Se nota contra **Cerberus**, que
 * guarda el número local suelto — y ese cruce no está medido todavía.
 *
 * ── Por qué (país, local) y no «el E.164 completo» ──
 * Exigir que los dígitos sean idénticos mataría los 14 falsos positivos **y
 * también los 61 aciertos** de los buckets 2 y 3, que son la misma persona
 * guardada de dos formas. La llave tiene que normalizar antes de comparar.
 *
 * ── Por qué el largo nacional hace casi todo el trabajo ──
 * México y Colombia tienen 10 dígitos locales, Guatemala y Bolivia 8, Perú 9.
 * Comparando el LOCAL exacto, un mexicano y un peruano ya no pueden chocar: sus
 * locales tienen largos distintos. El código de país queda como guarda para el
 * residuo real, que son los países de 9 dígitos entre sí (Perú · Chile · Ecuador
 * · Paraguay · España) — y esos son justo los 14 medidos.
 *
 * ── El gemelo ──
 * `identidadSql.ts` dice esto mismo en SQL, GENERADO desde `PAISES` para que no
 * exista una segunda tabla de países que se pueda desincronizar. El candado es
 * `identidad.paridad.test.db.ts`, que corre las dos contra los teléfonos reales.
 * Es el patrón de `ventana.ts` / `ventanaCierraSql` y la lección de #37.
 */

/** Los más largos primero: `502` tiene que ganarle a `5` y a `50`. */
const POR_LARGO_DE_CODIGO = [...PAISES].sort((a, b) => b.codigo.length - a.codigo.length);

/** ¿El remanente después del código tiene un largo nacional plausible para ese país? */
function largoPlausible(pais: Pais, digitos: string): boolean {
  return pais.largos.includes(digitos.length - pais.codigo.length);
}

/**
 * LAS DOS DEFORMACIONES QUE TRAE EL DATO REAL, arregladas sólo cuando arreglarlas
 * produce un E.164 válido.
 *
 * Medido en `leads`: 292 sufijos con más de un número detrás, y el reparto de
 * prefijos que colisionan es `{593,5930}` 79 · `{51,5151}` 35 · `{593,593593}` 14
 * · `{525,52525}` 8 … O sea que **casi toda la colisión de este padrón no es
 * ambigüedad entre países: es el mismo número escrito mal**.
 *
 *   1. **Código de país cargado dos veces** (`5151…`, `593593…`).
 *   2. **Cero troncal después del código** (`5930…`), que es como se dicta el
 *      número dentro del país y no va en E.164.
 *
 * La condición «sólo si el resultado parsea» es lo que lo vuelve seguro: un
 * número legítimo que por casualidad empiece con su propio código de país no se
 * toca, porque sacárselo lo dejaría con un largo nacional imposible.
 */
export function normalizarE164(crudo: string | null | undefined): string {
  const digitos = (crudo ?? "").replace(/\D/g, "");
  if (digitos.length < 6) return digitos;

  for (const pais of POR_LARGO_DE_CODIGO) {
    const doble = pais.codigo + pais.codigo;
    if (digitos.startsWith(doble)) {
      const sinRepetir = digitos.slice(pais.codigo.length);
      if (largoPlausible(pais, sinRepetir)) return sinRepetir;
    }
  }
  for (const pais of POR_LARGO_DE_CODIGO) {
    const conCero = pais.codigo + "0";
    if (digitos.startsWith(conCero)) {
      const sinCero = pais.codigo + digitos.slice(conCero.length);
      if (largoPlausible(pais, sinCero)) return sinCero;
    }
  }
  return digitos;
}

export interface ClaveTelefono {
  /**
   * EL NÚMERO LOCAL — sin código de país y sin el dígito heredado de México y
   * Argentina. Es la parte con la que se hace el equi-join, así que es indexable.
   *
   * Cuando el número no se deja leer como E.164 de ningún país conocido, cae al
   * sufijo de 9 dígitos de siempre: ahí no hay país que sacar y lo comparable es
   * el final. Degrada a lo que la casa ya hacía, nunca a algo más laxo.
   */
  local: string;
  /**
   * EL CÓDIGO DE PAÍS, o `null` cuando no se pudo leer.
   *
   * `null` NO significa «no coincide»: significa «no lo sé», y la comparación lo
   * trata como comodín. Es la misma degradación honesta que `clientes_padron`
   * ya usa con su columna `codigo_pais`.
   */
  codigoPais: string | null;
}

/** La clave vacía: un número que no alcanza para identificar a nadie. */
const SIN_CLAVE: ClaveTelefono = { local: "", codigoPais: null };

/**
 * `+502 1234-5678` → `{ local: '12345678', codigoPais: '502' }`.
 * `987654321`      → `{ local: '987654321', codigoPais: null }` (sin país legible).
 *
 * ⚠️ Guatemala es el caso que más cambia: su local tiene 8 dígitos, así que el
 * sufijo de 9 se comía un pedazo del código de país y producía `212345678`, que
 * **no existe en ningún padrón**. Era una comparación que no podía dar verdadero
 * nunca — el CLAUDE.md del repo lo llama «393 clientes invisibles».
 */
export function claveTelefono(crudo: string | null | undefined): ClaveTelefono {
  const digitos = normalizarE164(crudo);
  if (digitos.length < 6) return SIN_CLAVE;

  const pais = paisDelNumero(digitos);
  if (!pais) {
    return digitos.length >= 9
      ? { local: digitos.slice(-9), codigoPais: null }
      : { local: digitos, codigoPais: null };
  }

  const local = digitos.slice(pais.codigo.length);
  const sinHeredado =
    pais.heredado && local.length > 10 && local.startsWith(pais.heredado) ? local.slice(1) : local;
  return { local: sinHeredado, codigoPais: pais.codigo };
}

/**
 * ¿ESTAS DOS CLAVES SON LA MISMA PERSONA?
 *
 * El local tiene que ser idéntico, y los países tienen que no contradecirse.
 * `null` de cualquier lado es comodín: sabemos menos, no decidimos que no.
 *
 * Esta es la regla que `mismoTelefonoSql` reproduce en el `ON` de los JOIN.
 */
export function mismaClave(a: ClaveTelefono, b: ClaveTelefono): boolean {
  if (!a.local || !b.local) return false;
  if (a.local !== b.local) return false;
  if (a.codigoPais === null || b.codigoPais === null) return true;
  return a.codigoPais === b.codigoPais;
}

/** Atajo para comparar dos teléfonos crudos con la regla de arriba. */
export function mismaIdentidadTelefonica(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return mismaClave(claveTelefono(a), claveTelefono(b));
}
