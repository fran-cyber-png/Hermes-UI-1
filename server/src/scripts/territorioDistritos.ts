import { db } from "../db/client.js";
import { catalogoDe, altaDeDistrito, conteoPorDistrito } from "../territorio/repositorio.js";
import { motivoParaNoAceptar } from "../territorio/dominio.js";

/**
 * EL CATÁLOGO DE DISTRITOS DE UNA CAMPAÑA — se carga acá, nunca con SQL a mano
 * y nunca desde la app (ADR 0063).
 *
 * Mismo criterio que `reparto:rueda` y `equipo:sembrar`: **qué distritos tiene
 * una candidatura es una decisión de quien la maneja**, no una acción de la mesa
 * de trabajo. Meterla en la app la dejaría a un clic de cualquier token de
 * operador, y el catálogo es lo que define contra qué se cuenta todo el resto.
 *
 * ⚠️ **DRY-RUN POR DEFAULT.** Sin `--aplicar` imprime lo que haría y no escribe
 * una fila. Es la regla de la casa para todo script que toca producción.
 *
 *   npm run territorio:distritos -- --linea 51963139984
 *   npm run territorio:distritos -- --linea 51963139984 --agregar "San Isidro,Miraflores" --aplicar
 *   npm run territorio:distritos -- --linea 51963139984 --agregar "Comas" --zona "Lima Norte" --aplicar
 */

function flag(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const tiene = (nombre: string) => process.argv.includes(`--${nombre}`);

async function main() {
  const linea = (flag("linea") ?? "").trim();
  if (!linea) {
    console.error("Falta --linea <numero de la línea de campaña>.");
    console.error("Es la línea con `proposito = 'campana'` en `numeros_wa`.");
    process.exit(1);
  }
  const aplicar = tiene("aplicar");
  const agregar = (flag("agregar") ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  const zona = flag("zona")?.trim() || null;

  if (!agregar.length) {
    // Sin `--agregar` esto es un informe: qué hay y cuánta gente cayó en cada uno.
    const [catalogo, conteos] = await Promise.all([
      catalogoDe(db, linea),
      conteoPorDistrito(db, linea),
    ]);
    const porId = new Map(conteos.map((c) => [c.distritoId, c.n]));
    console.log(`\nCatálogo de la línea ${linea} — ${catalogo.length} distritos activos\n`);
    if (!catalogo.length) {
      console.log("  (vacío: nadie cargó distritos todavía, o falta la migración 0037)");
    }
    for (const d of catalogo) {
      const n = porId.get(d.id) ?? 0;
      console.log(`  ${String(n).padStart(5)}  ${d.nombre}${d.zona ? `  · ${d.zona}` : ""}`);
    }
    console.log("");
    process.exit(0);
  }

  /**
   * ⚠️ **Los nombres se validan ANTES de escribir el primero, no de a uno.** Con
   * la validación adentro del bucle, una lista de veinte con el número doce mal
   * deja once escritos y nueve sin escribir: el catálogo queda a medias y hay
   * que adivinar dónde cortó. Es la misma regla que `campana/lista.ts`.
   */
  const malos = agregar.map((n) => [n, motivoParaNoAceptar(n)] as const).filter(([, m]) => m);
  if (malos.length) {
    for (const [n, m] of malos) console.error(`  ✗ «${n}» — ${m}`);
    console.error("\nNo se escribió nada.");
    process.exit(1);
  }

  console.log(`\n${aplicar ? "APLICANDO" : "DRY-RUN (agregá --aplicar para escribir)"}`);
  console.log(`Línea ${linea}${zona ? ` · zona «${zona}»` : ""}\n`);
  let nuevos = 0;
  for (const nombre of agregar) {
    if (!aplicar) {
      console.log(`  + ${nombre}`);
      continue;
    }
    const { creado } = await altaDeDistrito(db, { linea, nombre, zona });
    console.log(`  ${creado ? "+" : "="} ${nombre}${creado ? "" : "  (ya estaba)"}`);
    if (creado) nuevos += 1;
  }
  console.log(
    aplicar ? `\n${nuevos} distrito(s) nuevo(s).\n` : `\n${agregar.length} se agregarían.\n`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
