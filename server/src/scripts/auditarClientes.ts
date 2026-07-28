import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { padronCteSql, padronJoinSql, yaComproSql } from "../cola/clienteSql.js";
import { partirE164, variantesLocales } from "../telefono/paises.js";
import { ficha } from "../cerberus/ficha.js";

/**
 * «VARIOS DICEN CLIENTE PERO NO SE MUESTRAN SUS COMPRAS» — la auditoría que
 * separa las tres causas, porque en pantalla las tres se ven igual.
 *
 * ```
 * cd server && npm run clientes:auditar               # sin red: la forma de los números
 * cd server && npm run clientes:auditar -- --cerberus # además le pregunta a Cerberus
 * cd server && npm run clientes:auditar -- --cerberus --limite 40
 * ```
 *
 * SOLO LECTURA: no escribe una fila y no manda un mensaje. Lo único que hace
 * contra Cerberus es la MISMA consulta que ya hace el panel al abrir un chat.
 *
 * ── Por qué hace falta medir en vez de arreglar a ojo ──
 * La píldora «Cliente» de la fila y las compras del panel salen de **dos fuentes
 * distintas que nunca se compararon**:
 *
 *   · la fila  → `clientes_padron`, la copia local del padrón de icarus, que se
 *     cruza por sufijo de 9 + guarda de país (#119);
 *   · el panel → Cerberus en vivo, `buscar/?q=` sobre `tb_telefono.numero`.
 *
 * Que una diga «compró» y la otra no encuentre nada tiene TRES causas posibles,
 * y la acción correcta es distinta en cada una:
 *
 *   A. **El número no se puede buscar así.** Con local más corto que 9 dígitos
 *      (Guatemala, Bolivia, Panamá…), el sufijo de 9 se mete adentro del código
 *      de país y el `icontains` no puede dar verdadero nunca. Se arregla en
 *      Hermes — y es lo que arregla `telefono/paises.ts`.
 *   B. **Cerberus no tiene a esa persona con ESE número.** Está cargada con otro
 *      teléfono. Se arregla del lado del dato, no del código.
 *   C. **El padrón afirma de más.** `icarus.contacts.n_purchases` se deriva de
 *      `icarus.sales` sólo cuando corre `refreshContactPurchaseStats`; para las
 *      59k filas que entraron por el import de `leads_crm` el valor viene
 *      **verbatim del dump viejo** (ver `apps/api/scripts/import-contacts.ts`
 *      del repo icarus). Ahí «ya compró» puede ser una afirmación heredada que
 *      ninguna venta de Cerberus respalda.
 *
 * Este script cuenta cuántas caen en cada una. Sin ese reparto, arreglar A y
 * declarar el problema resuelto sería exactamente el dry-run que muestra el
 * resultado y esconde las condiciones.
 */

const conCerberus = process.argv.includes("--cerberus");
const limite = Number(process.argv[process.argv.indexOf("--limite") + 1]) || Infinity;
const dias = Number(process.argv[process.argv.indexOf("--dias") + 1]) || 90;

interface FilaAuditada extends Record<string, unknown> {
  persona_id: string;
  nivel: string;
  compras: number;
}

/**
 * Los ex-clientes de la cola, con los MISMOS fragmentos que usa la cola de
 * verdad (`cola/clienteSql.ts`). Nada de una segunda forma de cruzar teléfonos:
 * si esta auditoría matcheara distinto que la pantalla, mediría otra cosa.
 */
async function exClientesDeLaCola(): Promise<FilaAuditada[]> {
  const filas = await db.execute<FilaAuditada>(sql`
    WITH todo AS (
      SELECT canal, tipo, persona_id
      FROM interactions
      WHERE tipo = 'mensaje'
        AND canal = 'whatsapp'
        AND persona_id IS NOT NULL
        AND occurred_at > now() - (${dias} * interval '1 day')
    ),
    padron AS (${padronCteSql()})
    SELECT DISTINCT todo.persona_id, pc.nivel, pc.compras
    FROM todo
    ${padronJoinSql()}
    WHERE ${yaComproSql}
    ORDER BY todo.persona_id
  `);
  return [...filas];
}

/** Enmascarado para poder pegar la salida en un issue sin repartir teléfonos. */
function tapar(telefono: string): string {
  const d = telefono.replace(/\D/g, "");
  return d.length <= 6 ? "***" : `${d.slice(0, d.length - 6)}••••${d.slice(-2)}`;
}

/**
 * LA BÚSQUEDA VIEJA, tal cual estaba antes de este arreglo: los últimos 9
 * dígitos y el primer resultado. Está acá —duplicada a propósito y sólo acá—
 * para poder decir **cuántas** conversaciones gana el cambio en vez de afirmar
 * que gana alguna.
 */
async function encontrabaAntes(telefono: string): Promise<boolean | null> {
  const d = telefono.replace(/\D/g, "");
  const q = d.length > 9 ? d.slice(-9) : d;
  if (q.length < 6) return false;
  const base = (process.env.CERBERUS_BASE_URL ?? "https://app.goberna.us").replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/clientes/buscar/?q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { clientes?: unknown[] };
    return (data.clientes?.length ?? 0) > 0;
  } catch {
    return null;
  }
}

/** De a cuatro: es la misma carga que cuatro vendedoras abriendo un chat. */
async function enTandas<T, R>(items: T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const salida: R[] = [];
  for (let i = 0; i < items.length; i += n) {
    salida.push(...(await Promise.all(items.slice(i, i + n).map(f))));
  }
  return salida;
}

const filas = (await exClientesDeLaCola()).slice(0, limite);

console.log(`\n══ EX-CLIENTES DE LA COLA — ¿Cerberus los reconoce? ═════════════════`);
console.log(`   ${filas.length} conversaciones de WhatsApp (${dias} días) que el padrón marca «ya compró».\n`);

if (filas.length === 0) {
  console.log("   El padrón no marcó ninguna. ¿Corriste `npm run clientes:sincronizar`?\n");
  process.exit(0);
}

// ── SIN RED: lo que la forma del número ya delata ────────────────────────────
const porPais = new Map<string, { total: number; imposible: number }>();
let sinPais = 0;
let imposibles = 0;

for (const f of filas) {
  const partido = partirE164(f.persona_id);
  const etiqueta = partido ? `+${partido.codigoPais}` : "sin país legible";
  if (!partido) sinPais += 1;

  // El sufijo de 9 no puede estar adentro de un número local más corto.
  const imposible = partido !== null && partido.local.length < 9;
  if (imposible) imposibles += 1;

  const acc = porPais.get(etiqueta) ?? { total: 0, imposible: 0 };
  acc.total += 1;
  if (imposible) acc.imposible += 1;
  porPais.set(etiqueta, acc);
}

console.log("── A. La forma del número (sin red) ──────────────────────────────");
console.log(
  `   ${imposibles} de ${filas.length} tienen el número local MÁS CORTO que 9 dígitos:\n` +
    "   para esas, la búsqueda vieja (sufijo de 9) no podía dar verdadero nunca.\n",
);
for (const [pais, { total, imposible }] of [...porPais].sort((a, b) => b[1].total - a[1].total)) {
  const marca = imposible > 0 ? `  ← ${imposible} imposibles con la búsqueda vieja` : "";
  console.log(`     ${String(total).padStart(5)}  ${pais.padEnd(18)}${marca}`);
}
if (sinPais > 0) {
  console.log(
    `\n   ⚠ ${sinPais} sin código de país legible: cruzan por sufijo pelado (#119).`,
  );
}

if (!conCerberus) {
  console.log(
    "\n   Para saber cuántas resuelve Cerberus de verdad: `-- --cerberus`.\n" +
      "   (le pregunta lo mismo que el panel al abrir cada chat)\n",
  );
  process.exit(0);
}

// ── CON RED: qué contesta Cerberus, antes y después ──────────────────────────
console.log(`\n── B/C. Contra Cerberus (${filas.length} consultas) ────────────────────`);

const resultados = await enTandas(filas, 4, async (f) => {
  const [antes, ahora] = await Promise.all([encontrabaAntes(f.persona_id), ficha(f.persona_id)]);
  return { f, antes, ahora };
});

const errores = resultados.filter((r) => r.ahora.estado === "error");
const noFigura = resultados.filter((r) => r.ahora.estado === "nuevo");
const encontrados = resultados.filter((r) => r.ahora.estado === "cliente");
const sinVentas = encontrados.filter(
  (r) => r.ahora.estado === "cliente" && r.ahora.ventasCount === 0,
);
const ganados = resultados.filter((r) => r.antes === false && r.ahora.estado === "cliente");

console.log(`\n   ${encontrados.length} las encuentra Cerberus, y de esas:`);
console.log(`       ${encontrados.length - sinVentas.length} con ventas cargadas → el panel muestra las compras`);
console.log(`       ${sinVentas.length} SIN ninguna venta → «Es cliente, pero sin ventas cargadas»`);
console.log(`\n   ${ganados.length} las encuentra SÓLO con el arreglo (causa A: el número no se podía buscar)`);
console.log(`   ${noFigura.length} no las tiene con NINGUNA forma del número`);
console.log(
  `       → causa B (cargado con otro teléfono) o causa C (el padrón afirma de más:\n` +
    `         n_purchases heredado del import de leads_crm, sin venta que lo respalde).\n` +
    `         Separarlas pide mirar icarus.sales para esos contactos.`,
);
if (errores.length > 0) {
  console.log(`\n   ⚠ ${errores.length} no se pudieron consultar (Cerberus no respondió). No cuentan como «no figura».`);
}

const muestra = noFigura.slice(0, 10);
if (muestra.length > 0) {
  console.log(`\n   Muestra de las que no figuran (para revisar a mano en Cerberus):`);
  for (const { f } of muestra) {
    const v = variantesLocales(f.persona_id).slice(0, 2).join(" · ");
    console.log(
      `     ${tapar(f.persona_id).padEnd(16)} padrón: ${f.nivel} ×${f.compras}` +
        `  ·  se buscó por: ${v}`,
    );
  }
}
console.log("");

process.exit(0);
