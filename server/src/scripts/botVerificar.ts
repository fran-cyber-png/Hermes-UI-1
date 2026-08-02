/**
 * ¿Qué ve el bot, y qué puede mandar de verdad?
 *
 * Read-only. No manda nada, no escribe nada. Es el reemplazo mínimo del
 * simulacro que el bot todavía no tiene (`auto:simulacro` existe para la
 * auto-respuesta y fue lo que atrapó los siete defectos del 27-jul; para el bot
 * no hay equivalente).
 *
 * Responde tres preguntas que ninguna otra cosa responde junta:
 *   1. ¿el catálogo llega al prompt? (los hechos que puede afirmar)
 *   2. ¿hay alguna pieza ENVIABLE? (si no, `mandar_pieza` no tiene qué mandar)
 *   3. ¿los archivos de esas piezas existen en disco? (si no, la guarda las frena)
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db/client.js";
import { leerCatalogo } from "../hechos/repositorio.js";
import { leerPiezaDelBot } from "../bot/piezaAMandar.js";
import { RUTA_MEDIA } from "../whatsapp/mediaDir.js";
import { leerPiezas } from "../catalogo/repositorio.js";

const ENFOQUE = process.env.ENFOQUE_PRODUCTO ?? "(sin definir)";
console.log(`\n══ ENFOQUE_PRODUCTO = ${ENFOQUE} ══\n`);

// 1. Los hechos que el bot puede afirmar
const { hechos } = await leerCatalogo(db);
console.log(`── ${hechos.length} hechos afirmables ──`);
for (const h of hechos) {
  const m = h.momentos.length === 0 ? "siempre" : h.momentos.join("/");
  console.log(`  ${h.clave.padEnd(26)} [${m}]`);
}

// 2. Las piezas del catálogo, y cuáles son enviables
const piezas = await leerPiezas(db);
const enviables = piezas.filter((p) => p.enviable);
console.log(`\n── ${piezas.length} piezas en el catálogo · ${enviables.length} enviables ──`);
for (const p of enviables) {
  console.log(`  ${p.clase}:${String(p.id).padEnd(6)} ${p.estado.padEnd(10)} familia=${p.familia?.valor ?? "(ninguna)"}`);
}

// 3. Las plantillas enviables, paso por paso, con sus archivos
console.log("\n── ¿los pasos pueden salir? ──");
for (const p of enviables.filter((x) => x.clase === "plantilla")) {
  const pieza = await leerPiezaDelBot(db, { clase: "plantilla", id: String(p.id) });
  if (!pieza) {
    console.log(`  ❌ plantilla:${p.id} — el lector del bot no la encuentra`);
    continue;
  }
  console.log(`  plantilla:${p.id} · ${pieza.vigente ? "✅ VIGENTE (se puede mandar)" : "❌ NO vigente: la guarda la frena"} · familia=${pieza.familiaCurso ?? "(ninguna)"}`);
  for (const paso of pieza.pasos) {
    const marcadores = (paso.texto ?? "").match(/\{(nombre|curso|precio|saludo)\}/g) ?? [];
    let veredicto = "✅";
    let nota = paso.texto ? `texto ${paso.texto.length} car.` : "solo adjunto";
    // `mediaPendiente` (pide una imagen que nadie cargó) y «el archivo no está en
    // disco» son las dos formas de que un paso no pueda salir, y las dos frenan
    // la secuencia ENTERA por la regla de todo-o-nada. Se distinguen porque se
    // arreglan en lugares distintos: una cargando la imagen, la otra en el server.
    if (paso.mediaPendiente) {
      veredicto = "❌";
      nota += " · imagen PENDIENTE (la guarda frena la secuencia)";
    } else if (paso.media) {
      const hay = existsSync(join(RUTA_MEDIA, paso.media.archivo));
      if (!hay) veredicto = "❌";
      nota += ` · ${paso.media.archivo} ${hay ? "en disco" : "NO ESTÁ EN DISCO"}`;
    }
    if (marcadores.length) nota += ` · marcadores: ${marcadores.join(" ")}`;
    console.log(`     ${veredicto} paso ${paso.orden}: ${nota}`);
  }
}

process.exit(0);
