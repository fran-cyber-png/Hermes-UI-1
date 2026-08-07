import "dotenv/config";
import { aplicar, camposEsperados, leerEstado } from "../meta/suscribir.js";

/**
 * `npm run meta:suscribir [-- --aplicar]`
 *
 * Sin `--aplicar` no manda un solo POST: imprime el estado real de las Páginas y
 * qué cambiaría. Con `--aplicar`, suscribe.
 *
 * El 7-ago-2026 las 12 Páginas tenían `subscribed_apps` vacío — por eso en
 * producción no había un solo comentario de FB/IG. Ver `meta/suscribir.ts`.
 */

const token = process.env.META_ACCESS_TOKEN;
if (!token) {
  console.error("META_ACCESS_TOKEN no está configurado (server/.env).");
  process.exit(1);
}

const APLICAR = process.argv.includes("--aplicar");
const CALLBACK = "https://hermes-api.goberna.us/webhook/meta";

console.log(
  APLICAR
    ? "Suscribiendo las Páginas al webhook de Meta...\n"
    : "DRY-RUN (nada se manda). Agregá `-- --aplicar` para suscribir.\n",
);

let estados = await leerEstado(token);
if (APLICAR) estados = await aplicar(token, estados);

const ancho = Math.max(...estados.map((e) => e.nombre.length));
let pendientes = 0;
let conError = 0;

for (const e of estados) {
  const nombre = e.nombre.padEnd(ancho);
  const ig = e.instagramId ? " +IG" : "    ";

  if (e.error) {
    conError += 1;
    console.log(`  ⚠️  ${nombre}${ig}  ${e.error}`);
    continue;
  }
  if (e.faltan.length === 0) {
    const marca = e.resultado === "suscrita" ? "✅" : "  ";
    console.log(`  ${marca}  ${nombre}${ig}  ${e.suscritaA.join(", ") || "(sin campos)"}`);
    continue;
  }
  pendientes += 1;
  console.log(
    `  ⬜  ${nombre}${ig}  falta suscribir: ${e.faltan.join(", ")}` +
      (e.suscritaA.length ? `  (ya tiene: ${e.suscritaA.join(", ")})` : ""),
  );
}

const conIg = estados.filter((e) => e.instagramId).length;
console.log(
  `\n${estados.length} Páginas · ${conIg} con Instagram · ` +
    `${pendientes} sin suscribir${conError ? ` · ${conError} con error` : ""}`,
);
console.log(`Campos: ${camposEsperados("con-ig").join(", ")} (los de IG solo donde hay cuenta)`);

/**
 * ⚠️ LA MITAD QUE ESTE SCRIPT NO PUEDE HACER, y que en silencio deja todo igual.
 *
 * Suscribir la Página le dice a Meta «mandale los eventos a la app». DÓNDE los
 * manda se declara una sola vez en el dashboard. Sin eso, esto dice ✅ y no llega
 * nada — y no hay error, ni log, ni forma de notarlo salvo mirando la base.
 * Por eso se imprime SIEMPRE, incluso cuando todo salió bien.
 */
if (pendientes === 0 && conError === 0) {
  console.log(
    [
      "",
      "⚠️  Falta la mitad que no es código, y sin ella no llega NADA:",
      "",
      "   Meta app 1958308695630264 → Webhooks → objetos `page` e `instagram`:",
      `   · Callback URL:  ${CALLBACK}`,
      "   · Verify token:  el WHATSAPP_VERIFY_TOKEN del .env de VPS1",
      "",
      "   Para comprobar que llega de verdad (no alcanza con un 200):",
      "   ssh deploy@161.132.39.165 \"cd /srv/hermes/server && \\",
      "     psql \\$DATABASE_URL -c \\\"SELECT source, count(*), max(occurred_at) FROM events \\",
      "     WHERE source LIKE 'meta_comment%' OR source = 'meta_message_fb' GROUP BY 1;\\\"\"",
    ].join("\n"),
  );
}
