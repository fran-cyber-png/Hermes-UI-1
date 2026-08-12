import "dotenv/config";
import { db } from "../db/client.js";
import { lineaDeCloudApi } from "../routing/linea.js";
import { clienteDeEntorno, resolverAnuncios } from "../routing/meta.js";
import { anunciosVistos, fotoDeRouting, guardarAnuncios, mapaDeAnuncios } from "../routing/repositorio.js";

/**
 * PREGUNTARLE A META DE QUÉ CAMPAÑA ES CADA ANUNCIO — desde la consola.
 *
 * Es el mismo trabajo que el botón «Actualizar desde Meta» de la pantalla, para
 * cuando conviene correrlo sin abrir la app (después de estrenar una campaña, o
 * desde un cron). **Dry-run por default**: sin `--aplicar` imprime lo que haría
 * y no escribe una fila.
 *
 *   npm run routing:refrescar              # solo mira
 *   npm run routing:refrescar -- --aplicar
 *   npm run routing:refrescar -- --aplicar --todo   # revisa también los estados
 *
 * ⚠️ `--todo` no es lo mismo que correrlo de nuevo: sin él solo se preguntan los
 * anuncios NUEVOS, así que una campaña que se pausó ayer sigue diciendo «activa»
 * hasta que alguien la vuelva a preguntar.
 */

async function main(): Promise<void> {
  const aplicar = process.argv.includes("--aplicar");
  const todo = process.argv.includes("--todo");

  const linea = lineaDeCloudApi();
  if (!linea) {
    console.error(
      "No hay línea de Cloud API (`WHATSAPP_CLOUD_API_NUMERO_PROPIO`): el referral del anuncio solo llega por el webhook de Meta.",
    );
    process.exit(1);
  }

  const cliente = clienteDeEntorno();
  if (!cliente) {
    console.error("Falta META_ACCESS_TOKEN: no se le puede preguntar a Meta por las campañas.");
    process.exit(1);
  }

  const [vistos, mapa] = await Promise.all([anunciosVistos(db), mapaDeAnuncios(db)]);
  const pedir = vistos.map((v) => v.adId).filter((ad) => todo || !mapa.has(ad));

  console.log(`Línea ${linea} · ${vistos.length} anuncios trajeron gente en la ventana.`);
  if (pedir.length === 0) {
    console.log("No hay nada que preguntar (usá `--todo` para revisar también los estados).");
    return;
  }

  const { resueltos, fallaron } = await resolverAnuncios(pedir, cliente);
  console.log(`Preguntados ${pedir.length} · resueltos ${resueltos.length} · sin resolver ${fallaron.length}`);
  if (fallaron.length) console.log(`  Meta no reconoció: ${fallaron.join(", ")}`);

  if (!aplicar) {
    // El dry-run muestra las CONDICIONES, no solo el resultado: qué campaña
    // quedaría para cada anuncio es lo que hay que poder revisar antes.
    const porCampana = new Map<string, { nombre: string; estado: string; anuncios: number }>();
    for (const r of resueltos) {
      const p = porCampana.get(r.campanaId);
      porCampana.set(r.campanaId, {
        nombre: r.campanaNombre,
        estado: r.estado,
        anuncios: (p?.anuncios ?? 0) + 1,
      });
    }
    for (const [id, c] of porCampana) {
      console.log(`  ${c.estado.padEnd(9)} ${String(c.anuncios).padStart(2)} anuncios · ${c.nombre} (${id})`);
    }
    console.log("\nDRY-RUN: no se escribió nada. Volvé a correr con `--aplicar`.");
    return;
  }

  const guardados = await guardarAnuncios(db, resueltos);
  const foto = await fotoDeRouting(db, linea);
  console.log(`\nGuardados ${guardados}. Cómo queda la pantalla:`);
  for (const c of foto.campanas) {
    const cae = c.vendedoras.length ? c.vendedoras.join(", ") : "la rueda";
    console.log(
      `  ${c.estado.padEnd(11)} ${String(c.personas).padStart(3)} personas · ${c.anuncios} anuncios · ` +
        `${c.nombre} → ${cae}`,
    );
  }
  if (foto.anunciosSinResolver > 0) {
    console.log(`  ⚠️ ${foto.anunciosSinResolver} anuncios siguen sin resolver: sus leads van a la rueda.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
