/**
 * DE UN E.164 A SUS PARTES — el código de país y el número LOCAL, una sola vez.
 *
 * ── Por qué existe este módulo (y por qué no es «plomería») ──
 * Hermes compara teléfonos contra tres padrones distintos —`leads`, el padrón de
 * clientes (`clientes_padron`) y Cerberus— y hasta acá cada uno tenía su propia
 * idea de qué parte del número comparar. La casa usa **el sufijo de 9 dígitos**
 * (`sufijoTelefono`), que es barato, indexable y correcto **si todos son
 * peruanos**. Casi 2 de cada 3 clientes no lo son.
 *
 * El sufijo de 9 se rompe en las dos direcciones cuando el largo nacional no es 9:
 *
 *   · **Local más CORTO que 9** (Guatemala 8, Bolivia 8, Panamá 8, El Salvador,
 *     Honduras, Nicaragua, Costa Rica): los 9 finales del E.164 se comen parte
 *     del código de país. `502` + `12345678` → sufijo `212345678`, que **no
 *     existe** en ningún padrón que guarde el número local. Es una comparación
 *     que no puede dar verdadero nunca — no un match improbable, uno imposible.
 *   · **Local más LARGO que 9** (México 10, Colombia 10, Argentina 10): el sufijo
 *     recorta el número y dos personas distintas pueden compartirlo.
 *
 * `clientes/padron.ts` ya había resuelto la mitad del problema (#119) llevando el
 * teléfono a E.164 antes de sacar el sufijo y guardando el código de país como
 * guarda. Esa tabla de países vivía **privada** adentro de ese archivo, así que
 * el otro lado de la comparación —la búsqueda contra Cerberus, `cerberus/ficha.ts`—
 * no podía usarla y seguía con `slice(-9)` pelado. Resultado: la cola marcaba
 * «Cliente» (padrón, con la guarda) y el panel no encontraba ni una compra
 * (Cerberus, sin ella). La tabla se mudó acá para que la pregunta «¿qué parte de
 * este número identifica a la persona?» tenga UNA respuesta.
 */

/** El dígito que WhatsApp arrastró durante años entre el código de país y el local. */
type DigitoHeredado = "1" | "9";

export interface Pais {
  codigo: string;
  /** Los largos NACIONALES plausibles (sin código de país). */
  largos: readonly number[];
  nombres: readonly string[];
  /**
   * México (`521…`) y Argentina (`549…`) meten un dígito extra entre el código y
   * el número. Cerberus guarda el local SIN ese dígito, así que hay que probar
   * las dos formas o no matchea ninguna.
   */
  heredado?: DigitoHeredado;
}

/**
 * LOS PAÍSES DEL PADRÓN, con su código y los largos nacionales plausibles.
 *
 * Los `largos` son lo que hace confiable detectar el país MIRANDO el número: sin
 * ellos, `502…` podría leerse como Perú (`51`) y cualquier prefijo pegaría con
 * cualquier cosa. Se listan los del padrón real (Perú 2.923 · México 1.987 ·
 * Ecuador 1.981 · Bolivia 934 · R. Dominicana 473 · Colombia 452 · Guatemala 393
 * · Panamá 300) más el resto de LATAM y España, que aparecen de a poco.
 */
export const PAISES: readonly Pais[] = [
  { codigo: "51", largos: [9], nombres: ["peru", "pe", "per"] },
  { codigo: "52", largos: [10, 11], nombres: ["mexico", "mejico", "mx", "mex"], heredado: "1" },
  { codigo: "593", largos: [9, 8], nombres: ["ecuador", "ec", "ecu"] },
  { codigo: "591", largos: [8], nombres: ["bolivia", "bo", "bol"] },
  {
    codigo: "1",
    largos: [10],
    nombres: [
      "republica dominicana", "rep dominicana", "rep. dominicana", "r dominicana",
      "r. dominicana", "dominicana", "do", "dom",
      "estados unidos", "usa", "us", "eeuu", "canada",
    ],
  },
  { codigo: "57", largos: [10], nombres: ["colombia", "co", "col"] },
  { codigo: "502", largos: [8], nombres: ["guatemala", "gt", "gtm"] },
  { codigo: "507", largos: [8], nombres: ["panama", "pa", "pan"] },
  { codigo: "56", largos: [9], nombres: ["chile", "cl", "chl"] },
  { codigo: "54", largos: [10, 11], nombres: ["argentina", "ar", "arg"], heredado: "9" },
  { codigo: "58", largos: [10], nombres: ["venezuela", "ve", "ven"] },
  { codigo: "503", largos: [8], nombres: ["el salvador", "salvador", "sv", "slv"] },
  { codigo: "504", largos: [8], nombres: ["honduras", "hn", "hnd"] },
  { codigo: "505", largos: [8], nombres: ["nicaragua", "ni", "nic"] },
  { codigo: "506", largos: [8], nombres: ["costa rica", "cr", "cri"] },
  { codigo: "595", largos: [9], nombres: ["paraguay", "py", "pry"] },
  { codigo: "598", largos: [8, 9], nombres: ["uruguay", "uy", "ury"] },
  { codigo: "55", largos: [10, 11], nombres: ["brasil", "brazil", "br", "bra"] },
  { codigo: "34", largos: [9], nombres: ["espana", "es", "esp"] },
];

/** Los más largos primero: `502` tiene que ganarle a `5` antes de que alguien pruebe `50`. */
const POR_LARGO_DE_CODIGO = [...PAISES].sort((a, b) => b.codigo.length - a.codigo.length);

/** «México » / «MX» / «mexico» son el mismo país escrito por tres personas distintas. */
export function clavePais(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const POR_NOMBRE = new Map<string, Pais>(
  PAISES.flatMap((p) => p.nombres.map((n) => [clavePais(n), p] as const)),
);

/** El país declarado en una ficha («México», «MX»), o `null` si no se reconoce. */
export function paisDeNombre(nombre: string | null | undefined): Pais | null {
  if (!nombre) return null;
  return POR_NOMBRE.get(clavePais(nombre)) ?? null;
}

/** ¿Estos dígitos ya son un E.164? Devuelve el país si el código Y el largo cierran. */
export function paisDelNumero(digitos: string): Pais | null {
  for (const pais of POR_LARGO_DE_CODIGO) {
    if (!digitos.startsWith(pais.codigo)) continue;
    if (pais.largos.includes(digitos.length - pais.codigo.length)) return pais;
  }
  return null;
}

export interface ParteE164 {
  pais: Pais;
  codigoPais: string;
  /** El número tal como quedó después del código de país (puede traer el heredado). */
  local: string;
}

/**
 * `50212345678` → `{ codigoPais: '502', local: '12345678' }`.
 *
 * `null` cuando el número no se deja leer como E.164 de ningún país conocido: ahí
 * lo honesto es que el llamador caiga a la comparación de siempre y lo sepa, no
 * que este módulo invente una partición.
 */
export function partirE164(crudo: string | null | undefined): ParteE164 | null {
  const digitos = (crudo ?? "").replace(/\D/g, "");
  const pais = paisDelNumero(digitos);
  if (!pais) return null;
  return { pais, codigoPais: pais.codigo, local: digitos.slice(pais.codigo.length) };
}

/**
 * LAS FORMAS EN QUE ESE NÚMERO PUEDE ESTAR GUARDADO DEL OTRO LADO, de la más
 * específica a la más laxa y sin repetidos.
 *
 * Existe porque no hay UNA respuesta: Cerberus guarda el número local en
 * `tb_telefono.numero` y el prefijo en otra columna, pero es un campo de texto
 * cargado por personas a lo largo de años — hay filas con el código de país
 * adentro, y los números mexicanos y argentinos aparecen con y sin el dígito
 * heredado (`521…` / `549…`). Devolver la lista en vez de elegir una permite
 * probar en orden y quedarse con la primera que identifica a UNA persona.
 *
 * El último elemento es SIEMPRE el sufijo de 9 dígitos —lo que la casa usó
 * siempre— así que ningún número que hoy matchea deja de matchear.
 */
export function variantesLocales(crudo: string | null | undefined): string[] {
  const digitos = (crudo ?? "").replace(/\D/g, "");
  if (digitos.length < 6) return [];

  const variantes: string[] = [];
  const partido = partirE164(digitos);

  if (partido) {
    const { pais, local } = partido;
    // El heredado primero SIN él: Cerberus guarda el número que la persona dicta,
    // y nadie dicta el `1` de `521`.
    if (pais.heredado && local.length > 10 && local.startsWith(pais.heredado)) {
      variantes.push(local.slice(1));
    }
    variantes.push(local);
    // El E.164 entero, para las filas cargadas con el código adentro del `numero`.
    variantes.push(digitos);
  }

  // EL RESPALDO DE SIEMPRE. Va último a propósito: es el que trae falsos
  // positivos entre países, así que solo se usa cuando lo específico no dio nada.
  if (digitos.length >= 9) variantes.push(digitos.slice(-9));

  return [...new Set(variantes)];
}

/**
 * El número tal como lo identifica la persona: sin código de país y sin el
 * dígito heredado. `null` si no se deja leer como E.164 conocido.
 */
function nucleo(digitos: string): { codigoPais: string; local: string } | null {
  const partido = partirE164(digitos);
  if (!partido) return null;
  const { pais, local } = partido;
  const sinHeredado =
    pais.heredado && local.length > 10 && local.startsWith(pais.heredado) ? local.slice(1) : local;
  return { codigoPais: pais.codigo, local: sinHeredado };
}

/**
 * ¿ESTOS DOS TELÉFONOS SON EL MISMO? — para VERIFICAR un candidato, no para
 * buscarlo.
 *
 * La búsqueda tiene que ser laxa (un `icontains` de 8 dígitos trae de más); esto
 * es la contraparte ESTRICTA que decide si el candidato que volvió es de verdad
 * esta persona. Sin ella, ensanchar la búsqueda solo cambiaría el falso negativo
 * de hoy por un falso positivo mañana.
 *
 *   · Los dos se dejan partir → tienen que coincidir en **país Y local**. Acá es
 *     donde el mexicano de Veracruz deja de ser el peruano con el mismo sufijo.
 *   · Alguno NO se deja partir (Cerberus guarda el local suelto, sin prefijo, y
 *     así no hay país que leer) → se cae al sufijo de 9, que es lo único
 *     comparable. Se degrada a lo de siempre, nunca a «sí» por default.
 */
export function mismoTelefono(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = (a ?? "").replace(/\D/g, "");
  const db = (b ?? "").replace(/\D/g, "");
  if (da.length < 6 || db.length < 6) return false;
  if (da === db) return true;

  const na = nucleo(da);
  const nb = nucleo(db);
  if (na && nb) return na.codigoPais === nb.codigoPais && na.local === nb.local;

  // Uno de los dos vino sin país legible. Lo comparable es el final del número:
  // el largo del más corto, con techo de 9 (la llave de la casa) y piso de 8
  // (por debajo, dos personas cualesquiera empiezan a coincidir).
  const largo = Math.min(da.length, db.length, 9);
  if (largo < 8) return false;
  return da.slice(-largo) === db.slice(-largo);
}
