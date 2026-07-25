import "dotenv/config";
import { db } from "../db/client.js";
import { CATALOGO_POR_DEFECTO } from "../hechos/catalogo.js";
import { sembrarCatalogo, leerCatalogo } from "../hechos/repositorio.js";

/**
 * SEMBRAR LOS DATOS RECOMENDADOS — `npm run hechos:sembrar`.
 *
 * Mete en la tabla el catálogo medido de #153. Es idempotente por `clave`:
 * correrlo dos veces no duplica nada y **no pisa** lo que alguien haya editado.
 * Sin `--aplicar` solo imprime lo que haría.
 */

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const antes = await leerCatalogo(db);

  console.log(`Catálogo actual: ${antes.hechos.length} datos (origen: ${antes.origen})`);
  if (antes.origen === "sin-tabla") {
    console.log("⚠️  La tabla `hechos` no existe. Corré `npm run db:push` antes de sembrar.");
    process.exit(1);
  }

  if (!aplicar) {
    console.log(`\nSe insertarían ${CATALOGO_POR_DEFECTO.length} datos (los que falten por clave):\n`);
    for (const h of CATALOGO_POR_DEFECTO) {
      console.log(`  · [${h.clave}] ${h.rotulo}`);
      console.log(`      momentos: ${h.momentos.join(", ") || "todos"}`);
      console.log(`      «${h.texto}»`);
    }
    console.log("\nDry-run. Volvé a correrlo con `-- --aplicar` para escribir.");
    process.exit(0);
  }

  await sembrarCatalogo(db);
  const despues = await leerCatalogo(db);
  console.log(`✓ Sembrado. Ahora hay ${despues.hechos.length} datos activos.`);
  process.exit(0);
}

void main();
