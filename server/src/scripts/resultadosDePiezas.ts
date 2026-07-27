import "dotenv/config";
import { db } from "../db/client.js";
import { consultarResultados } from "../resultados/consultarResultados.js";
import type { FilaDeResultados } from "../resultados/agregar.js";
import { formatearMedicion, leGanaClaramente, MUESTRA_MINIMA } from "../resultados/medicion.js";

/**
 * QUÉ PIEZA CIERRA VENTAS Y CUÁL SOLO GASTA MENSAJES — read-only.
 *
 *   npm run piezas:resultados [dias]        (default 30)
 *
 * ══ POR QUÉ ESTA FORMA ══════════════════════════════════════════════════════
 *
 * Un dato que nadie mira no sirve, y una pantalla que nadie pidió tampoco. El
 * consumidor real de este número, hoy, es **quien escribe la próxima pieza**: se
 * sienta una vez, mira la tabla, y decide. Eso es un comando, no una vista.
 *
 * Y la vista sería peor que inútil ahora mismo: la procedencia se empieza a
 * acumular **recién con este deploy**, así que durante semanas mostraría una
 * tabla vacía; y el frente 2 de la épica va a reorganizar el catálogo entero,
 * o sea que la dibujaríamos dos veces. Lo que sí existe desde ya es la consulta
 * —`GET /api/resultados/piezas`— que este script consume: cuando haya qué mirar,
 * la pantalla son cien líneas encima de algo que ya funciona.
 *
 * ══ LA REGLA DE LA TABLA ════════════════════════════════════════════════════
 *
 * **La muestra va pegada a cada número, siempre.** Una pieza con 3 usos y 2
 * ventas no le gana a una con 400 y 180, y presentar 66 % al lado de 45 % sin
 * decir sobre cuántos casos es exactamente el error que este trabajo existe
 * para evitar. Por eso cada celda dice `67% (2/3) [21%–94%] ⚠muestra chica`, la
 * tabla se ordena **por muestra y no por tasa**, y la primera fila es siempre la
 * **línea de base**: lo que la vendedora escribió a mano. Si una pieza no le
 * gana a eso, la pieza no sirve.
 */

const DIAS_POR_DEFECTO = 30;

function encabezado(titulo: string): void {
  console.log(`\n${titulo}`);
  console.log("─".repeat(titulo.length));
}

function demora(min: number | null): string {
  if (min === null) return "—";
  if (min < 90) return `${Math.round(min)} min`;
  const h = min / 60;
  return h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`;
}

function imprimirFila(f: FilaDeResultados, seSabeDeVentas: boolean): void {
  const marca = f.esLineaDeBase ? "▸ " : "  ";
  console.log(`${marca}${f.rotulo}`);
  // LA MUESTRA PRIMERO. Es lo que hace legible todo lo que viene abajo.
  console.log(
    `    envíos: ${f.envios}` +
      (f.editados ? ` (${f.editados} salieron reescritos)` : "") +
      `  ·  ${f.primerUso.toISOString().slice(0, 10)} → ${f.ultimoUso.toISOString().slice(0, 10)}`,
  );
  console.log(`    respondió después de …… ${formatearMedicion(f.respondieron)}`);
  console.log(`      mediana hasta contestar  ${demora(f.medianaMinutosHastaLaRespuesta)}`);
  console.log(`    avanzó de etapa ……………… ${formatearMedicion(f.avanzaronDeEtapa)}`);
  console.log(`    se declaró perdida ……… ${formatearMedicion(f.seDeclararonPerdidas)}`);
  console.log(
    `    hubo venta después de … ${
      seSabeDeVentas && f.ventasDespues
        ? formatearMedicion(f.ventasDespues)
        : "no lo sabemos (sin atribución de ventas)"
    }`,
  );
  if (f.porVia.length > 1 || (f.porVia[0] && f.porVia[0].via !== "a-mano")) {
    console.log(`    por dónde entró ………………… ${f.porVia.map((v) => `${v.via}: ${v.envios}`).join(" · ")}`);
  }
  console.log("");
}

async function main(): Promise<void> {
  const dias = Number(process.argv[2]) || DIAS_POR_DEFECTO;
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

  const r = await consultarResultados(db, { desde });

  encabezado(`EL LAZO DE RESULTADOS — últimos ${dias} días (#169)`);
  console.log(`Desde:  ${desde.toISOString().slice(0, 16).replace("T", " ")}`);
  console.log(`Envíos con resultado medible: ${r.envios}`);
  console.log(
    `Ventanas: «contestó» ${r.ventanas.horas} h  ·  «hubo venta» ${r.ventanas.diasVenta} días`,
  );
  console.log(`Muestra mínima para que un porcentaje decida algo: ${MUESTRA_MINIMA}`);

  if (!r.seSabeDeVentas) {
    console.log("");
    console.log("⚠  «¿COMPRÓ?» NO SE PUEDE RESPONDER TODAVÍA.");
    console.log("   `conversiones_wa` no tiene ni una fila: las ventas no están ligadas a las");
    console.log("   conversaciones (es el PR #165). La columna va en blanco a propósito — decir");
    console.log("   «0 ventas» sería cierto sobre nuestra tabla y falso sobre el negocio.");
  }

  if (r.envios === 0) {
    console.log("");
    console.log("No hay envíos en la ventana. Dos motivos posibles, y son distintos:");
    console.log("  · nadie mandó nada en estos días, o");
    console.log("  · este server todavía no tiene el `db:push` de las columnas de procedencia");
    console.log("    (`pieza_clase`, `pieza_ref`, `pieza_version`, `pieza_via`, `pieza_editada`,");
    console.log("     `momento_venta`) y por eso la consulta no encuentra nada.");
    await cerrar();
    return;
  }

  encabezado("POR PIEZA — la línea de base primero, después por tamaño de muestra");
  console.log("(la línea de base ▸ es lo que la vendedora escribió a mano: si una pieza");
  console.log(" no le gana a eso, la pieza no sirve)\n");
  for (const f of r.filas) imprimirFila(f, r.seSabeDeVentas);

  // LA COMPARACIÓN, y solo cuando se puede hacer. La línea de base NO cuenta
  // como pieza: es el rival, no un competidor más.
  const base = r.filas.find((f) => f.esLineaDeBase);
  const piezas = r.filas.filter((f) => !f.esLineaDeBase);
  const conMuestra = piezas.filter((f) => f.respondieron.muestraSuficiente);

  encabezado("LO QUE SE PUEDE AFIRMAR");
  console.log(
    `${piezas.length} pieza(s) usadas · ${conMuestra.length} con muestra suficiente (≥ ${MUESTRA_MINIMA} envíos)`,
  );

  if (!base) {
    console.log("No hay línea de base en la ventana: sin ella no hay contra qué comparar.");
  } else if (conMuestra.length === 0) {
    console.log("");
    console.log(`Nada se puede afirmar todavía: ninguna pieza llegó a ${MUESTRA_MINIMA} envíos.`);
    console.log("Los porcentajes de arriba existen pero NO deciden nada — es el estado normal");
    console.log("al empezar a medir, y la razón por la que cada uno lleva su intervalo al lado.");
  } else {
    console.log("");
    console.log(`Contra la línea de base (${formatearMedicion(base.respondieron)}):`);
    for (const f of conMuestra) {
      const veredicto = leGanaClaramente(f.respondieron, base.respondieron)
        ? "LE GANA a escribir a mano"
        : leGanaClaramente(base.respondieron, f.respondieron)
          ? "PIERDE contra escribir a mano"
          : "empate: los intervalos se tocan, todavía no se sabe";
      console.log(`  · ${f.rotulo} → ${veredicto}`);
    }
    console.log("");
    console.log("«Se tocan» significa que la diferencia todavía puede ser azar, por más que un");
    console.log("porcentaje sea más alto. Es la respuesta honesta, y la única accionable.");
  }

  await cerrar();
}

async function cerrar(): Promise<void> {
  // El script es de lectura y termina: cerrar el pool evita que quede colgado.
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
}

main().catch((e) => {
  console.error("[piezas:resultados]", e);
  process.exit(1);
});
