import "dotenv/config";
import { correrBackfill, type Nivel } from "../pauta/backfill.js";
import { ventanaMaxima } from "../pauta/ventanas.js";

/**
 * Trae la historia de Meta que nunca capturamos.
 *
 *   npm run backfill                       los 37 meses, los 3 niveles
 *   npm run backfill -- --niveles=account  solo cuentas (rápido, para probar)
 *   npm run backfill -- --desde=2026-01-01 --hasta=2026-06-30
 *
 * Se corre a mano. No lo llama el reloj: el reloj mira el presente, esto rescata el pasado.
 */

function arg(nombre: string): string | undefined {
  const p = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return p?.split("=")[1];
}

async function main(): Promise<void> {
  const niveles = (arg("niveles")?.split(",") as Nivel[] | undefined) ?? undefined;
  const desde = arg("desde");
  const hasta = arg("hasta");
  const ventana = desde && hasta ? { since: desde, until: hasta } : ventanaMaxima(new Date());

  console.log(`  ventana: ${ventana.since} → ${ventana.until}`);
  console.log(`  niveles: ${(niveles ?? ["account", "campaign", "ad"]).join(", ")}`);
  console.log(`  (troceado en ventanas de 3 meses: pedirle 37 a Meta de una da HTTP 400/500)\n`);

  const r = await correrBackfill({ niveles, ventana });

  console.log(`\n  filas guardadas:  ${r.filas.toLocaleString("es")}`);
  console.log(`  trozos pedidos:   ${r.trozosPedidos}`);
  console.log(`  trozos fallidos:  ${r.trozosFallidos}`);
  console.log(`  cuentas:          ${r.cuentas}`);
  console.log(`  tardó:            ${r.segundos}s`);

  // Los fallos se dicen. Un backfill que calla lo que perdió miente sobre su cobertura.
  if (r.errores.length > 0) {
    console.log(`\n  ── LO QUE NO SE PUDO TRAER (${r.errores.length}) ──`);
    for (const e of r.errores.slice(0, 15)) {
      console.log(`  ${e.cuenta} · ${e.nivel} · ${e.ventana}`);
      console.log(`     ${e.motivo.slice(0, 100)}`);
    }
    if (r.errores.length > 15) console.log(`  ... y ${r.errores.length - 15} más`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
