import { sufijoTelefono } from "../whatsapp/identidadWa.js";
import { nivelDeCliente, type NivelCliente } from "./nivel.js";

/**
 * EL PADRÓN DE CLIENTES, FILA POR FILA (#133) — puro, sin base y sin red.
 *
 * ── Qué hace ──
 * Toma una fila cruda del padrón (hoy `icarus.contacts`, el espejo vivo de quién
 * le compró a Goberna) y deja SOLO lo que la cola necesita para reconocer a un
 * ex-cliente entre 1.997 conversaciones: con qué llave cruzarlo, de qué país es
 * y qué tan cliente es. Devuelve `null` cuando la fila no aporta nada — sin
 * teléfono no hay con qué cruzar, sin compras no hay ex-cliente que marcar.
 *
 * ── §PII: lo que deliberadamente NO se copia ──
 * Nombre, correo, DNI, dirección y monto gastado se quedan en el padrón. Hermes
 * ya tiene la ficha viva de Cerberus para eso (`cerberus/ficha.ts`) y la copia
 * local existe para UNA cosa: pintar la marca de la fila sin una llamada HTTP
 * por conversación. Copiar más sería armar un segundo padrón de clientes, con su
 * propia deriva y su propia superficie de fuga, para no usarlo.
 *
 * ── §La llave de match, y el falso positivo de #119 ──
 * La llave sigue siendo la de la casa: **los últimos 9 dígitos** (`sufijoTelefono`,
 * el mismo que usan la cola, la ficha y el Dashboard vía `sufijoTelefonoSql`).
 * No se inventa una segunda forma de comparar teléfonos — se le agrega **una
 * guarda**: el `codigoPais`.
 *
 * Hace falta porque el sufijo de 9 asume que todos son peruanos, y **casi 2 de
 * cada 3 clientes no lo son** (México 1.987 · Ecuador 1.981 · Guatemala 393…).
 * Con largos nacionales distintos —Perú 9, México 10, Guatemala 8— los 9 dígitos
 * finales se comen parte del código de país, y entonces:
 *
 *   · un mexicano de Veracruz (+52 **991 234 5678**) y un peruano
 *     (+51 **912 345 678**) tienen el MISMO sufijo `912345678` → falso positivo:
 *     la vendedora saluda como cliente a un desconocido, y a la tercera vez deja
 *     de creerle a la marca;
 *   · un guatemalteco guardado en local (8 dígitos) nunca alcanza los 9 y jamás
 *     matchea → 393 clientes invisibles, que es el bug que este issue vino a
 *     arreglar.
 *
 * Las dos se resuelven **normalizando el teléfono del padrón a E.164 antes de
 * sacarle el sufijo** (completándolo con el país declarado cuando viene local) y
 * guardando el código de país al lado. El JOIN de la cola sigue siendo por
 * sufijo —barato, indexable, una sola pasada— y el código de país es lo que le
 * permite DESMENTIRLO: `codigo_pais IS NULL OR <teléfono de la conversación>
 * LIKE codigo_pais || '%'`. Del lado de la conversación no hace falta nada: el
 * `persona_id` de WhatsApp SIEMPRE viene en internacional (`identidadWa.ts`).
 *
 * Cuando no se puede saber el país, `codigoPais` queda en `null` y el match
 * vuelve a ser el de siempre (sufijo pelado). Es la degradación honesta: se
 * comporta como hoy y el script de sincronización **cuenta cuántas filas
 * quedaron así**, para que el riesgo sea un número y no una sospecha.
 */

/** El namespace de la fuente. Mañana puede haber otra (un dump de Cerberus, por ejemplo). */
export const NAMESPACE_PADRON = "icarus:";

/** Una fila del padrón, tal como la devuelve el driver (`icarus.contacts`). */
export interface FilaCrudaPadron {
  id: number | string;
  phone: string | null;
  country: string | null;
  n_purchases: number | string | null;
  buyer_tier: string | null;
}

/** Lo mínimo que la cola necesita de un cliente. Ver §PII. */
export interface FilaPadron {
  clienteId: string;
  /** Los últimos 9 dígitos del E.164 — la MISMA llave de `sufijoTelefonoSql`. */
  sufijo: string;
  /** El código de país (`51`, `52`, `502`…). `null` = no se pudo saber. */
  codigoPais: string | null;
  compras: number;
  nivel: NivelCliente;
}

/**
 * LOS PAÍSES DEL PADRÓN, con su código y los largos nacionales plausibles.
 *
 * Los `largos` son lo que hace confiable detectar el país MIRANDO el número: sin
 * ellos, `502…` podría leerse como Perú (`51`) y cualquier prefijo pegaría con
 * cualquier cosa. Se listan los del padrón real (Perú 2.923 · México 1.987 ·
 * Ecuador 1.981 · Bolivia 934 · R. Dominicana 473 · Colombia 452 · Guatemala 393
 * · Panamá 300) más el resto de LATAM y España, que aparecen de a poco.
 *
 * México y Argentina aceptan un dígito extra: es el `1`/`9` que WhatsApp arrastró
 * durante años (`521…`, `549…`) y que todavía se ve en números guardados viejos.
 */
const PAISES: readonly { codigo: string; largos: readonly number[]; nombres: readonly string[] }[] = [
  { codigo: "51", largos: [9], nombres: ["peru", "pe", "per"] },
  { codigo: "52", largos: [10, 11], nombres: ["mexico", "mejico", "mx", "mex"] },
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
  { codigo: "54", largos: [10, 11], nombres: ["argentina", "ar", "arg"] },
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
function clave(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const POR_NOMBRE = new Map<string, (typeof PAISES)[number]>(
  PAISES.flatMap((p) => p.nombres.map((n) => [clave(n), p] as const)),
);

/** ¿Estos dígitos ya son un E.164? Devuelve el país si el código Y el largo cierran. */
function paisDelNumero(digitos: string): (typeof PAISES)[number] | null {
  for (const pais of POR_LARGO_DE_CODIGO) {
    if (!digitos.startsWith(pais.codigo)) continue;
    if (pais.largos.includes(digitos.length - pais.codigo.length)) return pais;
  }
  return null;
}

/**
 * El teléfono del padrón, llevado a E.164 (dígitos, sin `+`) y con su país.
 *
 * Tres caminos, en orden: el número ya viene internacional (se le cree al
 * número, que es el dato duro) · viene local y el país declarado permite
 * completarlo · no se puede saber, y entonces se dice `null` en vez de suponer.
 */
export function normalizarDelPadron(
  telefono: string | null | undefined,
  pais: string | null | undefined,
): { e164: string; codigoPais: string | null } | null {
  const digitos = (telefono ?? "").replace(/\D/g, "");
  if (digitos.length < 8) return null;

  const delNumero = paisDelNumero(digitos);
  if (delNumero) return { e164: digitos, codigoPais: delNumero.codigo };

  const declarado = pais ? POR_NOMBRE.get(clave(pais)) : undefined;
  if (declarado) {
    // El `0` de discado nacional que muchos CRM guardan («0986…») no viaja a E.164.
    const local = digitos.replace(/^0+/, "");
    // Solo se completa si el largo cierra con ese país. Si no cierra, el número
    // dice otra cosa que no entendemos: se conserva tal cual y se prefiere el
    // falso NEGATIVO (un cliente sin marcar) antes que un E.164 inventado.
    if (declarado.largos.includes(local.length)) {
      return { e164: `${declarado.codigo}${local}`, codigoPais: declarado.codigo };
    }
    return { e164: digitos, codigoPais: declarado.codigo };
  }

  return { e164: digitos, codigoPais: null };
}

/** La fila cruda del padrón → lo que va a `clientes_padron`, o `null` si no aporta. */
export function filaDePadron(cruda: FilaCrudaPadron): FilaPadron | null {
  const compras = Number(cruda.n_purchases ?? 0);
  const nivel = nivelDeCliente({ compras, tier: cruda.buyer_tier });
  if (!nivel) return null;

  const normalizado = normalizarDelPadron(cruda.phone, cruda.country);
  if (!normalizado) return null;

  const sufijo = sufijoTelefono(normalizado.e164);
  if (!sufijo) return null;

  return {
    clienteId: `${NAMESPACE_PADRON}${cruda.id}`,
    sufijo,
    codigoPais: normalizado.codigoPais,
    compras: Math.trunc(compras),
    nivel,
  };
}
