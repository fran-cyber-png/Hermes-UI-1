import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 🔴 LA CONSOLA DE VINCULACIÓN NO SE MONTA EN PRODUCCIÓN, Y ESTE TEST LEE EL
 * CABLEADO — no una función pura, porque el defecto vivía justamente ahí.
 *
 * ── Qué pasó ──
 *
 * `routes/vincular.ts` no tiene un solo middleware: sus cuatro handlers son
 * anónimos por construcción. Y colgaba de `app.use("/vincular", …)` **fuera del
 * perímetro** (no empieza en `/api`, así que `esRutaAbierta` devuelve `true` y
 * ni lo mira). Resultado: `GET /vincular/estado` publicaba, sin credencial, el
 * **data-URI del QR del pareo en vuelo**, el número y el JID al conectar.
 *
 * Quien lea ese QR antes que la vendedora se queda con su sesión de WhatsApp, y
 * recuperarla exige el teléfono físico. Con la auto-vinculación viva el agujero
 * dejó de ser teórico: `routes/vincular.ts`, `routes/admin.ts` y
 * `numeros/miLineaCableado.ts` importan **el mismo singleton** `vinculador`, así
 * que un pareo arrancado desde la app se leía entero por esta puerta.
 *
 * ── Por qué el test lee el archivo en vez de probar un booleano ──
 *
 * Una función `consolaHabilitada(env)` pura pasaría en verde **aunque nadie la
 * llamara**. Lo que hay que fijar es el CABLEADO: que la línea que monta el
 * router esté DENTRO de la guarda de producción. Es el mismo criterio que
 * `limitesMedia.paridad.test.ts` y `coreEnElBuild.test.ts` — cuando el defecto
 * está en la costura, el test tiene que mirar la costura.
 *
 * ⚠️ Este test NO reemplaza cerrar la puerta de verdad. Hoy en producción la
 * tapaba **nginx** (403 desde el dominio, 200 desde `127.0.0.1:4110`) y esa
 * regla no está versionada en este repo: por eso el candado vive acá, donde se
 * lee. Ver `docs/auditoria-aislamiento-de-chats-2026-08-17.md`.
 */

const INDEX = readFileSync(fileURLToPath(new URL("../index.ts", import.meta.url)), "utf8");

/** El cuerpo del `if (process.env.NODE_ENV !== "production") { … }` de `index.ts`. */
function bloqueSoloDev(fuente: string): string {
  const guarda = 'if (process.env.NODE_ENV !== "production") {';
  const desde = fuente.indexOf(guarda);
  assert.notEqual(desde, -1, "no encontré la guarda de producción en index.ts — ¿se renombró?");
  const cuerpo = fuente.slice(desde + guarda.length);
  const cierra = cuerpo.indexOf("\n}");
  assert.notEqual(cierra, -1, "no encontré el cierre del bloque solo-dev");
  return cuerpo.slice(0, cierra);
}

/** Las líneas de `index.ts` que montan algo, fuera de comentarios. */
function montajes(fuente: string): string[] {
  return fuente
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => !l.startsWith("*") && !l.startsWith("//") && l.includes("app.use("));
}

test("la consola /vincular SOLO se monta fuera de producción", () => {
  const montaVincular = (t: string) => montajes(t).some((l) => /app\.use\(\s*["']\/vincular["']/.test(l));

  assert.equal(montaVincular(INDEX), true, "index.ts ya no monta /vincular en ningún lado: ¿se borró el router?");
  assert.equal(
    montaVincular(bloqueSoloDev(INDEX)),
    true,
    "🔴 /vincular se monta FUERA de la guarda `NODE_ENV !== production`. Esa consola no tiene auth " +
      "propia y publica el QR del pareo en vuelo: en producción se queda con la sesión de WhatsApp " +
      "de quien esté vinculando. Movelo adentro del bloque solo-dev.",
  );
});

test("el router de /vincular sigue sin tener auth propia — por eso el montaje es la guarda", () => {
  const VINCULAR = readFileSync(fileURLToPath(new URL("./vincular.ts", import.meta.url)), "utf8");
  // Si alguien le pone auth propia, este test se pone rojo A PROPÓSITO: ahí la
  // premisa cambió y hay que decidir de nuevo si conviene montarla en producción,
  // en vez de arrastrar una guarda que ya no se sabe por qué está.
  const tieneAuth = /requiereVendedora|requiereServicio|exigeRol|exigeServicio/.test(VINCULAR);
  assert.equal(
    tieneAuth,
    false,
    "routes/vincular.ts ahora declara auth propia. Este candado existía porque NO la tenía: " +
      "revisá si todavía tiene sentido esconderla detrás de NODE_ENV, y actualizá este test con la razón.",
  );
});

test("las otras dos puertas al vinculador SÍ están detrás de una credencial", () => {
  // El fondo de esto: `vinculador` es un singleton compartido por tres puertas.
  // Cerrar una y dejar otra abierta no cierra nada, así que se fija el conjunto.
  const montaAdminConServicio = montajes(INDEX).some((l) =>
    /app\.use\(\s*["']\/api\/admin["']\s*,\s*requiereServicio/.test(l),
  );
  assert.equal(montaAdminConServicio, true, "/api/admin dejó de exigir requiereServicio");

  // `/api/whatsapp/mi-linea` cae bajo el perímetro por su prefijo `/api`, y su
  // router declara `requiereVendedora` adentro (ver routes/miLinea.ts).
  const montaMiLinea = montajes(INDEX).some((l) => /app\.use\(\s*["']\/api\/whatsapp\/mi-linea["']/.test(l));
  assert.equal(montaMiLinea, true, "/api/whatsapp/mi-linea dejó de montarse: la vendedora se queda sin puerta propia");
});
