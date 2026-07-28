import { sufijoTelefono } from "../whatsapp/identidadWa.js";
import { nivelDeCliente, type NivelCliente } from "./nivel.js";
import { paisDelNumero, paisDeNombre } from "../telefono/paises.js";

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
  /**
   * ¿HAY UNA VENTA QUE RESPALDE ESE CONTEO? — `EXISTS` sobre `icarus.sales`.
   *
   * `n_purchases` **no alcanza**, y esto no es prudencia: medido contra el padrón
   * vivo el 27-jul-2026, **5.805 de 10.504** contactos con `n_purchases >= 1` no
   * tienen ni una fila en `icarus.sales`, y 5.466 de ellos son `crm_import` sin
   * `goberna_app_id` — o sea, ni siquiera están vinculados a un cliente de
   * Cerberus. Ese contador lo copió verbatim el import de `leads_crm`
   * (`apps/api/scripts/import-contacts.ts`) y nadie lo volvió a calcular:
   * `refreshContactPurchaseStats` sólo corre cuando entra una venta por webhook.
   *
   * Cerberus, que es la fuente de verdad de las ventas, lo confirma desde el otro
   * lado: de 50 conversaciones marcadas así en la cola, 49 tenían ficha de cliente
   * con `ventas_count: 0` — incluidas varias marcadas **VIP con 5 compras**.
   *
   * `undefined`/`null` = no se pudo preguntar (la fuente no expone `sales`), y
   * entonces se degrada al comportamiento de siempre. `false` = se preguntó y no
   * hay: eso NO es un ex-cliente.
   */
  con_venta?: boolean | null;
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

  const declarado = paisDeNombre(pais);
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

/**
 * POR QUÉ UNA FILA NO ENTRA AL PADRÓN. Los tres motivos se cuentan aparte porque
 * dicen cosas distintas: `sin_compras` es el caso normal (un lead), `sin_telefono`
 * es un dato incompleto, y `sin_respaldo` es una **afirmación que no se sostiene**
 * —el conteo dice que compró y no hay venta— que en el padrón vivo es la mitad de
 * las filas. Meterlos en un solo número los volvería invisibles.
 */
export type MotivoDescarte = "sin_compras" | "sin_respaldo" | "sin_telefono";

export type ResultadoFila =
  | { fila: FilaPadron }
  /**
   * El descarte lleva el `clienteId` a propósito: una fila que ANTES calificaba y
   * ahora no —el caso de `sin_respaldo` cuando la fuente empieza a decir la
   * verdad— ya está escrita en `clientes_padron`, y el upsert no la saca. Sin el
   * id no habría con qué borrarla y la marca vieja sobreviviría al arreglo.
   */
  | { descarte: MotivoDescarte; clienteId: string };

/** La fila cruda del padrón → lo que va a `clientes_padron`, o por qué no entra. */
export function evaluarFilaDePadron(cruda: FilaCrudaPadron): ResultadoFila {
  const clienteId = `${NAMESPACE_PADRON}${cruda.id}`;
  const compras = Number(cruda.n_purchases ?? 0);
  const nivel = nivelDeCliente({ compras, tier: cruda.buyer_tier });
  if (!nivel) return { descarte: "sin_compras", clienteId };

  // «Ya compró» es una afirmación sobre plata: se exige la venta, no el contador.
  // Sólo cuando se PUDO preguntar — ver `con_venta` arriba.
  if (cruda.con_venta === false) return { descarte: "sin_respaldo", clienteId };

  const normalizado = normalizarDelPadron(cruda.phone, cruda.country);
  if (!normalizado) return { descarte: "sin_telefono", clienteId };

  const sufijo = sufijoTelefono(normalizado.e164);
  if (!sufijo) return { descarte: "sin_telefono", clienteId };

  return {
    fila: {
      clienteId,
      sufijo,
      codigoPais: normalizado.codigoPais,
      compras: Math.trunc(compras),
      nivel,
    },
  };
}

/** La fila cruda del padrón → lo que va a `clientes_padron`, o `null` si no aporta. */
export function filaDePadron(cruda: FilaCrudaPadron): FilaPadron | null {
  const r = evaluarFilaDePadron(cruda);
  return "fila" in r ? r.fila : null;
}
