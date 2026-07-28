import "dotenv/config";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  proyectarLote,
  sincronizarLote,
  sumarResumen,
  RESUMEN_VACIO,
  type ResumenPadron,
} from "../clientes/sincronizar.js";
import type { FilaCrudaPadron } from "../clientes/padron.js";

/**
 * SINCRONIZAR EL PADRÓN DE CLIENTES → `clientes_padron` (#133).
 *
 *   npm run clientes:sincronizar              → sincroniza de verdad
 *   npm run clientes:sincronizar -- --dry-run → dice qué haría, sin escribir nada
 *
 * ── Por qué un script y no una consulta en vivo ──
 * Hermes ya sabe quién es cliente: se lo pregunta a Cerberus por HTTP, **de a una
 * y al abrir la conversación**. Para las 1.997 filas de la cola serían 1.997
 * llamadas a un servicio que a veces se cuelga (por eso el techo de 12 s del
 * panel): la vendedora vería un spinner por fila o, peor, una cola en blanco.
 * Con el padrón local el cruce se hace en la MISMA consulta de la cola, contra
 * un índice, sin una sola llamada de red.
 *
 * ── De dónde sale el padrón ──
 * De **icarus** (`icarus.contacts`), que es el CRM que recibe el webhook de
 * Cerberus en CADA venta y por eso tiene el padrón al día con sus agregados de
 * compra (`n_purchases`, `buyer_tier`). Cerberus es Django sin API REST: no hay
 * forma de pedirle «dame los 10.620 clientes» — solo `buscar?q=` de a uno, que
 * es exactamente el problema que este script viene a esquivar.
 *
 * Manual, como `ingest:leads` e `ingest:icarus`. Y **SOLO LEE** de icarus: la
 * conexión fuerza `default_transaction_read_only=on` a nivel de sesión, así que
 * cualquier escritura falla en el servidor y no por convención.
 */

const TANDA = 1000;

/** Las columnas que se le piden a `icarus.contacts`, y cuáles son imprescindibles. */
const COLUMNAS = {
  id: { requerida: true },
  phone: { requerida: true },
  n_purchases: { requerida: true },
  buyer_tier: { requerida: false },
  /**
   * `country` es opcional a propósito: es la guarda contra el falso positivo
   * entre países (#119), no el dato. Sin ella el cruce sigue funcionando como
   * hasta hoy (sufijo pelado) y el resumen lo dice con un número.
   */
  country: { requerida: false },
} as const;

const dryRun = process.argv.slice(2).includes("--dry-run");

const url = process.env.ICARUS_DATABASE_URL;
if (!url) {
  // FAIL-CLOSED: sin la credencial no hay padrón que traer. Ruidoso, no silencioso.
  console.error(
    "ICARUS_DATABASE_URL no está configurado. Es la conexión READ-ONLY al Postgres " +
      "de icarus, donde vive el padrón de clientes (ver server/.env.example).",
  );
  process.exit(1);
}

const icarus = postgres(url, {
  max: 2,
  connection: {
    default_transaction_read_only: true,
    application_name: "hermes-sincronizar-clientes",
  },
  onnotice: () => {},
});

/**
 * Qué columnas existen de verdad del otro lado.
 *
 * No es paranoia: `icarus.contacts` es de otro repo y otro equipo. Preguntarle
 * al catálogo cuesta una consulta y convierte «la sincronización trae 0
 * clientes» —el fallo que nadie investiga— en un error que nombra la columna que
 * falta.
 */
async function columnasPresentes(): Promise<Set<string>> {
  const filas = (await icarus`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'icarus' AND table_name = 'contacts'
  `) as unknown as { column_name: string }[];
  return new Set(filas.map((f) => f.column_name));
}

/** ¿Existe esa tabla del otro lado? Mismo criterio que `columnasPresentes`. */
async function tablaPresente(nombre: string): Promise<boolean> {
  const filas = (await icarus`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'icarus' AND table_name = ${nombre}
  `) as unknown as unknown[];
  return filas.length > 0;
}

let total: ResumenPadron = { ...RESUMEN_VACIO, porNivel: { ...RESUMEN_VACIO.porNivel } };
let ultimoId: number | string = 0;

try {
  const presentes = await columnasPresentes();
  if (presentes.size === 0) {
    console.error(
      "No existe la tabla `icarus.contacts` (o el usuario no la ve). Sin padrón no hay nada que sincronizar.",
    );
    process.exit(1);
  }

  const faltan = Object.entries(COLUMNAS)
    .filter(([nombre, c]) => c.requerida && !presentes.has(nombre))
    .map(([nombre]) => nombre);
  if (faltan.length > 0) {
    console.error(
      `A \`icarus.contacts\` le faltan columnas imprescindibles: ${faltan.join(", ")}.\n` +
        "Sin ellas no se puede saber quién compró ni con qué teléfono cruzarlo.",
    );
    process.exit(1);
  }

  const opcionalesAusentes = Object.entries(COLUMNAS)
    .filter(([nombre, c]) => !c.requerida && !presentes.has(nombre))
    .map(([nombre]) => nombre);

  console.log(dryRun ? "SIMULACIÓN — no se escribe nada.\n" : "Sincronizando el padrón de clientes (icarus)...\n");
  if (opcionalesAusentes.length > 0) {
    console.log(`  ⚠ Sin ${opcionalesAusentes.join(", ")} del otro lado: se sincroniza igual, con menos precisión.\n`);
  }

  // Las opcionales ausentes viajan como NULL para que la fila tenga siempre la
  // misma forma: la proyección ya sabe qué hacer con un país que no se sabe.
  const columna = (nombre: string) =>
    presentes.has(nombre) ? icarus`${icarus(nombre)}` : icarus`NULL AS ${icarus(nombre)}`;

  /**
   * ¿HAY UNA VENTA QUE RESPALDE EL CONTEO? — la pregunta que faltaba.
   *
   * `n_purchases` es un contador que para las 59k filas del import de `leads_crm`
   * viene VERBATIM del dump viejo y nunca se recalculó (medido el 27-jul-2026:
   * 5.805 de 10.504 «compradores» sin una sola fila en `icarus.sales`, 5.466 de
   * ellos sin siquiera un `goberna_app_id`). Un `EXISTS` correlacionado cuesta un
   * índice por fila y convierte una afirmación heredada en un hecho verificado.
   *
   * Si `icarus.sales` no existe del otro lado, la columna viaja como `NULL` y
   * `evaluarFilaDePadron` se comporta como antes — degradación honesta, avisada.
   */
  const hayVentas = await tablaPresente("sales");
  const conVenta = hayVentas
    ? icarus`EXISTS (SELECT 1 FROM icarus.sales s WHERE s.contact_id = c.id) AS con_venta`
    : icarus`NULL::boolean AS con_venta`;
  if (!hayVentas) {
    console.log(
      "  ⚠ No se ve `icarus.sales`: no se puede verificar que las compras existan.\n" +
        "    Se sincroniza confiando en `n_purchases`, que es lo que este chequeo vino a dejar de hacer.\n",
    );
  }

  while (true) {
    const filas = (await icarus`
      SELECT c.id, ${columna("phone")}, ${columna("country")},
             ${columna("n_purchases")}, ${columna("buyer_tier")},
             ${conVenta}
      FROM icarus.contacts c
      WHERE c.id > ${ultimoId}
      ORDER BY c.id
      LIMIT ${TANDA}
    `) as unknown as FilaCrudaPadron[];

    if (filas.length === 0) break;

    const resumen = dryRun ? proyectarLote(filas).resumen : await sincronizarLote(db, filas);
    total = sumarResumen(total, resumen);
    ultimoId = filas[filas.length - 1].id;

    console.log(`  ...${total.leidas} leídas (+${total.guardadas} clientes hasta acá)`);
  }
} finally {
  await icarus.end({ timeout: 5 });
}

const [{ n }] = await db.execute<{ n: number }>(
  sql`SELECT count(*)::int AS n FROM clientes_padron`,
);

console.log(`\n=== PADRÓN DE CLIENTES ${dryRun ? "(SIMULACIÓN)" : ""} ===`);
console.log(`  Filas leídas:        ${total.leidas.toLocaleString("es")}`);
console.log(`  Clientes guardados:  ${total.guardadas.toLocaleString("es")}`);
console.log(`    · VIP:             ${total.porNivel.vip.toLocaleString("es")}`);
console.log(`    · recompró:        ${total.porNivel.recompro.toLocaleString("es")}`);
console.log(`    · compró una vez:  ${total.porNivel.compro.toLocaleString("es")}`);
console.log(`  Descartadas:         ${total.descartadas.toLocaleString("es")} (sin teléfono o sin ninguna compra)`);
console.log(
  `    · sin respaldo:    ${total.sinRespaldo.toLocaleString("es")} decían haber comprado y NO tienen ni una venta`,
);
console.log(`  Total en base:       ${n.toLocaleString("es")}`);

// EL RIESGO, DICHO CON UN NÚMERO. Una fila sin código de país cruza por el sufijo
// de 9 dígitos pelado, que con clientes de 8 países puede matchear a otra
// persona (#119). No es una sospecha: es esta cifra.
// LO QUE SE DESMARCA, DICHO FUERTE. La primera corrida con este chequeo saca de
// la cola a miles de personas que decían «Cliente»: no es un detalle del resumen,
// es el cambio que la vendedora va a ver mañana en el chip «Ya compraron».
if (total.sinRespaldo > 0) {
  const pct = ((100 * total.sinRespaldo) / Math.max(total.sinRespaldo + total.guardadas, 1)).toFixed(1);
  console.log(
    `\n  ⚠ ${total.sinRespaldo.toLocaleString("es")} contactos (${pct}% de los que dicen haber comprado)` +
      `\n    NO tienen una sola venta en \`icarus.sales\` que lo respalde.` +
      `\n    ${dryRun ? "Se desmarcarían" : "Se desmarcaron"}: su \`n_purchases\` viene del import de leads_crm` +
      `\n    y nunca se recalculó. Cerberus tampoco les registra ventas.`,
  );
}

if (total.sinPais > 0) {
  const pct = ((100 * total.sinPais) / Math.max(total.guardadas, 1)).toFixed(1);
  console.log(
    `\n  ⚠ ${total.sinPais.toLocaleString("es")} de ${total.guardadas.toLocaleString("es")} (${pct}%) quedaron SIN código de país:` +
      `\n    su match es por sufijo pelado y puede cruzar entre países (#119).` +
      `\n    Se arregla del lado del padrón, cargando el país de esos contactos.`,
  );
}

process.exit(0);
